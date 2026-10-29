const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { execFile, spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

/** Read a `BUILDERHARNESS_*` environment variable. */
function readEnv(name) {
  return process.env[`BUILDERHARNESS_${name}`] || "";
}

app.setName("BuilderHarness");

const KIT_ROOT = readEnv("KIT_ROOT") || (app?.isPackaged
  ? path.join(process.resourcesPath, "builderharness")
  : path.resolve(__dirname, "../.."));
const PROFILE = readEnv("DSH_PROFILE") || "web";
const HOST_BUNDLE = readEnv("HOST_BUNDLE") || (app?.isPackaged
  ? path.join(process.resourcesPath, "builderharness", "host")
  : path.resolve(__dirname, "../host"));
const CONFIG_FILE = () => path.join(app.getPath("userData"), "desktop.json");
const ONBOARDING = path.join(__dirname, "onboarding.html");

let child;
let window;

app.setName("BuilderHarness");
try {
  app.setPath("userData", path.join(app.getPath("appData"), "BuilderHarness"));
} catch {
  // Keep Electron's default when appData is unavailable.
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
  } catch {
    return { recent: [] };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), `${JSON.stringify(config, null, 2)}\n`);
}

function rememberProject(root) {
  const config = readConfig();
  const entry = {
    root,
    name: path.basename(root),
    lastUsed: new Date().toISOString(),
  };
  config.recent = [entry, ...(config.recent || []).filter((item) => item.root !== root)].slice(0, 8);
  config.lastProject = root;
  writeConfig(config);
  return config.recent;
}

async function isProject(root) {
  const checks = [
    "package.json", "docs",
    "builderharness.config.mjs", "builderharness.config.js", "builderharness.config.json",
  ];
  for (const name of checks) {
    try {
      await fs.promises.access(path.join(root, name));
      return true;
    } catch {
      // Try the next marker.
    }
  }
  return false;
}

function resolveDsh() {
  const candidates = [
    readEnv("DSH_BIN"),
    path.join(os.homedir(), ".npm-global", "bin", "dsh"),
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
    "dsh",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep)) return candidate;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return "dsh";
}

/**
 * `dsh plugin add file:` records the dependency but pnpm keeps the previously
 * copied bundle, so new files in the host package never reach the profile.
 * Re-syncing the tree on launch keeps the packaged app and local development on
 * the same code.
 */
function syncHostBundle() {
  const scope = path.join(os.homedir(), ".dsh", "profiles", PROFILE, "node_modules");
  const target = path.join(scope, "@builderharness", "dsh-bundle");
  if (!fs.existsSync(path.join(HOST_BUNDLE, "package.json"))) return false;
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(HOST_BUNDLE, target, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  });
  return true;
}

