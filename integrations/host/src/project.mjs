import { promises as fs } from "node:fs";
import path from "node:path";
import { readEnv } from "./env.mjs";
import { detectPrototype } from "./prototype.mjs";
import { readTaskContext } from "./task-context.mjs";

const MAX_SCAN_FILES = 400;
const MAX_CONTEXT_FILES = 20;
const MAX_EXCERPT = 700;

export function resolveRoot(input) {
  return path.resolve(input || readEnv("ROOT") || process.cwd());
}

async function statSafe(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

async function walk(dir, predicate, limit = MAX_SCAN_FILES) {
  const out = [];
  async function visit(current) {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") await visit(full);
      } else if (predicate(full, entry.name)) {
        out.push(full);
      }
    }
  }
  await visit(dir);
  return out;
}

function titleOf(text, file) {
  const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontMatter) {
    const title = frontMatter[1].match(/^title:\s*(.+)$/m);
    if (title) return title[1].replace(/^["']|["']$/g, "").trim();
  }
  const heading = text.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(file, path.extname(file));
}

function excerptOf(text) {
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, MAX_EXCERPT);
}

async function readComments(file) {
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.comments)) return parsed.comments;
  throw new Error(`Unrecognized review file: ${file}`);
}

export async function addReview(inputRoot, { frs = "APP_SHELL", route = "/", body, author = "BuilderHarness Agent", anchor = null } = {}) {
  const root = resolveRoot(inputRoot);
  const text = String(body || "").trim();
  if (!text) throw new Error("review body is required");
  const dir = path.join(root, "docs", "reviews");
  await fs.mkdir(dir, { recursive: true });
  const safe = String(frs || "APP_SHELL").replace(/[^a-zA-Z0-9_-]/g, "_");
  const file = path.join(dir, `${safe}.json`);
  const comments = (await statSafe(file)) ? await readComments(file) : [];
  const comment = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    frs: safe,
    route: String(route || "/"),
    anchor: anchor ? { loc: String(anchor) } : undefined,
    body: text,
    author: String(author || "BuilderHarness Agent"),
    status: "open",
    createdAt: new Date().toISOString(),
    replies: [],
  };
  comments.push(comment);
  await writeJson(file, comments);
  return { file: path.relative(root, file), comment };
}

export async function resolveReview(inputRoot, { id, note = "", author = "BuilderHarness Agent" } = {}) {
  const root = resolveRoot(inputRoot);
  const target = String(id || "").trim();
  if (!target) throw new Error("review id is required");
  const dir = path.join(root, "docs", "reviews");
  const files = (await statSafe(dir)) ? await walk(dir, (_full, name) => name.endsWith(".json")) : [];
  for (const file of files) {
    const comments = await readComments(file).catch(() => null);
    if (!comments) continue;
    const comment = comments.find((item) => item && item.id === target);
    if (!comment) continue;
    const changed = comment.status !== "resolved" || String(note || "").trim();
    if (changed) {
      comment.status = "resolved";
      comment.resolvedAt = new Date().toISOString();
      if (String(note || "").trim()) {
        comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
        comment.replies.push({ author: String(author || "BuilderHarness Agent"), body: String(note).trim(), at: comment.resolvedAt });
      }
      await writeJson(file, comments);
    }
    return { file: path.relative(root, file), comment };
  }
  throw new Error(`review not found: ${target}`);
}

async function writeJson(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

async function reviewSummary(root) {
  const dir = path.join(root, "docs", "reviews");
  const files = (await statSafe(dir)) ? await walk(dir, (_full, name) => name.endsWith(".json")) : [];
  const comments = [];
  const errors = [];
  for (const file of files) {
    try {
      comments.push(...(await readComments(file)).filter(Boolean));
    } catch (error) {
      errors.push({ file: path.relative(root, file), error: error instanceof Error ? error.message : String(error) });
    }
  }
  const open = comments.filter((comment) => comment.status !== "resolved");
  return { files: files.length, comments: comments.length, open: open.length, errors };
}

async function featureSummary(root) {
  const dir = path.join(root, "docs", "features");
  if (!(await statSafe(dir))) return { specs: 0, keys: [] };
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const keys = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await statSafe(path.join(dir, entry.name, "FRS.json"))) keys.push(entry.name);
  }
  return { specs: keys.length, keys: keys.sort() };
}

