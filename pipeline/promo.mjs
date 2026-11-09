#!/usr/bin/env node
/**
 * 宣传物料：导演活的原型 → 逐帧渲染 → GIF / MP4 / 海报
 * ------------------------------------------------------------------
 * 一份物料是一个目录（docs/promo/<需求 KEY>/），核心是 scenes.js：这个需求的几个使用场景，每个一段时间轴
 * （镜头对准哪个元素、几秒时点什么、标注贴在哪），开场状态可直接引用需求件套里的截图配方。
 * dev 服务给它一张舞台页（/__promo/<目录>/，promo/stage.js），与原型同源；也可以自己写 index.html
 * 用 kit.js 的 openApp() / setup() 从头画。
 *
 * 为什么不录屏、也不先截成静态图：
 *   - 原型自己的代码在跑，抽屉用它自己的过渡滑出、提示气泡按它自己的延时出现——不是手画的仿真；
 *   - 虚拟时钟（promo/clock.js）按帧拨时间，每一帧确定、可重渲，帧率与分辨率随便定，推近多少倍字都是矢量；
 *   - 原型是活的 DOM：镜头是对窗口的 3D 变换，组件可以从页面里「抽离」出来单独展示（祖先背景、兄弟节点按时间淡掉，组件照常运行），
 *     字卡逐字入场——这些都是对 DOM 的操作，截下来的图做不到；
 *   - 渲染时点击、悬停、输入走 CDP 的 Input 域（真鼠标、真键盘）：浏览器按画面上的位置做命中测试，:hover / :active / 焦点都是真的；
 *   - 记下这条路由牵涉的源码指纹，`status` 能说出哪张物料该重渲。
 * 逐帧截图本身是确定性渲染的标准做法（Remotion 等同理）；截图直接写进 ffmpeg 的标准输入，不落盘帧序列，GIF 由 gifski 直接读成片。
 * 做法综合自 video-shotcraft（真实界面 + 运镜）与 mg-styles-15（任意时刻 renderAt(t) 逐帧截）。
 *
 *   builderharness promo render  <目录>   # 每个场景 → out/<场景>.gif / .mp4 / .png（海报）/ .contact.png；再拼总片 out/<目录>.mp4
 *   builderharness promo status           # 哪些物料拍完之后源码变过
 *
 * 预览：内置浏览器打开 http://localhost:5173/__promo/<目录>/（各场景依次实时播放；?scene=<id>&t=3.2 停在那一帧）。
 * 预览没有 CDP 通道，动作走合成事件：按钮的 :hover 这类只在渲染出来的成片里有。
 *
 * render 的选项：
 *   --scene <id>           只渲这一个场景
 *   --stills 0,2.5,6       额外出这几个时刻的静帧（out/stills/<场景>-t-*.png）
 *   --only stills|mp4      只出静帧 / 只出 MP4（不出 GIF）
 *   --gif-width 960 --gif-fps 15 --max-mb 5   GIF 规格（默认取 PROMO 里的设置）；超体积先降质量、再缩宽
 *   --scale 1.5            渲染倍率（默认 1.5：1280×720 → 1920×1080）
 *   --jobs 4               几个浏览器并行渲场景（默认最多 4 个）
 *   --synthetic            不走真鼠标、真键盘，动作全用合成事件（排查用）
 *   --base http://localhost:5173
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { adapterName } from "./lib/adapter.mjs";
import { readEnv } from "./lib/env.mjs";

import { DOCS_DIR, FEATURES_DIR, KIT_ROOT, PROJECT_CONFIG, REPO_ROOT } from "./lib/paths.mjs";
import { evaluate, goto, launch, nextPaint, setViewport } from "./lib/cdp.mjs";
import { sourcesForRoute } from "./lib/route-source.mjs";

const DEFAULT_BASE_URL = readEnv("BASE_URL") || PROJECT_CONFIG.baseUrl || "http://localhost:5173";
const PROMO_DIR = path.join(DOCS_DIR, "promo");

const DEBUG = !!process.env.PROMO_DEBUG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[(i += 1)];
  }
  return out;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`跑不了 ${cmd}：${e.message}（没装的话 brew install ${cmd}）`)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出 ${code}：${err.trim().split("\n").slice(-3).join(" ")}`))));
  });
}

async function devServerUp(base) {
  const ok = await fetch(`${base}/__promo/config`).then((r) => r.ok, () => false);
  if (!ok) throw new Error(`${base} 上没有宣传物料服务：先 cd web && npm run dev（改过 vite 配置要重启）`);
}

// ── render ─────────────────────────────────────────────────────────

async function waitReady(session) {
  for (let i = 0; i < 600; i += 1) {
    const state = await evaluate(session, "({ ready: window.__ready === true, error: window.__promoError || '' })");
    if (state.error) throw new Error(`画面页报错：${state.error}`);
    if (state.ready) return;
    await sleep(100);
  }
  throw new Error("画面页 60 秒内没有就绪：index.html 要调 kit.js 的 setup()");
}

async function seek(session, t) {
  if (DEBUG) console.error(`  [seek] ${t.toFixed(3)}`);
  let timer;
  const stuck = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`第 ${t.toFixed(2)} 秒卡住了 45 秒（PROMO_DEBUG=1 重跑看停在哪条输入）`)), 45000);
  });
  await Promise.race([evaluate(session, `window.__promoSeek(${t})`), stuck]).finally(() => clearTimeout(timer));
  const error = await evaluate(session, "window.__promoError || ''");
  if (error) throw new Error(`画面页在 t=${t} 报错：${error}`);
  await evaluate(session, "window.__promoPaint ? window.__promoPaint() : true");
  await nextPaint(session);
}

/**
 * 真鼠标、真键盘的通道。舞台调 window.__promoInput(JSON)（Runtime.addBinding 装的绑定），这里转成 CDP Input 事件：
 * 浏览器按画面上的坐标做命中测试——穿过舞台的 3D 变换落进原型 iframe——:hover / :active / 焦点都是真的，
 * 事件是 isTrusted 的。做完回调 __promoInputDone(id)，舞台那边的 await 才往下走（虚拟时间在此期间停着）。
 */
