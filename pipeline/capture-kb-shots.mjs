#!/usr/bin/env node
/**
 * 知识库截图批量抓取
 * ------------------------------------------------------------------
 * 与 `capture-shots.mjs` 同一套 CDP 底座，但服务的是**不同的读者**，所以另起一份：
 *
 *   capture-shots.mjs  → PRD 的「参考图」列，给研发看规则。截的是规则本身：
 *                        空态、错误态、无权限态、单个控件特写。
 *   本脚本             → 操作手册的配图，给运营看步骤。截的是任务推进中的页面：
 *                        整块带上下文，并在图上压一层序号角标与高亮框，
 *                        正文才能写「图中 ②」而不是「左边那个下拉」。
 *
 * 配方在 docs/kb/shots.config.mjs，产物落 docs/kb/images/（随手册入库，
 * 不像 docs/features/<KEY>/shots/ 那样被 gitignore —— 手册没有图就不成立）。
 *
 * 用法：
 *   cd web && npm run dev                     # 另开终端，固定 5273
 *   npx builderharness capture-kb-shots
 *   npx builderharness capture-kb-shots --only step1-overview --headed
 */

import { promises as fs } from "node:fs";
import { prototypeUrl } from "./lib/prototype-url.mjs";
import { PROJECT_CONFIG } from "./lib/paths.mjs";
import path from "node:path";
import { layoutSnapshot } from "./lib/layout-snapshot.mjs";
import { KB_DIR, REPO_ROOT } from "./lib/paths.mjs";

import {
  boundingBox,
  click,
  contentBox,
  errorOverlay,
  evaluate,
  fill,
  goto,
  installHelpers,
  fitViewport,
  hiddenByScroll,
  solidOverlayMask,
  launch,
  nextPaint,
  press,
  screenshot,
  setState,
  setViewport,
  upload,
  waitFor,
} from "./lib/cdp.mjs";
import { recordMedia } from "./lib/media-ledger.mjs";

const CONFIG_FILE = path.join(KB_DIR, "shots.config.mjs");
const OUT_DIR = path.join(KB_DIR, "images");

const DEFAULT_BASE_URL = process.env.BUILDERHARNESS_BASE_URL || PROJECT_CONFIG.baseUrl || "http://localhost:5273";
/** 比 PRD 截图高一截：手册要整块入镜，页面自身的滚动区不能把内容切掉 */
const VIEWPORT = { width: 1680, height: 1400, scale: 2 };
const SETTLE_MS = 450;
const CLIP_PADDING = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { baseUrl: DEFAULT_BASE_URL, only: [], headed: false, help: false };
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

async function runStep(session, step) {
  if (step.click) await click(session, step.click);
  else if (step.hover) await hover(session, step.hover);
  else if (step.fill) await fill(session, step.fill.selector, step.fill.text);
  else if (step.press) await press(session, step.press);
  else if (step.state) await setState(session, step.state);
  else if (step.upload) await upload(session, step.upload.selector, [path.resolve(REPO_ROOT, step.upload.file)]);
  else if (step.wait) await sleep(step.wait);
  else throw new Error(`不认识的步骤：${JSON.stringify(step)}`);

  if (step.waitFor && !(await waitFor(session, step.waitFor))) {
    throw new Error(`这一步没等到 «${step.waitFor}»`);
  }
  await sleep(step.settle ?? SETTLE_MS);
}

/**
 * 派发真实鼠标事件。info 图标的说明气泡由 iView Tooltip 的 mouseenter 驱动，
 * `el.click()` 那套合成点击触发不了它。
 */
