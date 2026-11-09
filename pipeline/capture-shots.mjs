#!/usr/bin/env node
/**
 * 原型截图批量抓取
 * ------------------------------------------------------------------
 * 按 FRS.json 的 `shots` 配方，把原型页面逐张截到 docs/features/<KEY>/shots/。
 * 抓下来的图由 builderharness prd 追加到云文档换取 imageId，再写进 PRD 的「参考图」列。
 *
 * 用法：
 *   cd web && npm run dev            # 另开一个终端，默认 5273
 *   npx builderharness capture-shots 09071618_EVAL_CASE_BULK_VISIBILITY
 *   npx builderharness capture-shots <KEY> --only case-list-bulk-confirm --headed
 *
 * 驱动的是本机已装的 Chrome，零依赖（见 lib/cdp.mjs）。
 * 配方里的 clip 是选择器，截那一块而不是整屏，所以 dev 的评审工具栏不会入镜；
 * 除原生 CSS 外还支持 `text=文字`，iView 的下拉项与文字按钮用它比堆 nth-child 可靠。
 */

import { promises as fs } from "node:fs";
import { prototypeUrl } from "./lib/prototype-url.mjs";
import { PROJECT_CONFIG } from "./lib/paths.mjs";
import path from "node:path";
import { FEATURES_DIR, REPO_ROOT } from "./lib/paths.mjs";

import {
  boundingBox,
  click,
  contentBox,
  evaluate,
  fill,
  fitViewport,
  hiddenByScroll,
  solidOverlayMask,
  nextPaint,
  goto,
  installHelpers,
  launch,
  press,
  screenshot,
  setState,
  setViewport,
  upload,
  waitFor,
} from "./lib/cdp.mjs";

const DEFAULT_BASE_URL = process.env.BUILDERHARNESS_BASE_URL || PROJECT_CONFIG.baseUrl || "http://localhost:5273";
const VIEWPORT = { width: 1680, height: 1050, scale: 2 };
/** 等页面稳定的宽限，iView 的下拉与弹窗都有过渡动画 */
const SETTLE_MS = 450;
/** 裁剪时向外留一点白边，避免阴影与边框被切掉 */
const CLIP_PADDING = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { key: null, baseUrl: DEFAULT_BASE_URL, only: [], headed: false, probe: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const take = () => inline ?? argv[++i];
    if (flag === "--base-url") args.baseUrl = take();
    else if (flag === "--only") args.only.push(take());
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--probe") args.probe = take();
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (!flag.startsWith("-")) args.key = flag;
  }
  return args;
}

/**
 * 列一个页面上可用的选择器。写新需求的 shots 配方时先跑它，
 * 比对着 .vue 源码猜类名快得多——页面由标准组件拼出来，
 * 同一套类名在所有列表页通用。
 */
async function probe(baseUrl, route, headed) {
  const browser = await launch({ headless: !headed, viewport: VIEWPORT });
  const { session } = browser;
  await goto(session, prototypeUrl(baseUrl, route, { probe: 1 }));
  await installHelpers(session);
  await sleep(800);

  const report = await evaluate(
    session,
    `(() => {
      const visible = (el) => el.getClientRects().length > 0;
      const classes = new Set();
      Array.from(document.querySelectorAll('[class]')).forEach((el) => {
        if (!visible(el) || typeof el.className !== 'string') return;
        el.className.split(/\\s+/).forEach((c) => {
          if (c && !/^ivu-/.test(c)) classes.add('.' + c);
        });
      });
      const labelOf = (el) => {
        const l = el.querySelector('.filter-label, .form-field-label');
        return l ? l.textContent.trim() : null;
      };
      return {
        containers: Array.from(classes).sort(),
        fields: Array.from(document.querySelectorAll('.filter-field, .form-field'))
          .filter(visible).map(labelOf).filter(Boolean),
        tabs: Array.from(document.querySelectorAll('.ivu-tabs-tab')).filter(visible)
          .map((e) => e.textContent.trim()),
        vueState: (() => {
          const host = Array.from(document.querySelectorAll('body *')).find((e) => e.__vue__);
          if (!host) return [];
          const stack = [host.__vue__.$root];
          while (stack.length) {
            const n = stack.shift();
            if (/Page$/.test(n.$options.name || '')) return Object.keys(n.$data);
            stack.push(...n.$children);
          }
          return [];
        })(),
      };
    })()`,
  );
  await browser.close();

  console.log(`# ${route}\n`);
  console.log(`clip 候选（业务类名，已滤掉 ivu-）：\n  ${report.containers.join("  ") || "（无）"}\n`);
  console.log(`field= 可用标签：\n  ${report.fields.join("  ") || "（无）"}\n`);
  console.log(`页签（配 text=）：\n  ${report.tabs.join("  ") || "（无）"}\n`);
  console.log(`state 可翻的字段：\n  ${report.vueState.join("  ") || "（无）"}`);
}