async function installInputBridge(session) {
  await session.send("Runtime.addBinding", { name: "__promoInput" });
  let buttons = 0;
  session.on("Runtime.bindingCalled", async ({ name, payload }) => {
    if (name !== "__promoInput") return;
    const m = JSON.parse(payload);
    if (DEBUG) console.error(`  [input] ${payload}`);
    let error = "";
    try {
      const mouse = (type, extra = {}) => session.send("Input.dispatchMouseEvent", { type, x: m.x, y: m.y, button: "none", buttons, ...extra });
      if (m.type === "move") await mouse("mouseMoved");
      else if (m.type === "click") {
        await mouse("mouseMoved");
        buttons = 1;
        await mouse("mousePressed", { button: "left", clickCount: 1 });
        buttons = 0;
        await mouse("mouseReleased", { button: "left", clickCount: 1 });
      } else if (m.type === "text") await session.send("Input.insertText", { text: m.text });
      else if (m.type === "key") await press(session, m.key);
      else throw new Error(`不认识的输入 ${m.type}`);
    } catch (e) {
      error = e.message;
    }
    await session.send("Runtime.evaluate", { expression: `window.__promoInputDone(${m.id}, ${JSON.stringify(error)})` }).catch(() => {});
  });
}

/** GIF 直接从成片出：gifski 自己读 MP4（按 fps 重采样），不落任何临时帧；超体积先降质量、再缩宽 */
async function gifFromMp4(mp4, file, { fps, width, maxMb }) {
  let w = width;
  // 运动质量始终拉满、只降色彩质量：淡出的标注、退场的窗口在静止背景上留「鬼影」，就是 gifski 降运动质量时复用了上一帧的像素
  // （2026-10-28 评审；11-05 独立评审在质量 90 的 view.gif 上又看到一次）
  for (const quality of [100, 90, 80, 70, 60, 50, 50]) {
    await run("gifski", ["--fps", String(fps), "--width", String(w), "--quality", String(quality), "--motion-quality", "100", "-o", file, mp4]);
    const { size } = await fs.stat(file);
    if (!maxMb || size <= maxMb * 1024 * 1024) return { size, quality, width: w };
    if (quality === 50) w = Math.round((w * 0.85) / 2) * 2;
  }
  const { size } = await fs.stat(file);
  return { size, quality: 50, width: w, over: true };
}