function ensureProfileBundle() {
  const profileDir = path.join(os.homedir(), ".dsh", "profiles", PROFILE);
  const profilePkgFile = path.join(profileDir, "package.json");
  let declared = false;
  try {
    const profilePkg = JSON.parse(fs.readFileSync(profilePkgFile, "utf8"));
    declared = Boolean(profilePkg.dependencies?.["@builderharness/dsh-bundle"]);
  } catch {
    // A missing profile is created by the plugin command below.
  }
  if (!declared) {
    const result = spawnSync(resolveDsh(), ["plugin", "--profile", PROFILE, "add", `file:${HOST_BUNDLE}`], {
      encoding: "utf8",
      env: { ...process.env },
    });
    if (result.status !== 0) {
      console.warn(`[builderharness-desktop] profile install failed: ${(result.stderr || result.stdout || "").trim()}`);
      return;
    }
  }
  try {
    syncHostBundle();
  } catch (error) {
    console.warn(`[builderharness-desktop] bundle sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stopHarness() {
  if (child && !child.killed) child.kill("SIGTERM");
  child = undefined;
}

function projectSettingsFile(root) {
  return path.join(root, ".builderharness", "desktop.json");
}

function readProjectSettings(root) {
  try {
    return JSON.parse(fs.readFileSync(projectSettingsFile(root), "utf8"));
  } catch {
    return {};
  }
}

function writeProjectSettings(root, patch) {
  const current = readProjectSettings(root);
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(projectSettingsFile(root)), { recursive: true });
  fs.writeFileSync(projectSettingsFile(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function kitEnv(root) {
  const settings = readProjectSettings(root);
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    BUILDERHARNESS_ROOT: root,
    BUILDERHARNESS_KIT_ROOT: KIT_ROOT,
    ...(settings.publishGateway ? { BUILDERHARNESS_PUBLISH_GATEWAY: settings.publishGateway } : {}),
  };
}

async function runKit(root, args, timeout = 120_000) {
  const bin = path.join(KIT_ROOT, "bin", "builderharness.mjs");
  try {
    const result = await execFileAsync(process.execPath, [bin, ...args], {
      cwd: root,
      env: kitEnv(root),
      maxBuffer: 30 * 1024 * 1024,
      timeout,
    });
    return { ok: true, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return {
      ok: false,
      output: [error.stdout, error.stderr].filter(Boolean).join("\n").trim() || error.message,
    };
  }
}




function featureStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function featureSlug(title) {
  const ascii = String(title || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "FEATURE";
}

async function copyDirectory(from, to) {
  await fs.promises.mkdir(to, { recursive: true });
  for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDirectory(src, dst);
    else if (entry.isFile()) await fs.promises.copyFile(src, dst);
  }
}

async function createFeature(root, title) {
  const project = path.resolve(root);
  const safeTitle = String(title || "").trim();
  if (!safeTitle) throw new Error("先填功能名称。");
  const key = `${featureStamp()}_${featureSlug(safeTitle)}`;
  const featureDir = path.join(project, "docs", "features", key);
  try {
    await fs.promises.access(featureDir);
    throw new Error(`需求件套已存在：${path.relative(project, featureDir)}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const templates = fs.existsSync(path.join(project, "docs", "templates"))
    ? path.join(project, "docs", "templates")
    : path.join(KIT_ROOT, "docs", "templates");
  if (!fs.existsSync(templates)) throw new Error("找不到 FRS 模板；先运行 npx builderharness init。");
  await copyDirectory(templates, featureDir);
  const replace = async (name) => {
    const file = path.join(featureDir, name);
    const text = await fs.promises.readFile(file, "utf8");
    await fs.promises.writeFile(
      file,
      text
        .replaceAll("<功能名称>", safeTitle)
        .replaceAll("<ID>_MODULE_NAME", key)
        .replaceAll("MMDDHHMM_MODULE_NAME", key)
        .replaceAll("YYYY-MM-DD", new Date().toISOString().slice(0, 10)),
    );
  };
  for (const name of ["README.md", "FLOW.md", "STATE.md", "ACCEPTANCE.md"]) await replace(name);
  const frsFile = path.join(featureDir, "FRS.json");
  const frs = JSON.parse(await fs.promises.readFile(frsFile, "utf8"));
  frs.key = key;
  frs.title = safeTitle;
  frs.createdAt = new Date().toISOString().slice(0, 10);
  frs.updatedAt = frs.createdAt;
  await fs.promises.writeFile(frsFile, `${JSON.stringify(frs, null, 2)}\n`);
  return {
    key,
    path: featureDir,
    relativePath: path.relative(project, featureDir),
    checkCommand: `npx builderharness check-frs ${key}`,
  };
}

const PREFERRED_PORT = Number(readEnv("DSH_PORT") || 43117);

/**
 * A random DSH port changes the browser origin on every launch, which wipes
 * localStorage: remembered stage, skipped guide and last workspace would all
 * reset. Prefer a stable port and only fall back to an ephemeral one on
 * conflicts.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function startHarness(projectRoot) {
  stopHarness();
  const dsh = resolveDsh();
  const port = (await isPortFree(PREFERRED_PORT)) ? PREFERRED_PORT : 0;
  console.log(`[builderharness-desktop] profile=${PROFILE} dsh=${dsh} project=${projectRoot} port=${port}`);
  child = spawn(dsh, ["--profile", PROFILE, "--no-open", "--port", String(port)], {
    cwd: projectRoot,
    env: { ...kitEnv(projectRoot) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopHarness();
      reject(new Error(`DeepSeek Harness 没有在 30 秒内启动：\n${output}`));
    }, 30_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/https?:\/\/[^\s]+/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(`[builderharness-desktop] loading ${match[0]}`);
      resolve(match[0]);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("exit", (code) => {
      if (code && !output.match(/https?:\/\//) && !settled) {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`DeepSeek Harness 退出（${code}）：\n${output}`));
      }
    });
  });
}

async function loadHarness(projectRoot) {
  const root = path.resolve(projectRoot);
  if (!(await isProject(root))) {
    throw new Error("这个目录不像一个项目：需要 package.json、docs/ 或 builderharness.config.*。");
  }
  ensureProfileBundle();
  const url = await startHarness(root);
  rememberProject(root);
  await window.loadURL(url);
  window.setTitle("BuilderHarness");
  try {
    await openProjectInUi(root);
  } catch (error) {
    console.warn(`[builderharness-desktop] workspace selection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openProjectInUi(root) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await window.webContents
      .executeJavaScript("Boolean(window.__builderHarnessDesktop?.openProject)")
      .catch(() => false);
    if (ready) {
      await window.webContents.executeJavaScript(
        `window.__builderHarnessDesktop.openProject(${JSON.stringify(root)})`,
        true,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn("[builderharness-desktop] BuilderHarness client helper did not load; open the workspace manually.");
}

async function walkFiles(dir, predicate) {
  const out = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full, predicate)));
    else if (predicate(full, entry.name)) out.push(full);
  }
  return out;
}

function detectStack(pkg = {}) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = (name) => Boolean(deps[name]);
  const frameworks = [];
  if (has("next")) frameworks.push("Next.js");
  if (has("react")) frameworks.push("React");
  if (has("vue")) frameworks.push("Vue");
  if (has("svelte")) frameworks.push("Svelte");
  if (has("tailwindcss")) frameworks.push("Tailwind");
  if (has("vite")) frameworks.push("Vite");
  return {
    id: has("next") ? "next" : has("vue") ? "vue" : has("react") ? "react" : "unknown",
    label: frameworks.length ? frameworks.join(" + ") : "未识别",
    frameworks,
  };
}

async function scanProjects(root, depth = 0, out = []) {
  if (out.length >= 30 || depth > 4) return out;
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((entry) => entry.name === "package.json")) {
    try {
      const pkg = JSON.parse(await fs.promises.readFile(path.join(root, "package.json"), "utf8"));
      const stat = await fs.promises.stat(root);
      if (!/node_modules|\.git/.test(root)) {
        out.push({
          root,
          name: pkg.name || path.basename(root),
          stack: detectStack(pkg),
          devScript: pkg.scripts?.dev ?? null,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    } catch {
      // Ignore malformed package.json.
    }
  }
  for (const entry of entries) {
    if (out.length >= 30) break;
    if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
    await scanProjects(path.join(root, entry.name), depth + 1, out);
  }
  return out;
}

async function analyzeWebUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("请输入完整的 http(s) 网页地址。");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支持 http/https 网页。");
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`网页返回 ${response.status}。`);
  const html = await response.text();
  const evidence = [];
  const frameworks = [];
  const add = (name, pattern) => { if (pattern.test(html)) { frameworks.push(name); evidence.push(`${name}: ${pattern}`); } };
  add("Next.js", /__NEXT_DATA__|_next\//i);
  add("React", /data-reactroot|react-dom|reactjs/i);
  add("Vue", /data-v-|vue\.js|vue@/i);
  add("Svelte", /svelte-|__svelte/i);
  add("Tailwind", /tailwind|--tw-/i);
  add("Vite", /\/@vite\/|vite\/client/i);
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || url.hostname;
  const styleLinks = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], url).href)
    .slice(0, 3);
  const colors = new Set();
  const fonts = new Set();
  const consumeCss = (css) => {
    for (const match of css.matchAll(/#[0-9a-f]{6}\b/gi)) colors.add(match[0].toLowerCase());
    for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) fonts.add(match[1].trim().slice(0, 100));
    for (const match of css.matchAll(/--[a-z0-9-]+\s*:\s*([^;}]+)/gi)) {
      const value = match[1].trim();
      if (/^#[0-9a-f]{3,8}$/i.test(value)) colors.add(value.toLowerCase());
    }
  };
  consumeCss(html);
  for (const link of styleLinks) {
    try {
      const css = await fetch(link, { signal: AbortSignal.timeout(8_000) }).then((res) => res.text());
      consumeCss(css);
    } catch {
      // A single stylesheet failure should not fail the analysis.
    }
  }
  return {
    url: url.href,
    title,
    frameworks: [...new Set(frameworks)],
    stack: { id: frameworks.includes("Vue") ? "vue" : frameworks.includes("React") ? "react" : "unknown", label: [...new Set(frameworks)].join(" + ") || "未识别" },
    ui: { colors: [...colors].slice(0, 24), fonts: [...fonts].slice(0, 8), hasTailwind: /tailwind|--tw-/i.test(html) },
    evidence: evidence.slice(0, 8),
  };
}

async function inspectProject(root) {
  let project = path.resolve(root);
  try {
    if ((await fs.promises.stat(project)).isFile()) project = path.dirname(project);
  } catch {
    // Missing paths are reported by the project-marker check below.
  }
  if (!(await isProject(project))) {
    throw new Error("这个目录不像一个项目：需要 package.json、docs/ 或 builderharness.config.*。");
  }
  const pkgFile = path.join(project, "package.json");
  let pkg = {};
  try {
    pkg = JSON.parse(await fs.promises.readFile(pkgFile, "utf8"));
  } catch {
    // A docs-only project is still inspectable.
  }
  const featureDir = path.join(project, "docs", "features");
  const features = [];
  try {
    for (const entry of await fs.promises.readdir(featureDir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(featureDir, entry.name, "FRS.json"))) features.push(entry.name);
    }
  } catch {
    // No feature specs yet.
  }
  const kbFiles = await walkFiles(path.join(project, "docs", "kb"), (_full, name) => name.endsWith(".md"));
  const reviewFiles = await walkFiles(path.join(project, "docs", "reviews"), (_full, name) => name.endsWith(".json"));
  let openReviews = 0;
  for (const file of reviewFiles) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(file, "utf8"));
      const comments = Array.isArray(parsed) ? parsed : parsed.comments;
      if (Array.isArray(comments)) openReviews += comments.filter((comment) => comment?.status !== "resolved").length;
    } catch {
      // Ignore malformed local review files in the launcher.
    }
  }
  const settings = readProjectSettings(project);
  const gateway = settings.publishGateway || readEnv("PUBLISH_GATEWAY") || null;
  const docsCli = readEnv("DOCS_CLI") || null;
  let publishedPages = 0;
  try {
    const published = JSON.parse(await fs.promises.readFile(path.join(project, "docs", "kb", "_published.json"), "utf8"));
    publishedPages = Object.keys(published.pages || {}).length;
  } catch {
    // Publishing has not run yet.
  }
  return {
    root: project,
    name: path.basename(project),
    devScript: pkg.scripts?.dev ?? null,
    stack: detectStack(pkg),
    setup: {
      stack: settings.stack ?? null,
      uiPreset: settings.uiPreset ?? null,
      sourceUrl: settings.sourceUrl ?? null,
      analysis: settings.analysis ?? null,
    },
    features: features.sort(),
    stageHistory: settings.stageHistory && typeof settings.stageHistory === "object" ? settings.stageHistory : {},
    kbPages: kbFiles.length,
    openReviews,
    publish: {
      configured: Boolean(gateway || docsCli),
      destination: gateway || (docsCli ? "docs-cli" : null),
      publishedPages,
    },
    templates: fs.existsSync(path.join(project, "docs", "templates")),
    workflow: fs.existsSync(path.join(project, "docs", "WORKFLOW.md")),
    skills: fs.existsSync(path.join(project, ".agent", "skills")),
  };
}

function resolveInsideRoot(root, relative = "") {
  const base = path.resolve(root);
  const target = path.resolve(base, relative || ".");
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("路径超出项目目录。");
  return target;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "BuilderHarness",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: "#f7f4ec",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      webviewTag: true,
    },
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle("BuilderHarness");
  });
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    let target;
    try {
      target = new URL(params.src);
    } catch {
      event.preventDefault();
      return;
    }
    if (!["http:", "https:"].includes(target.protocol)) event.preventDefault();
  });
  window.loadFile(ONBOARDING);
}

function sendMenuCommand(command) {
  if (window && !window.isDestroyed()) window.webContents.send("builderharness:menu", command);
}

async function openProjectFromMenu() {
  const result = await dialog.showOpenDialog(window, {
    title: "导入已有开发项目",
    properties: ["openDirectory"],
  });
  if (result.canceled) return;
  const root = result.filePaths[0];
  if (!(await isProject(root))) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "BuilderHarness",
      message: "这个目录不像一个项目",
      detail: "需要 package.json、docs/ 或 builderharness.config.*。",
    });
    return;
  }
  await loadHarness(root);
}

async function showProjectPicker(command) {
  stopHarness();
  await window.loadFile(ONBOARDING);
  if (command) sendMenuCommand(command);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{
          label: "BuilderHarness",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }]
      : []),
    {
      label: "文件",
      submenu: [
        { label: "导入项目…", accelerator: "CmdOrCtrl+O", click: () => openProjectFromMenu().catch((error) => dialog.showErrorBox("BuilderHarness", error.message)) },
        { label: "新建项目…", accelerator: "CmdOrCtrl+N", click: () => showProjectPicker("new-project").catch((error) => dialog.showErrorBox("BuilderHarness", error.message)) },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : []),
      ],
    },
    {
      role: "help",
      submenu: [
        { label: "BuilderHarness 仓库", click: () => shell.openExternal("https://github.com/guoxuedong2018/BuilderHarness") },
        { label: "报告问题", click: () => shell.openExternal("https://github.com/guoxuedong2018/BuilderHarness/issues") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("builderharness:recent", () => readConfig());
ipcMain.handle("builderharness:choose-parent", async () => {
  const result = await dialog.showOpenDialog(window, {
    title: "选择项目所在目录",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("builderharness:choose-existing", async () => {
  const result = await dialog.showOpenDialog(window, {
    title: "导入已有开发项目",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  const root = result.filePaths[0];
  if (!(await isProject(root))) throw new Error("这个目录不像一个项目：需要 package.json、docs/ 或 builderharness.config.*。");
  return root;
});
ipcMain.handle("builderharness:create-project", async (_event, { parent, name }) => {
  const safeName = String(name || "").trim();
  if (!safeName || /[\\/:*?"<>|]/.test(safeName) || safeName.startsWith(".")) {
    throw new Error("项目名不能为空，也不能包含 \\ / : * ? \" < > |，或从 . 开头。");
  }
  const root = path.join(parent, safeName);
  try {
    const entries = await fs.promises.readdir(root);
    if (entries.length) throw new Error(`目录已经存在且不为空：${root}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.promises.mkdir(root, { recursive: true });
  const bin = path.join(KIT_ROOT, "bin", "builderharness.mjs");
  const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", BUILDERHARNESS_KIT_ROOT: KIT_ROOT };
  await execFileAsync(process.execPath, [bin, "init", "--scaffold", "--target", root], {
    cwd: root,
    env: nodeEnv,
    maxBuffer: 20 * 1024 * 1024,
  });
  await execFileAsync(process.execPath, [bin, "kb-scaffold"], {
    cwd: root,
    env: { ...nodeEnv, BUILDERHARNESS_ROOT: root },
    maxBuffer: 20 * 1024 * 1024,
  }).catch(() => {
    // The outline is optional; project creation should still succeed.
  });
  const starter = path.join(KIT_ROOT, "scaffold", "starter");
  if (fs.existsSync(starter)) await copyDirectory(starter, root);
  const { configureStarterProject } = await import("./starter-project.mjs");
  await configureStarterProject({ root, kitRoot: KIT_ROOT, name: safeName });
  return root;
});
ipcMain.handle("builderharness:choose-scan-root", async () => {
  const result = await dialog.showOpenDialog(window, {
    title: "授权 Agent 搜索本地项目",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("builderharness:scan-projects", async (_event, root) => {
  const projects = (await scanProjects(root)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { root, projects };
});
ipcMain.handle("builderharness:start", async (_event, root) => {
  try {
    await loadHarness(root);
    return { ok: true };
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "BuilderHarness",
      message: "无法打开项目",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});
ipcMain.on("builderharness:quit", () => app.quit());

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "assets", "icon.png"));
  }
  buildMenu();
  createWindow();
  const lastProject = readConfig().lastProject;
  if (lastProject) {
    window.webContents.once("did-finish-load", async () => {
      if (!(await isProject(lastProject).catch(() => false))) return;
      await window.webContents
        .executeJavaScript(
          `document.getElementById("overlay").hidden = false; document.getElementById("overlay-title").textContent = "正在恢复上次工作区"; document.getElementById("overlay-detail").textContent = "启动 DeepSeek Harness…";`,
        )
        .catch(() => {});
      loadHarness(lastProject).catch(async (error) => {
        console.warn(`[builderharness-desktop] restore failed: ${error instanceof Error ? error.message : String(error)}`);
        await window.loadFile(ONBOARDING).catch(() => {});
        await dialog.showMessageBox(window, {
          type: "error",
          title: "BuilderHarness",
          message: "无法打开上次项目",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  stopHarness();
});