async function runStep(session, step) {
  if (step.click) await click(session, step.click);
  else if (step.fill) await fill(session, step.fill.selector, step.fill.text);
  else if (step.press) await press(session, step.press);
  // { upload: { selector, file } }：file 相对仓库根，一般放在件套的 fixtures/ 里（合成数据）
  else if (step.upload) await upload(session, step.upload.selector, [path.resolve(REPO_ROOT, step.upload.file)]);
  else if (step.state) await setState(session, step.state);
  else if (step.wait) await sleep(step.wait);
  else throw new Error(`不认识的步骤：${JSON.stringify(step)}`);

  if (step.waitFor && !(await waitFor(session, step.waitFor))) {
    throw new Error(`这一步没等到 «${step.waitFor}»`);
  }
  await sleep(SETTLE_MS);
}

async function capture(session, key, def, { baseUrl, outDir, nonce }) {
  // 横向铺开的区块用窄视口逼它换行，否则截出来是几十比一的长条
  await setViewport(session, { ...VIEWPORT, ...def.viewport });

  // 路由是 hash 模式，链接必须带 #。
  // nonce 加在 hash 之前：只改 hash 的导航不会重新加载文档，页面状态会从上一张
  // 截图漏过来（前一张勾了 20 行，这一张点表头复选框反而把它取消）。
  await goto(session, prototypeUrl(baseUrl, def.route, { shot: nonce }));
  await installHelpers(session);
  // 套件自己的评审层（.bk-root）浮在产品之上：贴边或加宽的浮层会被工具栏压出一块
  await evaluate(session, `(() => { const s = document.createElement('style'); s.textContent = '.bk-root{display:none!important;}'; document.head.appendChild(s); })()`);
  await sleep(SETTLE_MS);

  for (const step of def.steps ?? []) await runStep(session, step);

  if (def.clip) await solidOverlayMask(session, def.clip);

  // 截图对象比视口高就先把视口加高：产品页在内部容器里滚，超出视口的那截会截成空白（见 fitViewport）
  const vp = { ...VIEWPORT, ...def.viewport };
  const fit = def.clip
    ? await fitViewport(session, def.clip, vp, { measure: def.trim ? contentBox : boundingBox })
    : { height: vp.height };

  let clip;
  if (def.clip) {
    // trim 只保留容器里真正有内容的那块。全宽容器（筛选区、chip 行、批量操作条）
    // 不 trim 会截出 30:1 的纸片，缩进表格后点都点不开。
    const box = def.trim
      ? await contentBox(session, def.clip)
      : await boundingBox(session, def.clip);
    if (!box || box.width === 0 || box.height === 0) {
      return { key, ok: false, reason: `clip «${def.clip}» 没匹配到可见元素` };
    }
    // 留白不越过视口边：贴边的抽屉、弹窗多出那 8px 就得开 captureBeyondViewport，截到的是半截动画
    const pad = (start, size, limit) => {
      const from = Math.max(0, start - CLIP_PADDING);
      const end = start + size <= limit ? Math.min(limit, start + size + CLIP_PADDING) : start + size + CLIP_PADDING;
      return [from, end - from];
    };
    const [x, width] = pad(box.x, box.width, vp.width);
    const [y, height] = pad(box.y, box.height, fit.height);
    clip = { x, y, width, height };
  }

  await nextPaint(session);
  const file = path.join(outDir, `${key}.png`);
  await fs.writeFile(file, await screenshot(session, { clip, scale: VIEWPORT.scale }));
  if (!clip) return { key, ok: true, size: "整屏" };

  // 拍完自检：被页面里的滚动区挡住了一截，就是半截图
  const cut = await hiddenByScroll(session, def.clip);
  const ratio = clip.width / clip.height;
  return {
    key,
    ok: true,
    size: `${Math.round(clip.width)}×${Math.round(clip.height)}`,
    // 提前把会变纸片的挑出来，不用等发布后在文档里发现点不开
    tooWide: ratio > 9 ? ratio.toFixed(1) : null,
    cut: cut && cut.hidden > 4 ? cut : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.probe) {
    await probe(args.baseUrl, args.probe, args.headed);
    return;
  }
  if (args.help || !args.key) {
    console.log(
      [
        "用法: npx builderharness capture-shots <FEATURE_KEY> [选项]",
        "",
        "  --base-url <地址>  原型地址，默认 http://localhost:5273",
        "  --only <shotKey>   只抓某几张，可重复",
        "  --headed           显形运行，用来调 clip 选择器",
        "  --probe <路由>     列这个页面上可用的 clip / field= / 页签 / state 字段",
      ].join("\n"),
    );
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const featureDir = path.join(FEATURES_DIR, args.key);
  const frs = JSON.parse(await fs.readFile(path.join(featureDir, "FRS.json"), "utf8"));
  const entries = Object.entries(frs.shots ?? {}).filter(
    ([key]) => args.only.length === 0 || args.only.includes(key),
  );
  if (entries.length === 0) {
    console.error("没有要抓的截图：检查 FRS.json 的 shots 或 --only 拼写。");
    process.exitCode = 1;
    return;
  }

  const outDir = path.join(featureDir, "shots");
  await fs.mkdir(outDir, { recursive: true });

  const browser = await launch({ headless: !args.headed, viewport: VIEWPORT });
  const results = [];
  for (const [index, [key, def]] of entries.entries()) {
    try {
      results.push(
        await capture(browser.session, key, def, { baseUrl: args.baseUrl, outDir, nonce: index }),
      );
    } catch (err) {
      results.push({ key, ok: false, reason: err.message.split("\n")[0] });
    }
  }
  await browser.close();

  const ok = results.filter((r) => r.ok);
  console.log(`已抓 ${ok.length}/${results.length} 张 → ${path.relative(REPO_ROOT, outDir)}/`);
  for (const r of ok) {
    console.log(`  ✓ ${r.key}  ${r.size}${r.tooWide ? `  ← ${r.tooWide}:1 过扁` : ""}`);
    if (r.cut) console.log(`      ⚠ 有 ${r.cut.hidden}px 被页面里的滚动区「${r.cut.by}」挡住，图是半截的：clip 改成滚动区里的一块`);
  }
  for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.key}：${r.reason}`);

  const wide = ok.filter((r) => r.tooWide);
  if (wide.length > 0) {
    console.log("");
    console.log(`${wide.length} 张过扁，缩进参考图列后会点不开。给它们加 "trim": true，或换一个更贴内容的 clip。`);
  }
  if (ok.length < results.length) {
    console.log("");
    console.log("调选择器：加 --headed 显形跑，或改 FRS.json 里该 shot 的 clip / steps。");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