/** Fingerprint recipes, binary assets, referenced features and route sources. */
async function fingerprint(dir, { routes, features, options, files }) {
  const inputs = new Set(files);
  const collect = async (root, ignored = []) => {
    for (const entry of await fs.readdir(root, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (ignored.includes(entry.name) || entry.name.startsWith(".")) continue;
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) await collect(file, ignored);
      else if (entry.isFile()) inputs.add(file);
    }
  };
  await collect(dir, ["out"]);
  await collect(path.join(KIT_ROOT, "promo"));
  for (const key of features) {
    inputs.add(path.join(FEATURES_DIR, key, "FRS.json"));
    await collect(path.join(FEATURES_DIR, key, "fixtures"));
  }
  const unresolved = [];
  for (const route of routes) {
    const sources = await sourcesForRoute(REPO_ROOT, route);
    if (!sources.length) unresolved.push(route);
    for (const file of sources) inputs.add(path.resolve(REPO_ROOT, file));
  }
  const hashes = {};
  for (const file of [...inputs].sort()) {
    hashes[rel(file)] = await fs.readFile(file).then(
      (buf) => createHash("sha256").update(buf).digest("hex"),
      (error) => { if (error.code === "ENOENT") return null; throw error; },
    );
  }
  return { hashes, options, unresolved };
}

