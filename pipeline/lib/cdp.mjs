/**
 * 零依赖 Chrome 驱动。
 *
 * 用本机已装的 Chrome + Chrome DevTools Protocol，不引 Playwright——受限的 npm 源
 * 禁掉了 playwright-core（403），而且这个仓库刻意保持依赖精简。Node 18 起内置
 * WebSocket，CDP 客户端只要百来行。
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadAdapter } from "./adapter.mjs";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of CHROME_CANDIDATES) {
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error(
    "找不到 Chrome。装一个 Chrome，或用 CHROME_PATH 指向可执行文件。",
  );
}

/**
 * 起一个隔离用户目录的 Chrome，返回 CDP 连接。
 *
 * `deviceScaleFactor` 走**命令行**而不是 `Emulation`，因为两者对录屏的效果不同：
 * `Page.startScreenRecording` 忽略 Emulation 的模拟 DPR（实测视口 1280×720 配
 * 模拟 scale=3，成片仍是 1280×720），但认命令行这个真实缩放。
 * 截图不受影响——`Page.captureScreenshot` 两种都认。
 */
export async function launch({ headless = true, viewport, deviceScaleFactor } = {}) {
  const binary = await findChrome();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "proto-shots-"));
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    // 独立 profile 下不共享本机登录态，避免把个人身份带进截图
    "--disable-sync",
    // 不碰系统钥匙串：截图用的是一次性 profile，没有要加密保存的东西；
    // 不加这条，环境一变（如换了 HOME）Chrome 就会去申请钥匙串授权、弹框打断人
    "--use-mock-keychain",
    `--window-size=${viewport.width},${viewport.height}`,
    ...(deviceScaleFactor ? [`--force-device-scale-factor=${deviceScaleFactor}`] : []),
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new", "--hide-scrollbars");

  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  let session;
  const close = async () => {
    session?.socket.close();
    child.kill();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  try {
    const endpoint = await readEndpoint(child);
    const target = await firstPageTarget(endpoint);
    session = await connect(target.webSocketDebuggerUrl);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await setViewport(session, viewport);
    return { session, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * 改视口。窄视口能让筛选区、描述列表这类横向铺开的区块换行，
 * 截出来的图不再是几十比一的长条，缩进表格后才点得开。
 *
 * `scale: 0` 表示**不覆盖**，沿用浏览器启动时的真实缩放——录屏要靠它，
 * 否则 Emulation 的模拟 DPR 会把录制表面按回 CSS 尺寸。
 */
export async function setViewport(session, { width, height, scale = 2 }) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
}

function readEndpoint(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Chrome 启动超时")), 20000);
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/ws:\/\/([^/\s]+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(`http://${match[1]}`);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Chrome 启动失败：${err.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome 退出，code=${code}`));
    });
  });
}

async function firstPageTarget(endpoint) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const list = await fetch(`${endpoint}/json/list`).then((r) => r.json()).catch(() => []);
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("拿不到 Chrome 的 page target");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    /** method → 回调集合。截图只用请求/响应，录屏要靠 Page.screencastFrame 事件 */
    const listeners = new Map();
    let seq = 0;

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      // CDP 事件没有 id，只有 method + params；原先这里被 `if (!waiter) return` 一并丢掉了
      if (message.id === undefined) {
        const fns = listeners.get(message.method);
        if (fns) for (const fn of fns) fn(message.params);
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("CDP 连接失败")));
    socket.addEventListener("open", () =>
      resolve({
        socket,
        send(method, params = {}) {
          seq += 1;
          const id = seq;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        /** 订阅 CDP 事件，返回取消订阅的函数 */
        on(method, fn) {
          if (!listeners.has(method)) listeners.set(method, new Set());
          listeners.get(method).add(fn);
          return () => listeners.get(method)?.delete(fn);
        },
      }),
    );
  });
}

// ---------------------------------------------------------------- 页面操作

/**
 * 在页面里跑一段表达式并取回值。
 * `awaitPromise` 让 `await` 能用，页面脚本里直接写异步逻辑。
 */
export async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

/**
 * 注入选择器帮手。选择器是用 `>>` 串起来的作用域链，每段可以是：
 *
 * - 原生 CSS —— 优先返回可见的那个。iView 的固定列表头与下拉浮层都会在 DOM 里
 *   留下同类名的隐藏副本，取第一个匹配经常拿到看不见的那份
 * - `text=文字` / `text*=片段` —— iView 的下拉项、页签与文字按钮大多没有稳定 class，
 *   按文字找比堆 nth-child 可靠；文案里嵌了条数这类变量时用 `text*=` 做包含匹配
 * - `field=标签` —— 按筛选项 / 表单项的标签文字定位整块字段
 *
 * 同一段文字在页面上出现多次时用作用域链消歧，例如「算法不可见」既是下拉选项
 * 又是每一行的行内标记，要写成 `.ivu-select-dropdown >> text=算法不可见`。
 */
export const SELECTOR_HELPER = `
// 用 getClientRects 而不是 offsetParent：固定定位的元素（批量操作条、下拉浮层）
// offsetParent 恒为 null，用它判可见会把这些元素全部漏掉。
window.__protoVisible = function (el) {
  return !!el && el.getClientRects().length > 0;
};
window.__protoSegment = function (scope, segment) {
  if (segment.indexOf('text=') === 0 || segment.indexOf('text*=') === 0) {
    const loose = segment.indexOf('text*=') === 0;
    const want = segment.slice(loose ? 6 : 5).trim();
    const hits = Array.from(scope.querySelectorAll('*')).filter(function (el) {
      if (!window.__protoVisible(el)) return false;
      const text = (el.textContent || '').trim();
      return loose ? text.indexOf(want) >= 0 : text === want;
    });
    // 优先取叶子节点，否则会命中包住它的一串容器
    const leaves = hits.filter(function (el) { return el.children.length === 0; });
    return (leaves.length ? leaves : hits)[0] || null;
  }
  if (segment.indexOf('field=') === 0) {
    const want = segment.slice(6).trim();
    const sel = window.__protoFieldSelector;
    if (!sel) return null;
    return Array.from(scope.querySelectorAll(sel.container)).find(function (el) {
      const label = el.querySelector(sel.label);
      return label && label.textContent.trim() === want;
    }) || null;
  }
  const all = Array.from(scope.querySelectorAll(segment));
  return all.find(window.__protoVisible) || all[0] || null;
};

window.__protoFind = function (selector) {
  return selector.split('>>').reduce(function (scope, segment) {
    return scope ? window.__protoSegment(scope, segment.trim()) : null;
  }, document);
};

`;

/**
 * 注入页面帮手：通用选择器 + 适配器提供的状态注入与语义选择器。
 *
 * 通用部分（`text=` / `text*=` / CSS / 作用域链）与框架无关；
 * `field=` 的落点和 `__protoSetState` 的实现由适配器给，引擎不认识框架。
 */
export async function installHelpers(session, { onNavigation = false } = {}) {
  const adapter = await loadAdapter();
  const source = [
    SELECTOR_HELPER,
    `window.__protoFieldSelector = ${JSON.stringify(adapter.fieldSelector)};`,
    adapter.stateInjector || "",
  ].join("\n");
  if (onNavigation) await session.send("Page.addScriptToEvaluateOnNewDocument", { source });
  else await evaluate(session, source);
}

/**
 * 翻页面组件的本地开关，用来拍没有自然入口的非成功态。
 * 具体怎么翻由适配器的 `stateInjector` 决定，引擎只负责调用与报错。
 */
export async function setState(session, patch) {
  const has = await evaluate(session, "typeof window.__protoSetState === \"function\"");
  if (!has) {
    throw new Error("页面上没有 __protoSetState——适配器没提供，或应用自己也没挂");
  }
  const reason = await evaluate(session, `window.__protoSetState(${JSON.stringify(patch)})`);
  if (reason) throw new Error(`翻不动状态开关：${reason.trim()}`);
}

export async function goto(session, url) {
  const result = await session.send("Page.navigate", { url });
  if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
  await waitForIdle(session);
}

/**
 * 应用编译不过时，dev 服务会在页面上盖一层报错遮罩。
 *
 * 抓取类脚本**必须在动手之前先探它**：遮罩不会让截图失败，只会让截图内容变成
 * 一屏红底报错文本，然后流程一路绿灯地把它当成配图存下来。2026-09-22 就这么
 * 拍废了整整 78 张，直到打开图才发现（见 DECISIONS 同日两条）。
 *
 * 放在 cdp 这一层而不是各脚本里：截图与录屏是同一类动作，判据也该是同一份。
 * 录屏那次是**碰巧**因为点击被遮罩挡住才挂掉的——换一条不需要点击的配方，
 * 它同样会安静地把遮罩录下来。
 *
 * @returns 有遮罩时返回编译错误原文（截断），没有时返回空字符串
 */
export async function errorOverlay(session) {
  return evaluate(
    session,
    `(() => {
      const ov = document.querySelector('vite-error-overlay');
      if (!ov) return '';
      const body = ov.shadowRoot && ov.shadowRoot.querySelector('.message-body');
      return (body ? body.textContent.trim() : '页面上有编译错误遮罩').slice(0, 200);
    })()`,
  );
}

/** 等 DOM 就绪且没有在途请求。hash 路由切换不触发 load，所以还要轮询 DOM 稳定。 */
async function waitForIdle(session, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let previous = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 120));
    const size = await evaluate(session, "document.body ? document.body.innerHTML.length : 0").catch(() => -1);
    if (size > 0 && size === previous) {
      stable += 1;
      if (stable >= 3) return;
    } else {
      stable = 0;
    }
    previous = size;
  }
}

/**
 * 轮询等一个选择器出现。浮层与批量操作条都是交互后才渲染的，
 * 固定 sleep 要么不够稳要么白等，一律改成等到为止。
 */
export async function waitFor(session, selector, timeout = 4000) {
  const deadline = Date.now() + timeout;
  do {
    const hit = await evaluate(session, `!!window.__protoFind(${JSON.stringify(selector)})`);
    if (hit) return true;
    await new Promise((r) => setTimeout(r, 120));
  } while (Date.now() < deadline);
  return false;
}

export async function click(session, selector) {
  if (!(await waitFor(session, selector))) throw new Error(`点不到 «${selector}»`);
  await evaluate(
    session,
    `(() => { const el = window.__protoFind(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      el.click(); })()`,
  );
}

export async function fill(session, selector, text) {
  if (!(await waitFor(session, selector))) throw new Error(`填不进 «${selector}»`);
  await evaluate(
    session,
    `(() => { const el = window.__protoFind(${JSON.stringify(selector)});
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(text)});
      else el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
}

/**
 * 往文件选择框里放本地文件，等同用户选中了这些文件（触发 change）。
 * 选择器按原生 CSS 取第一个——文件框多半是隐藏的，不走「优先可见」的查找
 */
export async function upload(session, selector, files) {
  const { root } = await session.send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`找不到文件框 «${selector}»`);
  await session.send("DOM.setFileInputFiles", { nodeId, files });
}

/**
 * 按键要带上 keyCode：只给 key 时 keyCode 是 0，CodeMirror 这类按 keyCode 认键的编辑器收不到
 * （如截图前把光标挪到某一行末尾：ArrowDown、End）
 */
const KEY_CODES = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };

export async function press(session, key) {
  const code = KEY_CODES[key];
  const extra = code ? { code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code } : {};
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key, ...extra });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key, ...extra });
}