async function hover(session, selector) {
  if (!(await waitFor(session, selector))) throw new Error(`悬停不到 «${selector}»`);
  const box = await boundingBox(session, selector);
  if (!box) throw new Error(`量不到 «${selector}» 的位置`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
}

/**
 * 往页面上压一层标注：序号角标 + 可选高亮框。
 *
 * 用固定定位的浮层而不是改元素本身的样式——后者会把被标注的控件挤位移，
 * 截出来的界面就和用户实际看到的对不上了。
 *
 * 这里的色值是**截图用的标注层**，不是产品界面，所以直接写死；
 * 「色值必须走 @color-*」这条约束的是原型应用的样式。
 */
async function annotate(session, marks) {
  return evaluate(
    session,
    `(() => {
      const marks = ${JSON.stringify(marks)};
      const missed = [];
      const placed = [];
      const layer = document.createElement('div');
      layer.id = '__manual_marks';
      layer.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none';
      document.body.appendChild(layer);

      const ACCENT = '#f5222d';

      for (const m of marks) {
        const el = window.__protoFind(m.at);
        // 命中不了就少一个角标，图还是会正常产出——所以必须回传给调用方如实报出来。
        // 只写 console.warn 的话，「页面改完重拍，图上悄悄少了 ③」没有任何人会发现，
        // 而正文里那句「③ 是请求设置」还在。
        if (!el) { missed.push({ n: m.n, at: m.at, why: 'notfound' }); continue; }
        const r = el.getBoundingClientRect();
        // 元素找到了不等于画得进来：字段挪去别的卡之后，它依然存在，只是落在了
        // 本张图的裁剪区外。裁剪框此刻还没算出来，先把位置带回去，由调用方比对。
        placed.push({ n: m.n, at: m.at, x: r.left, y: r.top, w: r.width, h: r.height });

        if (m.box !== false) {
          const box = document.createElement('div');
          box.style.cssText = [
            'position:fixed',
            'left:' + Math.round(r.left - 3) + 'px',
            'top:' + Math.round(r.top - 3) + 'px',
            'width:' + Math.round(r.width + 6) + 'px',
            'height:' + Math.round(r.height + 6) + 'px',
            'border:2px solid ' + ACCENT,
            'border-radius:4px',
          ].join(';');
          layer.appendChild(box);
        }

        const badge = document.createElement('div');
        badge.textContent = String(m.n);
        // 角标默认钉在左上角外侧；place 用来避开页面边缘和相邻角标
        const place = m.place || 'topleft';
        const SIZE = 22;
        let bx = r.left - SIZE / 2;
        let by = r.top - SIZE / 2;
        if (place === 'topright')  { bx = r.right - SIZE / 2; by = r.top - SIZE / 2; }
        if (place === 'left')      { bx = r.left - SIZE - 6;  by = r.top + r.height / 2 - SIZE / 2; }
        if (place === 'right')     { bx = r.right + 6;        by = r.top + r.height / 2 - SIZE / 2; }
        if (place === 'bottomleft'){ bx = r.left - SIZE / 2;  by = r.bottom - SIZE / 2; }
        // 坐标取整：落在小数像素上，圆的边缘抗锯齿每次都略有不同（2026-09-23 实测只有角标那
        // 7×7 像素在两次连拍间变化），早截断就会把每次重拍都当成画面变了
        badge.style.cssText = [
          'position:fixed',
          'left:' + Math.round(bx) + 'px',
          'top:' + Math.round(by) + 'px',
          'width:' + SIZE + 'px',
          'height:' + SIZE + 'px',
          'border-radius:50%',
          'background:' + ACCENT,
          'color:#fff',
          'font:600 13px/' + SIZE + 'px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
          'text-align:center',
        ].join(';');
        layer.appendChild(badge);
      }
      return { missed: missed, placed: placed };
    })()`,
  );
}

/**
 * 角标落在裁剪区外的挑出来。
 *
 * 判据是「和裁剪框完全不相交」而不是「没被完全包住」：角标本来就有意画在元素外侧，
 * 边缘那一两个总会探出去一点，按包含判会满屏误报。
 */
function outsideClip(placed, clip) {
  if (!clip) return [];
  return placed
    .filter((m) => m.x + m.w <= clip.x || m.x >= clip.x + clip.width || m.y + m.h <= clip.y || m.y >= clip.y + clip.height)
    .map((m) => ({ n: m.n, at: m.at, why: "offscreen" }));
}

/**
 * 截图前冻结一切过渡与动画。
 *
 * 早截断的前提是「页面没变，截出来的字节就不变」。可 iView 页签下面那条墨条是滑过去的，
 * 截图偶尔拍在半路：2026-09-23 同一个页面连拍两次，只有顶部 7 行像素不同，
 * 于是每次重拍都会把引用它的文档标成「画面变了」。动画在静态图里没有信息量，关掉。
 * 录屏不走这里——它要的就是动起来的样子。
 */
async function freezeMotion(session) {
  await evaluate(
    session,
    `(() => {
      const s = document.createElement('style');
      s.id = '__freeze_motion';
      // .bk-root 是套件自己的评审层（工具栏、批注）：它浮在产品之上，加宽的抽屉会被工具栏压出一块
      s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;}.bk-root{display:none!important;}';
      document.head.appendChild(s);
    })()`,
  );
}

async function capture(session, key, def, { baseUrl, nonce }) {
  await setViewport(session, { ...VIEWPORT, ...def.viewport });
  await goto(session, prototypeUrl(baseUrl, def.route, { shot: nonce }));
  await installHelpers(session);
  await freezeMotion(session);
  await sleep(SETTLE_MS);

  const broken = await errorOverlay(session);
  if (broken) return { key, ok: false, reason: `应用编译不过，拍下来的会是报错遮罩：${broken}` };

  for (const step of def.steps ?? []) await runStep(session, step);

  if (def.clip) await solidOverlayMask(session, def.clip);

  // 截图对象比视口高就先把视口加高（见 fitViewport）：标注与量尺寸都要在最终版面上做
  const vp = { ...VIEWPORT, ...def.viewport };
  const fit = def.clip
    ? await fitViewport(session, def.clip, vp, { measure: def.trim ? contentBox : boundingBox })
    : { height: vp.height, grown: false };

  // 字体异步换进来那一刻，文字宽高会差零点几像素，挂在文字旁的角标就在两个整数位置间跳：
  // 2026-09-23 同一张图连拍四次正好两种、各占一半。等字体就绪再量
  await evaluate(session, "document.fonts ? document.fonts.ready.then(() => true) : true");
  // 标注要在所有交互做完、版面稳定之后再压，否则量到的是中途位置
  const marked = def.marks?.length ? await annotate(session, def.marks) : { missed: [], placed: [] };

  let clip;
  let subject;
  if (def.clip) {
    const box = def.trim
      ? await contentBox(session, def.clip)
      : await boundingBox(session, def.clip);
    if (!box || box.width === 0 || box.height === 0) {
      return { key, ok: false, reason: `clip «${def.clip}» 没匹配到可见元素` };
    }
    // 留白不越过视口边：贴边的抽屉、弹窗多出那 10px 就得开 captureBeyondViewport，加宽过的抽屉会截成碎块
    const pad = (start, size, limit) => {
      const from = Math.max(0, start - CLIP_PADDING);
      const end = start + size <= limit ? Math.min(limit, start + size + CLIP_PADDING) : start + size + CLIP_PADDING;
      return [from, end - from];
    };
    const [x, width] = pad(box.x, box.width, vp.width);
    const [y, height] = pad(box.y, box.height, fit.height);
    clip = { x, y, width, height };
    subject = box;
  }

  await nextPaint(session);

  // key 里带 / 时按子目录落盘，一个页面一个目录，页面删了图也好清
  const file = path.join(OUT_DIR, `${key}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const png = await screenshot(session, { clip, scale: VIEWPORT.scale });
  await fs.writeFile(file, png);
  // 四边留白折成图上的像素（PNG 头里的宽 ÷ 裁剪框的 CSS 宽）。比对时这一圈不算：
  // 留白里是截图对象周围的东西（蒙层、相邻的行），它变了不等于这张图要说的变了
  let inset;
  if (clip && subject) {
    const k = png.readUInt32BE(16) / clip.width;
    inset = [subject.y - clip.y, clip.x + clip.width - (subject.x + subject.width), clip.y + clip.height - (subject.y + subject.height), subject.x - clip.x]
      .map((v) => Math.max(0, Math.floor(v * k)));
  }
  // 画面清单：截图这一刻看得见的每个元素（见 lib/layout-snapshot.mjs），审阅台靠它说「变了什么」
  const frame = clip ?? { x: 0, y: 0, width: vp.width, height: fit.height };
  const layout = await layoutSnapshot(session, frame, subject ?? frame);

  // 拍完自检：图是产出了，但是半截、或者角标没落上——记进台账，审阅台在这张图上直接写出来
  const missed = [...marked.missed, ...outsideClip(marked.placed, clip)];
  const warnings = missed.map((m) =>
    `角标 ${m.n}「${m.at}」没画上：${m.why === "offscreen" ? "元素还在，但落在这张图的裁剪区外" : "没找到落点（多半是改了名或换了类名）"}，正文里对应的那句可能已经不成立`,
  );
  if (def.clip) {
    const cut = await hiddenByScroll(session, def.clip);
    if (cut && cut.hidden > 4) {
      warnings.push(`截图对象有 ${cut.hidden}px 被页面里的滚动区「${cut.by}」挡住，图是半截的：clip 改成滚动区里的一块，或先滚到要截的那部分`);
    }
    if (clip && clip.y + clip.height > fit.height + 1) {
      warnings.push(`截图对象比视口还高（视口已加高到上限 ${fit.height}px），超出的部分会是空白：clip 换成更小的一块`);
    }
  }
  return {
    key,
    ok: true,
    size: clip ? `${Math.round(clip.width)}×${Math.round(clip.height)}` : "整屏",
    grown: fit.grown ? fit.height : 0,
    missed,
    warnings,
    inset,
    layout,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "用法: npx builderharness capture-kb-shots [选项]",
        "",
        "  --base-url <地址>  原型地址，默认 http://localhost:5273",
        "  --only <shotKey>   只抓某几张，可重复",
        "  --headed           显形运行，用来调 clip 与标注位置",
      ].join("\n"),
    );
    return;
  }

  const { SHOTS } = await import(`file://${CONFIG_FILE}`);
  globalThis.SHOTS = SHOTS;
  const entries = Object.entries(SHOTS).filter(
    ([key]) => args.only.length === 0 || args.only.includes(key),
  );
  if (entries.length === 0) {
    console.error("没有要抓的截图：检查 shots.config.mjs 或 --only 拼写。");
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await launch({ headless: !args.headed, viewport: VIEWPORT });
  const results = [];
  for (const [index, [key, def]] of entries.entries()) {
    try {
      results.push(await capture(browser.session, key, def, { baseUrl: args.baseUrl, nonce: index }));
    } catch (err) {
      results.push({ key, ok: false, reason: err.message.split("\n")[0] });
    }
  }
  await browser.close();

  const ok = results.filter((r) => r.ok);
  await recordMedia(
    ok.map((r) => ({ key: `images/${r.key}.png`, route: globalThis.SHOTS[r.key].route, warnings: r.warnings, inset: r.inset, layout: r.layout })),
  );
  console.log(`已抓 ${ok.length}/${results.length} 张 → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
  for (const r of ok) {
    console.log(`  ✓ ${r.key}  ${r.size}${r.grown ? `（对象比视口高，视口加高到 ${r.grown}px 再拍）` : ""}`);
    // 图产出了但有问题（半截、少了角标）：正文里多半还写着「① 是…」，得有人去对
    for (const w of r.warnings ?? []) console.log(`      ⚠ ${w}`);
  }
  for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.key}：${r.reason}`);

  const bad = ok.filter((r) => r.warnings?.length).length;
  if (bad) console.log(`\n  ${bad} 张拍出来有问题（见上面的 ⚠）——重拍解决不了，要改 docs/kb/shots.config.mjs 里的配方，或与正文对一下`);
  if (ok.length < results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