/** 逐帧截图直接写进 ffmpeg 的标准输入（image2pipe），不落盘帧序列 */
function encoder(mp4, fps) {
  const child = spawn("ffmpeg", [
    "-y", "-f", "image2pipe", "-framerate", String(fps), "-vcodec", "png", "-i", "pipe:0",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", mp4,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  child.stdin.on("error", () => {}); // EPIPE 统一由 done 报
  const done = new Promise((resolve, reject) => {
    child.on("error", (e) => reject(new Error(`跑不了 ffmpeg：${e.message}（没装的话 brew install ffmpeg）`)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出 ${code}：${err.trim().split("\n").slice(-3).join(" ")}`))));
  });
  done.catch(() => {});
  return {
    async write(buf) {
      await Promise.race([
        new Promise((resolve, reject) => child.stdin.write(buf, (error) => error ? reject(error) : resolve())),
        done,
      ]);
    },
    async end() {
      child.stdin.end();
      await done;
    },
    async abort() {
      child.kill();
      await done.catch(() => {});
    },
  };
}

/** 渲染一个画面（单张合成页，或多场景里的一个场景），产物以 prefix 命名；log 收集输出，并行时按场景整段打印 */
async function renderOne(session, url, { prefix, dir, outDir, args, filmOnly, log }) {
  const opened = Date.now();
  await setViewport(session, { width: 1280, height: 720, scale: 1 });
  await evaluate(session, "window.__promoWarnings = []").catch(() => {});
  await goto(session, url);
  await waitReady(session);
  const prepSec = ((Date.now() - opened) / 1000).toFixed(1);
  const P = await evaluate(session, "window.PROMO");
  const routes = await evaluate(session, "window.__promoRoutes || []");
  const features = await evaluate(session, "window.__promoFeatures || []");
  const options = { width: P.width, height: P.height, duration: P.duration, fps: P.fps || 30,
    scale: Number(args.scale || P.scale || 1.5), gifWidth: args["gif-width"] || P.gifWidth,
    gifFps: args["gif-fps"] || P.gifFps, maxMb: args["max-mb"] || P.maxMb, synthetic: Boolean(args.synthetic),
    adapter: adapterName() };
  const adapter = adapterName();
  const files = [path.join(KIT_ROOT, "pipeline/promo.mjs"), path.join(REPO_ROOT, "builderharness.config.json"),
    adapter.startsWith(".") || path.isAbsolute(adapter) ? path.resolve(REPO_ROOT, adapter) : path.join(KIT_ROOT, "pipeline/adapters", `${adapter}.mjs`)];
  const dependencies = { routes, features, options, files };
  const baseline = await fingerprint(dir, dependencies);
  const scale = Number(args.scale || P.scale || 1.5);
  await setViewport(session, { width: P.width, height: P.height, scale });

  const only = args.only;
  const fps = P.fps || 30;
  const total = Math.round(P.duration * fps);
  const poster = P.poster ?? 0;
  const stills = String(args.stills || (only === "stills" ? poster : "")).split(",").filter(Boolean).map(Number);
  if (![P.width, P.height, P.duration, scale, fps].every((value) => Number.isFinite(value) && value > 0) ||
      !stills.every((time) => Number.isFinite(time) && time >= 0 && time <= P.duration)) {
    throw new Error("Invalid scene dimensions, duration, scale, frame rate or still time");
  }
  const needVideo = only !== "stills";
  const needGif = needVideo && only !== "mp4" && !filmOnly;
  const mp4 = path.join(outDir, `${prefix}.mp4`);
  const enc = needVideo ? encoder(mp4, fps) : null;

  // 一趟从前往后走完：活的原型只能往前拨，往回要整页重来，所以海报、静帧、逐帧按时间排好一起截
  const shots = [...(filmOnly || !needVideo ? [] : [{ t: poster, poster: true }]), ...stills.map((t) => ({ t, still: true }))];
  if (needVideo) for (let i = 0; i < total; i += 1) shots.push({ t: i / fps, frame: i });
  shots.sort((a, b) => a.t - b.t || (a.frame ?? -1) - (b.frame ?? -1));
  if (stills.length) await fs.mkdir(path.join(outDir, "stills"), { recursive: true });

  const started = Date.now();
  let lastT = -1;
  let buf = null;
  try {
    for (const s of shots) {
      if (s.t !== lastT) {
        await seek(session, s.t);
        // 按画布裁：滑进来的标注探出画布一点时，不裁的话这一帧会变宽。倍率已经由视口的 deviceScaleFactor 给了，clip 上再给就乘两遍
        const { data } = await session.send("Page.captureScreenshot", {
          format: "png", optimizeForSpeed: true, clip: { x: 0, y: 0, width: P.width, height: P.height, scale: 1 },
        });
        buf = Buffer.from(data, "base64");
        lastT = s.t;
      }
      if (s.poster) await fs.writeFile(path.join(outDir, `${prefix}.png`), buf);
      if (s.still) await fs.writeFile(path.join(outDir, "stills", `${prefix}-t-${s.t.toFixed(2)}.png`), buf);
      if (s.frame !== undefined) await enc.write(buf);
    }
    await enc?.end();
  } catch (error) {
    await enc?.abort();
    throw error;
  }
  const encodedAt = Date.now();

  const outputs = [];
  if (needVideo && !filmOnly) outputs.push(`${prefix}.png（海报，t=${poster}s）`);
  if (stills.length) outputs.push(`stills/ ${stills.length} 张`);
  if (needVideo) {
    outputs.push(`${prefix}.mp4 ${mb((await fs.stat(mp4)).size)}MB`);
    const cols = 6;
    const rows = Math.ceil((P.duration * 2) / cols);
    await run("ffmpeg", ["-y", "-i", mp4, "-vf", `fps=2,scale=320:-1,tile=${cols}x${rows}:padding=4:color=white`, "-frames:v", "1", path.join(outDir, `${prefix}.contact.png`)]);
    outputs.push(`${prefix}.contact.png（每 0.5 秒一格，评审用）`);
  }
  if (needGif) {
    const gif = path.join(outDir, `${prefix}.gif`);
    const width = Number(args["gif-width"] || P.gifWidth || 960);
    const maxMb = Number(args["max-mb"] || P.maxMb || 5);
    const gifFps = Number(args["gif-fps"] || P.gifFps || 15);
    const fit = await gifFromMp4(mp4, gif, { fps: gifFps, width, maxMb });
    if (fit.over) throw new Error(`${prefix}.gif exceeds ${maxMb} MiB after encoding; shorten the scene or lower its GIF dimensions`);
    outputs.push(`${prefix}.gif ${mb(fit.size)} MiB (${fit.width}px, ${gifFps} fps)`);
  }
  const warnings = await evaluate(session, "window.__promoWarnings || []").catch(() => []);
  log(`  ${prefix}：${P.width}×${P.height} @${scale}x、${P.duration}s；准备（加载 + 空跑）${prepSec}s、${needVideo ? `逐帧 ${total} 帧 ` : "截图 "}${((encodedAt - started) / 1000).toFixed(1)}s、出 GIF / 联系表 ${((Date.now() - encodedAt) / 1000).toFixed(1)}s${filmOnly ? "（只进总片）" : ""}`);
  for (const o of outputs) log(`    ✓ ${o}`);
  for (const w of warnings) log(`    ⚠ ${w}`);
  const after = await fingerprint(dir, dependencies);
  if (JSON.stringify(baseline) !== JSON.stringify(after)) throw new Error("Render inputs changed during capture; rerun the scene");
  const artifacts = needVideo ? [`${prefix}.mp4`, `${prefix}.contact.png`] : [];
  if (needVideo && !filmOnly) artifacts.push(`${prefix}.png`);
  if (needGif) artifacts.push(`${prefix}.gif`);
  return { routes, features, files: files.map(rel), fingerprint: after, artifacts };
}

/** 起一个渲染用的浏览器：装好真输入通道（--synthetic 关掉，动作全走合成事件） */
async function openRenderer(args) {
  const browser = await launch({ viewport: { width: 1280, height: 720 } });
  if (!args.synthetic) await installInputBridge(browser.session);
  return browser;
}

/**
 * 渲染一份物料。目录里是 scenes.js（多场景舞台）时，每个场景各出一套 GIF / MP4 / 海报（only: "film" 的只出 MP4），
 * 再把各场景的 MP4 按顺序拼成一支总片 <目录名>.mp4；--scene <id> 只渲那一个。
 * 场景之间互不依赖，--jobs N 开 N 个浏览器并行渲（默认最多 4 个）。
 */
async function render(dir, args) {
  const name = path.basename(dir);
  const base = (args.base || DEFAULT_BASE_URL).replace(/\/$/, "");
  await devServerUp(base);
  const outDir = path.join(dir, "out");
  await fs.mkdir(outDir, { recursive: true });

  const first = await openRenderer(args);
  let scenes;
  try {
    await setViewport(first.session, { width: 1280, height: 720, scale: 1 });
    await goto(first.session, `${base}/__promo/${name}/?render`);
    await waitReady(first.session);
    scenes = await evaluate(first.session, "(window.PROMO && window.PROMO.scenes) || null");
  } catch (e) {
    await first.close();
    throw e;
  }
  console.log(`渲染 ${rel(dir)}${scenes ? `：${scenes.length} 个场景` : ""}`);

  const metaFile = path.join(outDir, "meta.json");
  const previous = await fs.readFile(metaFile, "utf8").then(JSON.parse).catch((error) => {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  });
  const entries = args.scene ? { ...previous.scenes } : {};
  const staging = path.join(dir, `.render-${randomUUID()}`, "out");
  await fs.mkdir(staging, { recursive: true });
  const pending = new Map();
  try {
    const all = scenes || [{ id: name }];
    const ids = all.map((scene) => scene.id);
    if (new Set(ids).size !== ids.length) throw new Error("Scene IDs must be unique");
    const pick = args.scene ? all.filter((scene) => scene.id === args.scene) : all;
    if (!pick.length) throw new Error(`Unknown scene: ${args.scene}`);
    const jobs = Number(args.jobs ?? 4);
    if (!Number.isInteger(jobs) || jobs < 1) throw new Error("--jobs must be a positive integer");
    const browsers = [first];
    try {
      for (let i = 1; i < Math.min(pick.length, jobs); i += 1) browsers.push(await openRenderer(args));
      const queue = [...pick];
      const failures = [];
      await Promise.all(browsers.map(async ({ session }) => {
        for (let scene = queue.shift(); scene; scene = queue.shift()) {
          if (!/^[A-Za-z0-9_-]+$/.test(scene.id)) {
            failures.push(`${scene.id}: invalid scene ID`);
            continue;
          }
          const lines = [];
          try {
            const suffix = scenes ? `&scene=${encodeURIComponent(scene.id)}` : "";
            const result = await renderOne(session, `${base}/__promo/${name}/?render${suffix}`, {
              prefix: scene.id, dir, outDir: staging, args, filmOnly: scene.only === "film", log: (line) => lines.push(line),
            });
            pending.set(scene.id, result);
          } catch (error) {
            failures.push(`${scene.id}: ${error.message}`);
          }
          if (lines.length) console.log(lines.join("\n"));
        }
      }));
      if (failures.length) throw new Error(failures.join("\n"));
    } finally {
      await Promise.all(browsers.slice(1).map((browser) => browser.close()));
    }

    await moveArtifacts(staging, outDir);
    if (args.only === "stills") return; // Preview evidence does not change the video manifest.
    for (const [id, entry] of pending) entries[id] = entry;

    // A reel can only be assembled from scenes whose recorded inputs still match.
    const parts = [];
    for (const scene of all) {
      const entry = entries[scene.id];
      if (!entry || await staleScene(dir, entry)) break;
      const file = path.join(outDir, `${scene.id}.mp4`);
      parts.push([scene, file]);
    }
    let reel = null;
    if (parts.length > 1 && parts.length === all.length) {
      const list = path.join(staging, ".concat.txt");
      const line = ([scene, file]) => [
        `file '${file.replace(/'/g, "'\\''")}'`,
        ...(scene.film ? [`inpoint ${scene.film[0]}`, `outpoint ${scene.film[1]}`] : []),
      ].join("\n");
      await fs.writeFile(list, parts.map(line).join("\n"));
      reel = `${name}-reel.mp4`;
      const trimmed = parts.some(([scene]) => scene.film);
      await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list,
        ...(trimmed ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"] : ["-c", "copy"]),
        "-movflags", "+faststart", path.join(staging, reel)]);
      await fs.rename(path.join(staging, reel), path.join(outDir, reel));
    } else if (scenes && all.length > 1) {
      console.log("Reel not generated: one or more scenes need a fresh render.");
    }
    const temporary = path.join(staging, "meta.json");
    await fs.writeFile(temporary, JSON.stringify({ renderedAt: new Date().toISOString(), scenes: entries, reel }, null, 2) + "\n");
    await fs.rename(temporary, metaFile);
    console.log(`→ ${rel(outDir)}/`);
  } finally {
    await first.close();
    await fs.rm(path.dirname(staging), { recursive: true, force: true });
  }
}

