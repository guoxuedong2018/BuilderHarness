import { openApp, setup, progress, fade, ease } from "/__promo/kit/kit.js";

/**
 * 产品价值片 starter · 多构图版
 * ------------------------------------------------------------------
 * 不是在同一页面上来回推拉，而是每 4–6 秒换一次构图：
 * 暗场标题 → 产品窗口 → 细节特写 → 浅色证据页 → 品牌结尾。
 *
 * 改这里：
 * - CONFIG.route / selectors
 * - SCENES 里的文案、背景、窗口位置
 * - index.html 里的品牌名、颜色、字体
 *
 * VO: 0.4–3.2  发布前，先看见偏差。
 * VO: 4.0–8.8  需求、页面、源码，放在同一条线上。
 * SFX: 3.5 cut / 9.5 click / 21.5 whoosh / 26.5 rise
 */

const CONFIG = {
  route: "/overview",
  width: 1280,
  height: 720,
  duration: 30,
  poster: 1.6,
  appViewport: { width: 1280, height: 900 },
  selectors: {
    pin: 'button[aria-label="Open review thread 2"]',
    review: "text=Live review surface",
    threads: "text=Review threads",
    queue: "text=Review queue",
    detail: "text=Content health",
  },
};

const SCENES = [
  {
    at: 0,
    end: 3.5,
    route: "/overview",
    waitFor: "h1",
    bg: "#101010",
    theme: "dark",
    kicker: "BUILDERHARNESS",
    headline: "发布前，<br>先看见<em>偏差</em>。",
    sub: "需求、页面、源码，放在同一条线上。",
    win: { x: 680, y: 156, w: 520, h: 380, focus: null, rotate: 2.0 },
  },
  {
    at: 3.5,
    end: 9.5,
    route: "/overview",
    waitFor: "h1",
    bg: "#f2efe8",
    theme: "light",
    kicker: "ONE CONTEXT",
    headline: "需求、页面、源码<br>一条线。",
    sub: "每一条反馈，都能回到它来自的地方。",
    compact: true,
    win: { x: 500, y: 72, w: 700, h: 572, focus: null, rotate: 0 },
  },
  {
    at: 9.5,
    end: 15.5,
    route: "/reviews",
    waitFor: "text=Review queue",
    bg: "#151515",
    theme: "dark",
    crop: true,
    kicker: "REVIEW",
    headline: "每条反馈，<br>都有<em>源码位置</em>。",
    sub: "点页面上的元素，Agent 拿到组件、文件和位置。",
    tag: "source · exact",
    win: { x: 520, y: 96, w: 680, h: 524, focus: CONFIG.selectors.queue, scale: 0.9, rotate: -1.2 },
  },
  {
    at: 15.5,
    end: 21.5,
    route: "/overview",
    waitFor: "h1",
    bg: "#f2efe8",
    theme: "light",
    crop: true,
    kicker: "CONTENT HEALTH",
    headline: "文档和截图，<br>不会悄悄过期。",
    sub: "引用一变，进入复核队列。",
    tag: "37 / 43 up to date",
    win: { x: 520, y: 96, w: 680, h: 524, focus: CONFIG.selectors.detail, scale: 0.9, rotate: 0.8 },
  },
  {
    at: 21.5,
    end: 26.5,
    route: "/experiments",
    waitFor: "text=Experiments",
    bg: "#f2efe8",
    theme: "light",
    kicker: "BUILDERHARNESS",
    headline: "让每一次迭代，<br>都有据可依。",
    sub: "从需求到发布，<br>留下可检查的上下文。",
    compact: true,
    win: { x: 560, y: 104, w: 620, h: 512, focus: null, rotate: 0 },
  },
  {
    at: 26.5,
    end: 30,
    bg: "#101010",
    theme: "dark",
    kicker: "",
    headline: "",
    sub: "",
    win: null,
  },
];

const W = CONFIG.width;
const H = CONFIG.height;
const PW = CONFIG.appViewport.width;
const PH = CONFIG.appViewport.height;
const brand = await fetch("./brand.json").then((r) => r.json()).catch(() => ({
  name: "BuilderHarness",
  tagline: "让每一次产品迭代，都有据可依。",
  meta: "需求 · 页面 · 源码 · 复核",
  logo: "./assets/logo.svg",
  colors: { ink: "#171717", paper: "#f2efe8", dark: "#101010", accent: "#e86a33", muted: "#6b6b6b" },
}));

const frame = document.querySelector("#app");
const stage = document.querySelector("#stage");
const windowEl = document.querySelector("#window");
const copy = document.querySelector("#copy");
const kicker = document.querySelector("#kicker");
const headline = document.querySelector("#headline");
const sub = document.querySelector("#sub");
const end = document.querySelector("#end");
const tag = document.querySelector("#tag");
const tagText = document.querySelector("#tagText");
const endLogo = document.querySelector("#endLogo");
const endMark = document.querySelector("#endMark");
const endLine = document.querySelector("#endLine");
const endMeta = document.querySelector("#endMeta");
const veil = document.querySelector("#veil");

