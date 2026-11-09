#!/usr/bin/env node
/**
 * 知识库操作录屏
 * ------------------------------------------------------------------
 * 和 `capture-kb-shots.mjs` 同一套 CDP 底座、同一份状态注入，区别只在产物：
 * 那边出静态图，这边出**带合成光标与字幕的操作视频**（MP4 + GIF + SRT）。
 *
 * 录制走 CDP 的 `Page.startScreenRecording`（浏览器自己编码，时间轴精确、
 * 流式不占内存），ffmpeg 只负责转码、变速、拼接与出 GIF。
 *
 * 时间轴写在 docs/kb/clips.config.mjs，产物落 docs/kb/media/<页面>/。
 *
 * 用法：
 *   cd web && npm run dev                  # 另开终端，固定 5273
 *   npx builderharness record-kb-clips
 *   npx builderharness record-kb-clips --only push-display-template/add-field --headed
 */

import { promises as fs } from "node:fs";
import { prototypeUrl } from "./lib/prototype-url.mjs";
import { PROJECT_CONFIG } from "./lib/paths.mjs";
import path from "node:path";
import { KB_DIR, REPO_ROOT } from "./lib/paths.mjs";

import { click, errorOverlay, evaluate, goto, installHelpers, launch, setState, setViewport, upload, waitFor } from "./lib/cdp.mjs";
import {
  assemble,
  clickHere,
  glideToSelector,
  hideDevChrome,
  highlight,
  installCursor,
  showCaption,
  sleep,
  startFrameRecording,
  writeSubtitles,
} from "./lib/recorder.mjs";
import { recordMedia } from "./lib/media-ledger.mjs";

const CONFIG_FILE = path.join(KB_DIR, "clips.config.mjs");
const OUT_DIR = path.join(KB_DIR, "media");

const DEFAULT_BASE_URL = process.env.BUILDERHARNESS_BASE_URL || PROJECT_CONFIG.baseUrl || "http://localhost:5273";
/**
 * 录屏视口：1280×720 布局 × 1.5 倍采样 = 正好 1920×1080 输出。
 *
 * 这三个数是一起定的，单独调任何一个都会变糊：
 *
 * - **CSS 视口要小，不要大。** 文字清晰度取决于「字在画面里占多少比例」。
 *   视口摊到 1920 的话布局铺得更开、12px 的字在画面里反而更小，
 *   放到播放器里更看不清。1280 是既不挤版又让字够大的折中。
 * - **scale 要大于 1。** scale=1 时 12px 的字就是 12 个像素，1:1 没有余量，
 *   播放器缩一点就糊。1.5 倍采样后再落到 1080p，等于做了一次超采样。
 * - **16:9。** 播放器容器是宽屏，非 16:9 的片子两边留黑边，
 *   等于把有效画面又缩小一圈。
 */
/**
 * 1920×1080，**页面不做任何缩放**。
 *
 * 录制表面按 CSS 视口尺寸走（`startScreencast` 与 `startScreenRecording` 都一样，
 * 都不认 Emulation 的模拟 DPR），所以要 1080p 成片，视口就得是 1920×1080。
 * 这也正好是一台普通桌面显示器上打开这个平台的样子——版面自然、不放大。
 *
 * 清晰度不靠放大页面，靠**无损 PNG 源 + 高码率编码**：
 * 之前糊是因为原生录制在源头就把码率压到 480 kbps，不是因为分辨率不够。
 */
const VIEWPORT = { width: 1920, height: 1080 };

function parseArgs(argv) {
  const args = { baseUrl: DEFAULT_BASE_URL, only: [], headed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const take = () => inline ?? argv[++i];
    if (flag === "--base-url") args.baseUrl = take();
    else if (flag === "--only") args.only.push(take());
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
  }
  return args;
}

/**
 * 记一笔物料台账。
 *
 * 「这张图过期了吗」这个问题，靠文件 mtime 答不了——git checkout 会把 mtime 重置，
 * 于是刚拉下来的仓库里每张图都像是刚截的。所以抓取时把**抓的时刻**和**它来自哪个路由**
 * 显式记下来，过期检测才有依据。台账由 kb-index.mjs 消费。
 */

/** 时间轴里的一个动作 */
async function runBeat(session, state, beat) {
  if (beat.hold) return sleep(beat.hold);
  if (beat.moveTo) {
    await glideToSelector(session, state, beat.moveTo, beat.ease ?? 600);
    if (beat.settle) await sleep(beat.settle);
    return;
  }
  if (beat.click) {
    await clickHere(session, state, { ripple: beat.ripple !== false });
    if (beat.waitFor && !(await waitFor(session, beat.waitFor))) {
      throw new Error(`点完没等到 «${beat.waitFor}»`);
    }
    return;
  }
  if (beat.type !== undefined) {
    // 敲进当前焦点（前一拍点中的输入框）。逐字敲：录出来是一个字一个字出现，
    // 整段闪现的话观众看不出这是「输入」。clear 先选中原有内容，第一个字就把它换掉
    if (beat.clear) await evaluate(session, "(() => { const el = document.activeElement; if (el && el.select) el.select(); })()");
    for (const ch of String(beat.type)) {
      await session.send("Input.insertText", { text: ch });
      await sleep(beat.charDelay ?? 70);
    }
    return;
  }
  if (beat.highlight !== undefined) return highlight(session, beat.highlight);
  if (beat.scroll) {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: state.x, y: state.y, deltaX: 0, deltaY: beat.scroll,
    });
    return;
  }
  throw new Error(`不认识的时间轴动作：${JSON.stringify(beat)}`);
}