async function moveArtifacts(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await moveArtifacts(source, target);
    else await fs.rename(source, target);
  }
}

async function staleScene(dir, entry) {
  const options = { ...entry.fingerprint.options, adapter: adapterName() };
  const current = await fingerprint(dir, { ...entry, files: entry.files.map((file) => path.resolve(REPO_ROOT, file)), options });
  if (current.unresolved.length) return `unmapped routes: ${current.unresolved.join(", ")}`;
  if (JSON.stringify(current) !== JSON.stringify(entry.fingerprint)) return "render inputs changed";
  for (const file of entry.artifacts) {
    if (!(await fs.stat(path.join(dir, "out", file)).then((stat) => stat.size > 0, () => false))) return `missing artifact: ${file}`;
  }
  return null;
}

async function status(_target, args) {
  const dirs = await fs.readdir(PROMO_DIR, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const entries = [];
  for (const { name } of dirs.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))) {
    const dir = path.join(PROMO_DIR, name);
    const meta = await fs.readFile(path.join(dir, "out", "meta.json"), "utf8").then(JSON.parse, () => null);
    if (!meta?.scenes) entries.push({ feature: name, status: "not-run" });
    else {
      const scenes = [];
      for (const [scene, entry] of Object.entries(meta.scenes)) {
        const reason = await staleScene(dir, entry);
        scenes.push({ feature: name, scene, status: reason ? "stale" : "current", ...(reason ? { reason } : {}) });
      }
      entries.push(...scenes);
      if (scenes.length > 1) {
        const current = meta.reel && scenes.every((scene) => scene.status === "current")
          && await fs.stat(path.join(dir, "out", meta.reel)).then((stat) => stat.size > 0, () => false);
        entries.push({ feature: name, artifact: "reel", status: current ? "current" : "stale",
          ...(current ? {} : { reason: "reel requires a fresh render of all inputs" }) });
      }
    }
  }
  if (args.json) console.log(JSON.stringify(entries, null, 2));
  else if (!entries.length) console.log("No promo recipes found.");
  else for (const entry of entries) console.log(`${entry.status}  ${entry.feature}${entry.scene || entry.artifact ? "/" + (entry.scene ?? entry.artifact) : ""}${entry.reason ? " — " + entry.reason : ""}`);
}