/** 量一个元素的视口坐标，用于截图裁剪 */
export async function boundingBox(session, selector) {
  return evaluate(
    session,
    `(() => { const el = window.__protoFind(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
}

/**
 * 量元素里**实际有内容**的那块。
 *
 * 筛选区、chip 行、批量操作条都是全宽容器而内容只占左边一小段，按容器裁出来是
 * 1376×48 这种 30:1 的纸片，缩进表格的参考图列后只剩 2pt 高，在文档里根本点不开。
 * 这里取所有叶子后代（文字、图标、控件）的并集矩形，把右侧的空白切掉。
 */
export async function contentBox(session, selector) {
  return evaluate(
    session,
    `(() => { const el = window.__protoFind(${JSON.stringify(selector)});
      if (!el) return null;
      const outer = el.getBoundingClientRect();
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      const grow = function (r) {
        if (!r || r.width === 0 || r.height === 0) return;
        x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
        x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
      };
      // 文字节点得用 Range 量：像「共 60 条 · 13 条算法不可见」这种直接挂在容器下的
      // 文本不是元素，只遍历 element 会把它整段漏掉，裁出来只剩一个图标。
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.nodeValue && node.nodeValue.trim()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            grow(range.getBoundingClientRect());
          }
        } else if (node.children.length === 0) {
          // 无子元素的控件与图标（复选框、SVG、输入框）自身就是内容
          grow(node.getBoundingClientRect());
        }
        node = walker.nextNode();
      }
      if (!isFinite(x1)) return { x: outer.x, y: outer.y, width: outer.width, height: outer.height };
      // 不超出容器本身，避免绝对定位的子节点把范围拉飞
      x1 = Math.max(x1, outer.left); y1 = Math.max(y1, outer.top);
      x2 = Math.min(x2, outer.right); y2 = Math.min(y2, outer.bottom);
      return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }; })()`,
  );
}

/**
 * 截的是浮层（弹窗、抽屉）时，把蒙层垫成不透明。蒙层是半透明的，留白里透出后面的页面：
 * 后面列表的数据一变，这张浮层图明明一个字没改，也被判成「有变化」，框满了边（2026-10-08）。
 * 底下垫一层白再盖原来的灰，颜色与半透明盖在白底上时一样。
 */
export async function solidOverlayMask(session, selector) {
  return evaluate(
    session,
    `(() => { const el = window.__protoFind(${JSON.stringify(selector)});
      if (!el || !el.closest('.ivu-modal-wrap, .ivu-drawer-wrap, .ivu-modal, .ivu-drawer')) return false;
      const s = document.createElement('style');
      s.textContent = '.ivu-modal-mask,.ivu-drawer-mask{background:linear-gradient(rgba(55,55,55,.6),rgba(55,55,55,.6)),#fff!important;}';
      document.head.appendChild(s);
      return true; })()`,
  );
}

/** 等两帧真正画完：大块重排之后，无头 Chrome 偶尔会把上一帧的残块拼进截图 */
export const nextPaint = (session) =>
  evaluate(session, "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");

/**
 * 截图对象比视口高时，把视口加高到装得下它。
 *
 * 产品页的滚动在内部容器里（高度从视口一路链下来），文档本身只有一屏高：`captureBeyondViewport`
 * 扩不出文档之外的画面，超出视口的那一截截出来是空白。页面一变长（加了一块表单）图就悄悄坏掉，
 * 重拍也没用。视口一高，内部容器跟着长，内容就都在屏内了。
 * 铺满型的对象（列表卡片）会跟着视口一起长，所以最多试三轮，装下了就停。
 * @returns {Promise<{ height: number, grown: boolean }>}
 */
export async function fitViewport(session, selector, viewport, { max = 6000, measure = boundingBox } = {}) {
  let height = viewport.height;
  for (let round = 0; round < 3; round += 1) {
    const box = await measure(session, selector);
    if (!box) break;
    // 真的伸出视口才加高。按「贴近视口底边」就加的话，铺满型的列表卡片每张都会被抻高一截，重拍后全成了「有变化」
    const bottom = Math.ceil(box.y + box.height);
    if (bottom <= height || height >= max) break;
    height = Math.min(max, bottom + 24);
    await setViewport(session, { ...viewport, height });
    await nextPaint(session);
    await new Promise((r) => setTimeout(r, 300));
  }
  return { height, grown: height !== viewport.height };
}

/**
 * 截图对象被页面里的滚动区挡住了多少（上下合计，CSS 像素），以及挡住它的是谁。
 * 加高视口解决不了的（抽屉、弹窗里自带定高的滚动区）在这里露出来，拍完报给人，
 * 而不是悄悄交出一张半截图。
 * @returns {Promise<{ hidden: number, by: string } | null>}
 */
export async function hiddenByScroll(session, selector) {
  return evaluate(
    session,
    `(() => { const el = window.__protoFind(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      let top = r.top, bottom = r.bottom, by = '';
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowY)) continue;
        const pr = p.getBoundingClientRect();
        if ((pr.top > top + 1 || pr.bottom < bottom - 1) && !by) by = String(p.className || p.tagName).trim().split(/\\s+/)[0];
        top = Math.max(top, pr.top);
        bottom = Math.min(bottom, pr.bottom);
      }
      return { hidden: Math.max(0, Math.round(r.height - Math.max(0, bottom - top))), by }; })()`,
  );
}

/**
 * 截图。给了 clip 就只截那块；只有 clip 超出视口时才开 `captureBeyondViewport`——
 * 它会临时改画布尺寸，宽度跟着视口算、带 transition 的浮层会重新起动画，截到的是半截。
 * @returns {Buffer}
 */
export async function screenshot(session, { clip, scale = 2 } = {}) {
  const params = { format: "png", captureBeyondViewport: true };
  if (clip) {
    params.clip = { ...clip, scale };
    const { cssLayoutViewport: vp } = await session.send("Page.getLayoutMetrics");
    params.captureBeyondViewport = clip.x < 0 || clip.y < 0
      || clip.x + clip.width > vp.clientWidth || clip.y + clip.height > vp.clientHeight;
  }
  const { data } = await session.send("Page.captureScreenshot", params);
  return Buffer.from(data, "base64");
}