async function record(session, key, def, { baseUrl, nonce }) {
  await setViewport(session, { ...VIEWPORT, ...def.viewport, scale: 1 });
  await goto(session, prototypeUrl(baseUrl, def.route, { clip: nonce }));
  await installHelpers(session);
  await sleep(500);

  // 编译不过就别录了——录下来的会是一屏报错遮罩。这里必须主动探：
  // 需要点击的配方会因为点不动而碰巧挂掉，纯 state 驱动的配方则会一路绿灯录完
  const broken = await errorOverlay(session);
  if (broken) throw new Error(`应用编译不过，录下来的会是报错遮罩：${broken}`);

  // 准备到「录制起点」的状态，这一段不入镜
  for (const step of def.setup ?? []) {
    if (step.state) await setState(session, step.state);
    else if (step.click) await click(session, step.click);
    else if (step.upload) await upload(session, step.upload.selector, [path.resolve(REPO_ROOT, step.upload.file)]);
    if (step.wait) await sleep(step.wait);
    if (step.waitFor && !(await waitFor(session, step.waitFor))) {
      throw new Error(`准备阶段没等到 «${step.waitFor}»`);
    }
    await sleep(step.settle ?? 350);
  }

  await hideDevChrome(session);
  await installCursor(session);
  const state = { x: def.cursorStart?.x ?? 120, y: def.cursorStart?.y ?? 200 };
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...state, buttons: 0 });
  await sleep(250);

  const rawDir = path.join(OUT_DIR, ".raw");
  await fs.mkdir(rawDir, { recursive: true });
  const segments = [];
  const cues = [];
  /** 字幕轴按**成片**时间累计：变速会改变段长，所以要乘回 speed */
  let timeline = 0;

  for (const seg of def.segments) {
    // captionBottom 逐片段可调：字幕压住当前要讲的控件时把它抬高或压低
    await showCaption(session, seg.say ?? null, seg.captionBottom ?? def.captionBottom);
    await sleep(seg.say ? 260 : 0); // 等淡入走完再开录，避免开头闪一下

    const file = path.join(rawDir, `${segments.length}-${seg.name.replace(/\W/g, "_")}.mp4`);
    const rec = startFrameRecording(session, file, { fps: 30, crf: def.captureCrf ?? 12 });
    await rec.ready;

    // 中途抛错必须先把 screencast 关掉，否则这一次运行里后面每一条都跟着废
    let seconds;
    try {
      for (const beat of seg.timeline) await runBeat(session, state, beat);
      await sleep(seg.tail ?? 400);
      ({ seconds } = await rec.stop());
    } catch (err) {
      await rec.abort();
      throw err;
    }

    const speed = seg.speed ?? 1;
    const shown = seconds / speed; // 变速后这一段在成片里占多久
    if (seg.say) cues.push({ start: timeline, end: timeline + shown, text: seg.say });
    timeline += shown;

    segments.push({ file, speed, name: seg.name });
  }
  await showCaption(session, null);

  const outDir = path.join(OUT_DIR, path.dirname(key));
  await fs.mkdir(outDir, { recursive: true });
  const base = path.basename(key);
  const out = await assemble(segments, outDir, base, { gif: def.gif, crf: def.crf });
  await fs.rm(rawDir, { recursive: true, force: true });
  const srt = await writeSubtitles(cues, outDir, base);
  return { ...out, srt, segmentCount: segments.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "用法: npx builderharness record-kb-clips [选项]",
        "",
        "  --base-url <地址>  原型地址，默认 http://localhost:5273",
        "  --only <clipKey>   只录某几段，可重复",
        "  --headed           显形运行，用来调时间轴",
      ].join("\n"),
    );
    return;
  }

  const { CLIPS } = await import(`file://${CONFIG_FILE}`);
  const entries = Object.entries(CLIPS).filter(
    ([key]) => args.only.length === 0 || args.only.includes(key),
  );
  if (entries.length === 0) {
    console.error("没有要录的片段：检查 clips.config.mjs 或 --only 拼写。");
    process.exitCode = 1;
    return;
  }

  const browser = await launch({ headless: !args.headed, viewport: VIEWPORT });
  const results = [];
  for (const [index, [key, def]] of entries.entries()) {
    try {
      const r = await record(browser.session, key, def, { baseUrl: args.baseUrl, nonce: index });
      results.push({ key, ok: true, ...r });
    } catch (err) {
      results.push({ key, ok: false, reason: err.message.split("\n")[0] });
    }
  }
  await browser.close();

  const ok = results.filter((r) => r.ok);
  await recordMedia(
    ok.flatMap((r) =>
      ["mp4", "gif"].map((ext) => ({ key: `media/${r.key}.${ext}`, route: CLIPS[r.key].route })),
    ),
  );
  console.log(`已录 ${ok.length}/${results.length} 段 → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
  for (const r of ok) {
    const kb = async (f) => (f ? `${Math.round((await fs.stat(f)).size / 1024)}KB` : "—");
    console.log(
      `  ✓ ${r.key}  ${r.segmentCount} 分段 / ${r.seconds.toFixed(1)}s` +
        `  mp4 ${await kb(r.mp4)}  gif ${await kb(r.gif)}  srt ${r.srt ? "有" : "无"}`,
    );
  }
  for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.key}：${r.reason}`);
  if (ok.length < results.length) process.exitCode = 1;

  // 原生录制留了 IO 句柄，不显式退出的话进程会挂着不走
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