document.documentElement.style.setProperty("--accent", brand.colors.accent);
document.documentElement.style.setProperty("--ink", brand.colors.ink);
document.documentElement.style.setProperty("--muted", brand.colors.muted);
document.title = brand.name;
endLogo.src = brand.logo;
endMark.textContent = brand.name;
endLine.textContent = brand.tagline;
endMeta.textContent = brand.meta;
for (const scene of SCENES) {
  if (scene.bg === "#f2efe8") scene.bg = brand.colors.paper;
  if (scene.bg === "#101010") scene.bg = brand.colors.dark;
}

frame.style.width = `${PW}px`;
frame.style.height = `${PH}px`;

const app = await openApp(frame, {
  route: CONFIG.route,
  async prepare(a) {
    a.css(`[data-review-ui], .bk-slot-bar { display: none !important; }`);
  },
});

const sceneAt = (t) => SCENES.find((s) => t >= s.at && t < s.end) || SCENES[SCENES.length - 1];
let lastScene = null;

function applyScene(scene) {
  stage.style.background = scene.bg;
  veil.style.background = scene.bg;
  copy.className = `copy ${scene.theme}${scene.compact ? " compact" : ""}`;
  kicker.textContent = scene.kicker === "BUILDERHARNESS" ? brand.name.toUpperCase() : scene.kicker;
  headline.innerHTML = scene.headline;
  sub.innerHTML = scene.sub;
  copy.style.width = scene.compact ? "400px" : "460px";
}

function placeWindow(win, t, scene) {
  if (!win) {
    windowEl.style.opacity = 0;
    return;
  }
  windowEl.style.opacity = 1;
  windowEl.classList.toggle("crop", !!scene.crop);
  windowEl.style.left = `${win.x}px`;
  windowEl.style.top = `${win.y}px`;
  windowEl.style.width = `${win.w}px`;
  windowEl.style.height = `${win.h}px`;

  const screenH = win.h - 30;
  let scale;
  let ox;
  let oy;

  if (win.focus) {
    const box = app.box(win.focus);
    scale = win.scale || 1.1;
    if (box) {
      ox = win.w / 2 - (box.x + box.w / 2) * scale;
      oy = screenH / 2 - (box.y + box.h / 2) * scale;
    } else {
      scale = win.w / PW;
      ox = 0;
      oy = (screenH - PH * scale) / 2;
    }
  } else {
    scale = win.w / PW;
    ox = 0;
    oy = (screenH - PH * scale) / 2;
  }

  ox = Math.min(0, Math.max(win.w - PW * scale, ox));
  oy = Math.min(0, Math.max(screenH - PH * scale, oy));
  frame.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;

  const settle = 0.985 + 0.015 * ease.out(progress(t, 0, 0.8));
  windowEl.style.transform = `rotate(${win.rotate || 0}deg) scale(${settle})`;
}

function render(t) {
  const scene = sceneAt(t);
  if (scene !== lastScene) {
    applyScene(scene);
    lastScene = scene;
  }

  placeWindow(scene.win, t, scene);

  const inP = progress(t, scene.at + 0.1, scene.at + 0.55);
  const outP = progress(t, scene.end - 0.3, scene.end - 0.05);
  const copyOpacity = Math.min(inP, 1 - outP);
  copy.style.opacity = scene.win ? copyOpacity : 0;
  copy.style.transform = `translateY(${(1 - inP) * 12}px)`;

  const close = progress(t, 26.4, 26.8);
  veil.style.opacity = scene.at >= 26.5 ? close : 0;
  end.style.opacity = scene.at >= 26.5 ? fade(t, 26.7, 27.2, 30, 30) : 0;
  end.style.transform = `translateY(${(1 - progress(t, 26.7, 27.2)) * 12}px)`;

  const tagIn = scene.tag ? Math.min(progress(t, scene.at + 0.7, scene.at + 1.1), 1 - progress(t, scene.end - 0.5, scene.end - 0.1)) : 0;
  tagText.textContent = scene.tag || "";
  tag.className = `tag${scene.theme === "dark" ? " dark" : ""}`;
  tag.style.opacity = tagIn;
}

const routeActions = SCENES.filter((s) => s.route).map((s) => [
  s.at,
  async (a) => {
    a.window.location.hash = s.route;
    await new Promise((r) => setTimeout(r, 60));
    await a.until(s.waitFor || "h1");
  },
]);

await setup({
  width: W,
  height: H,
  duration: CONFIG.duration,
  fps: 30,
  poster: CONFIG.poster,
  app,
  actions: routeActions,
  render,
});
