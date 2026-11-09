import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { boundingBox, click, errorOverlay, evaluate, findChrome, goto, installHelpers, launch, screenshot, setViewport, waitFor } from "./cdp.mjs";
import { DOCS_DIR, KIT_ROOT, PROJECT_CONFIG } from "./paths.mjs";

const safeName = (name) => typeof name === "string" && /^[A-Za-z0-9_-]+$/.test(name);
const viewport = { width: 1280, height: 800 };
const templateRoot = path.join(KIT_ROOT, "promo", "templates");

export const hasTool = (name) => spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0;
export const hasGifski = () => spawnSync("gifski", ["--version"], { stdio: "ignore" }).status === 0;

export async function doctor(_dir, args) {
  const chrome = await findChrome().catch(() => null);
  const ffmpeg = hasTool("ffmpeg");
  const gifski = hasGifski();
  const result = { chrome, ffmpeg, gifski, gifEncoder: gifski ? "gifski" : ffmpeg ? "ffmpeg" : null };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Chrome: ${chrome ?? "missing (set CHROME_PATH)"}`);
    console.log(`FFmpeg: ${ffmpeg ? "ready" : "missing"}`);
    console.log(`GIF encoder: ${result.gifEncoder ?? "unavailable"}`);
  }
  if (!chrome || !ffmpeg) process.exitCode = 1;
}

export async function init(dir, args) {
  const name = args.template ?? "scene";
  if (!["scene", "product-film"].includes(name)) throw new Error("Choose --template scene or product-film");
  await mkdir(path.dirname(dir), { recursive: true });
  await mkdir(dir); // Existing recipes and user assets are never overwritten.
  try {
    await cp(path.join(templateRoot, name), dir, { recursive: true });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  console.log(`Created ${dir}. Edit routes and selectors, then run builderharness promo render ${dir}`);
}

export async function sound(dir, args) {
  const video = args.video ? path.resolve(args.video) : path.join(dir, "out", `${path.basename(dir)}.mp4`);
  const out = args.out ? path.resolve(args.out) : path.join(dir, "out", args["audio-only"] ? "soundtrack.m4a" : `${path.basename(dir)}-scored.mp4`);
  const script = path.join(templateRoot, "product-film", "sound-design.mjs");
  if (out === video && !args["audio-only"]) throw new Error("Choose a distinct output file");
  const config = args.config ? path.resolve(args.config) : path.join(dir, "sound.config.json");
  const result = spawnSync(process.execPath, [script, "--config", config, "--video", video, "--out", out,
    ...(args["audio-only"] ? ["--audio-only"] : [])], { cwd: dir, stdio: "inherit" });
  if (result.status !== 0) throw new Error(result.error?.message ?? "Audio synthesis failed");
}

function textureUrl(definition, base, allowExternal) {
  const origin = new URL(base);
  const route = definition.route;
  if (!definition.url && (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.includes("\\"))) {
    throw new Error("A texture requires a local route or explicit HTTP(S) URL");
  }
  const url = definition.url ? new URL(definition.url)
    : new URL(PROJECT_CONFIG.routeMode === "history" ? route : "/", origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) URL without embedded credentials");
  if (url.origin !== origin.origin && !allowExternal) throw new Error("Use --allow-external for a different origin");
  if (url.origin === origin.origin) {
    if (!definition.url && PROJECT_CONFIG.routeMode !== "history") url.hash = route;
    url.searchParams.set("promo", "1");
    url.searchParams.set("shot", "texture");
  }
  return url.href;
}

export async function capture(dir, args, fallbackBase) {
  const config = (await import(pathToFileURL(path.join(dir, "promo.config.mjs")).href)).default;
  const base = args.base || config.baseUrl || fallbackBase;
  const requests = Object.entries(config.textures ?? {}).map(([name, def]) => {
    if (!safeName(name)) throw new Error(`Invalid texture name: ${name}`);
    return { name, def, url: textureUrl(def, base, args["allow-external"] === true) };
  });
  if (!requests.length) throw new Error("Define textures in promo.config.mjs");
  const temp = await mkdtemp(path.join(dir, ".render-textures-"));
  const layout = {};
  let browser;
  try {
    browser = await launch({ viewport });
    const { session } = browser;
    await installHelpers(session, { onNavigation: true });
    for (const { name, def, url } of requests) {
      const frame = { ...viewport, ...def.viewport, scale: def.scale ?? 2 };
      if (![frame.width, frame.height, frame.scale].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`${name}: invalid viewport`);
      await setViewport(session, frame);
      const page = new URL(url);
      // Nonce forces a fresh document for two fixtures on the same hash-routed page.
      if (page.origin === new URL(base).origin) page.searchParams.set("shot", `texture-${name}`);
      await goto(session, page.href);
      const loaded = await evaluate(session, "location.origin");
      if (loaded !== page.origin) throw new Error(`${name}: unexpected cross-origin redirect`);
      const broken = await errorOverlay(session);
      if (broken) throw new Error(`${name}: ${broken}`);
      await evaluate(session, `(() => {
        const sheet = document.createElement('style');
        sheet.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.bk-root,.review-bar{display:none!important}';
        document.head.appendChild(sheet);
      })()`);
      for (const step of [...(def.steps ?? []), ...(def.waitFor ? [{ waitFor: def.waitFor }] : [])]) {
        if (step.click) await click(session, step.click);
        if (step.waitFor && !(await waitFor(session, step.waitFor, step.timeout ?? 6000))) throw new Error(`${name}: missing ${step.waitFor}`);
        if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
      }
      const finalUrl = new URL(await evaluate(session, "location.href"));
      if (finalUrl.origin !== page.origin) throw new Error(`${name}: a capture step left the permitted origin`);
      await evaluate(session, "Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]).then(() => true)");
      const marks = {};
      for (const [key, selector] of Object.entries(def.marks ?? {})) {
        const box = await boundingBox(session, selector);
        if (!box?.width || !box?.height) throw new Error(`${name}: cannot locate ${key} (${selector})`);
        marks[key] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
      }
      const file = `${name}.png`;
      await writeFile(path.join(temp, file), await screenshot(session, { scale: frame.scale }));
      layout[name] = { file, width: frame.width, height: frame.height, scale: frame.scale, marks };
    }
    await writeFile(path.join(temp, "layout.json"), JSON.stringify(layout, null, 2) + "\n");
    const out = path.join(dir, "textures");
    await mkdir(out, { recursive: true });
    for (const file of await readdir(temp)) await rename(path.join(temp, file), path.join(out, file));
    console.log(`Captured ${requests.length} textures in ${path.relative(DOCS_DIR, out)}`);
  } finally {
    await browser?.close();
    await rm(temp, { recursive: true, force: true });
  }
}