export async function readStatus(inputRoot) {
  const root = resolveRoot(inputRoot);
  const kbDir = path.join(root, "docs", "kb");
  const kbFiles = (await statSafe(kbDir)) ? await walk(kbDir, (_full, name) => name.endsWith(".md")) : [];
  const pages = [];
  for (const file of kbFiles.slice(0, MAX_SCAN_FILES)) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    pages.push({ file: path.relative(kbDir, file), title: titleOf(text, file) });
  }

  const prototype = await detectPrototype(root);
  const gateway = readEnv("PUBLISH_GATEWAY") || null;
  const legacyDocsCli = readEnv("DOCS_CLI") || null;
  const published = await readPublishedState(root);

  return {
    root,
    docs: {
      kb: { files: pages.length, pages: pages.slice(0, 50) },
      reviews: await reviewSummary(root),
      features: await featureSummary(root),
    },
    prototype: {
      dir: prototype.dir,
      devScript: prototype.devScript,
      found: prototype.found,
      installed: prototype.installed,
      packageManager: prototype.packageManager,
      reason: prototype.reason,
    },
    publish: {
      configured: Boolean(gateway || legacyDocsCli),
      gateway,
      legacyDocsCli,
      publishedPages: Object.keys(published.pages).length,
      updatedAt: published.updatedAt,
    },
    generatedAt: new Date().toISOString(),
  };
}


async function readPublishedState(root) {
  const file = path.join(root, "docs", "kb", "_published.json");
  const stat = await statSafe(file);
  if (!stat) return { pages: {}, updatedAt: null };
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return { pages: parsed.pages && typeof parsed.pages === "object" ? parsed.pages : {}, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { pages: {}, updatedAt: null, error: "docs/kb/_published.json 不是合法 JSON" };
  }
}

/**
 * Compare local pages with the last publish state. This is intentionally
 * conservative: without loading the destination adapter we cannot know its
 * capabilities, so changed pages are marked for review rather than published.
 */
export async function readPublishPlan(inputRoot) {
  const root = resolveRoot(inputRoot);
  const kbDir = path.join(root, "docs", "kb");
  const state = await readPublishedState(root);
  const files = (await statSafe(kbDir)) ? await walk(kbDir, (_full, name) => name.endsWith(".md")) : [];
  const pages = [];
  for (const file of files.sort()) {
    const rel = path.relative(kbDir, file).split(path.sep).join("/");
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const stat = await statSafe(file);
    const previous = state.pages[rel];
    pages.push({
      path: rel,
      title: titleOf(text, file),
      status: !previous ? "new" : "published",
      url: previous?.url ?? null,
      publishedAt: previous ? state.updatedAt : null,
      localUpdatedAt: stat?.mtime.toISOString() ?? null,
      dependsOnDestination: !previous,
    });
  }
  const gateway = readEnv("PUBLISH_GATEWAY") || null;
  const legacyDocsCli = readEnv("DOCS_CLI") || null;
  return {
    root,
    configured: Boolean(gateway || legacyDocsCli),
    destination: gateway || (legacyDocsCli ? "docs-cli" : null),
    stateFile: "docs/kb/_published.json",
    updatedAt: state.updatedAt,
    summary: {
      total: pages.length,
      published: pages.filter((page) => page.status === "published").length,
      newPages: pages.filter((page) => page.status === "new").length,
    },
    pages,
  };
}

export async function readContext(inputRoot, options = {}) {
  if (options.task !== undefined || options.files || options.mode === "task") return readTaskContext(resolveRoot(inputRoot), options);
  const { topic = "", limit = 8 } = options;
  const root = resolveRoot(inputRoot);
  const kbDir = path.join(root, "docs", "kb");
  const files = (await statSafe(kbDir)) ? await walk(kbDir, (_full, name) => name.endsWith(".md")) : [];
  const needle = String(topic || "").trim().toLowerCase();
  const max = Math.max(1, Math.min(MAX_CONTEXT_FILES, Number(limit) || 8));
  const results = [];

  for (const file of files.sort()) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const rel = path.relative(kbDir, file);
    const title = titleOf(text, file);
    const excerpt = excerptOf(text);
    if (needle && !`${rel}\n${title}\n${excerpt}`.toLowerCase().includes(needle)) continue;
    results.push({ file: rel, title, excerpt });
    if (results.length >= max) break;
  }

  return {
    root,
    topic: topic || null,
    files: results,
    outline: (await statSafe(path.join(kbDir, "outline.config.mjs"))) ? "docs/kb/outline.config.mjs" : null,
  };
}

export async function readOpenReviews(inputRoot) {
  const root = resolveRoot(inputRoot);
  const dir = path.join(root, "docs", "reviews");
  const files = (await statSafe(dir)) ? await walk(dir, (_full, name) => name.endsWith(".json")) : [];
  const comments = [];
  const errors = [];
  for (const file of files) {
    try {
      for (const comment of await readComments(file)) {
        if (!comment || comment.status === "resolved") continue;
        comments.push({
          id: comment.id,
          frs: comment.frs ?? null,
          route: comment.route ?? null,
          author: comment.author ?? null,
          body: comment.body ?? "",
          createdAt: comment.createdAt ?? null,
          replies: Array.isArray(comment.replies) ? comment.replies.length : 0,
          anchor: comment.anchor ?? null,
          file: path.relative(root, file),
        });
      }
    } catch (error) {
      errors.push({ file: path.relative(root, file), error: error instanceof Error ? error.message : String(error) });
    }
  }
  comments.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return { root, comments, errors };
}

export function renderJson(value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}