// ── main ───────────────────────────────────────────────────────────

const COMMANDS = { render, status };
const args = parseArgs(process.argv.slice(2));
const [command, target] = args._;
const allowedOptions = new Set(["_", "help", "base", "scene", "stills", "only", "scale", "gif-width", "gif-fps", "max-mb", "jobs", "synthetic", "json"]);
if (Object.keys(args).some((arg) => !allowedOptions.has(arg)) || (args.only && !["mp4", "stills"].includes(args.only))) {
  console.error("Unknown promo flag or invalid --only value");
  process.exit(2);
}
if (!command || args.help || command === "help") {
  console.log("builderharness promo render <docs/promo/KEY> [--base URL] [--scene ID] [--only stills|mp4] [--stills 0,2] | status [--json]");
  process.exit(0);
}
if (!Object.hasOwn(COMMANDS, command) || (command !== "status" && !target)) {
  console.error("用法：builderharness promo render <物料目录>  |  status");
  process.exit(1);
}
const dir = target ? path.resolve(target) : null;
if (dir && (path.dirname(dir) !== PROMO_DIR || !/^[A-Za-z0-9_-]+$/.test(path.basename(dir)))) {
  console.error(`Recipe must be a direct child of ${rel(PROMO_DIR)}`);
  process.exit(2);
}
COMMANDS[command](dir, args).then(() => {
  if (DEBUG) setTimeout(() => console.error("  [debug] 还活着的：", process.getActiveResourcesInfo().join(", ")), 3000).unref();
}, (e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
