import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FEATURES_DIR, REPO_ROOT } from "./paths.mjs";

const STORE = path.join(REPO_ROOT, ".builderharness", "decisions");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const validKey = (key) => typeof key === "string" && /^[A-Za-z0-9_-]+$/.test(key);
const cells = (row) => row.trim().slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));

export function parseDecisions(markdown) {
  const heading = /^## (?:待决清单|Pending decisions)\s*$/im.exec(markdown);
  if (!heading) return [];
  const section = markdown.slice(heading.index + heading[0].length).split(/^#{1,2}\s/m)[0];
  const lines = section.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\|\s*ID\s*\|/i.test(line));
  if (start < 0) return [];
  const header = cells(lines[start]);
  const question = header.findIndex((label) => /^(问题|Question)$/i.test(label));
  const required = header.findIndex((label) => /^(阻断|Blocking)$/i.test(label));
  const conclusion = header.findIndex((label) => /^(结论|Conclusion)$/i.test(label));
  if (question < 0 || conclusion < 0) throw new Error("Decision table needs ID, Question and Conclusion columns");
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!/^\s*\|.*\|\s*$/.test(line)) break;
    const row = cells(line);
    const id = row[0];
    if (!validKey(id) || !row[question] || rows.some((item) => item.id === id)) throw new Error(`Invalid or duplicate decision: ${id}`);
    const blocking = /^(yes|true|是)$/i.test(row[required] ?? "");
    rows.push({ id, question: row[question], required: blocking, conclusion: row[conclusion] ?? "",
      version: sha(JSON.stringify([id, row[question], blocking])) });
  }
  return rows;
}

async function records(key) {
  const file = path.join(STORE, `${key}.json`);
  return fs.readFile(file, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

export async function readDecisions(key) {
  if (!validKey(key)) throw new Error("Invalid feature key");
  const file = path.join(FEATURES_DIR, key, "README.md");
  const readme = await fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const submissions = await records(key);
  return parseDecisions(readme).map((row) => {
    const latest = submissions.filter((item) => item.item === row.id).at(-1);
    const current = latest?.version === row.version;
    let status = row.conclusion ? "recorded" : "open";
    if (latest && !latest.closedAt) status = current ? "submitted" : "needs-review";
    if (latest?.closedAt && latest.action !== "return" && (!current || latest.conclusionHash !== sha(row.conclusion))) status = "needs-review";
    return { ...row, status, ...(latest ? { submission: latest } : {}) };
  });
}

export async function listDecisions() {
  const entries = await fs.readdir(FEATURES_DIR, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const features = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !validKey(entry.name)) continue;
    const items = await readDecisions(entry.name);
    if (items.length) features.push({ key: entry.name, items });
  }
  return features;
}

async function edit(key, change) {
  if (!validKey(key)) throw new Error("Invalid feature key");
  await fs.mkdir(STORE, { recursive: true });
  const file = path.join(STORE, `${key}.json`);
  const lockPath = file + ".lock";
  const lock = await fs.open(lockPath, "wx").catch((error) => {
    if (error.code === "EEXIST") throw new Error("A decision write is already in progress");
    throw error;
  });
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    const previous = await records(key);
    const result = await change(previous);
    await fs.writeFile(tmp, JSON.stringify(previous, null, 2) + "\n", { flag: "wx" });
    await fs.rename(tmp, file);
    return result;
  } finally {
    await lock.close();
    await fs.rm(tmp, { force: true });
    await fs.rm(lockPath, { force: true });
  }
}

export async function submitDecision(key, { item, version, action, author, body, source } = {}) {
  if (!["confirm", "return", "answer"].includes(action)) throw new Error("Choose confirm, return or answer");
  if (typeof author !== "string" || !author.trim() || author.length > 150 ||
      typeof body !== "string" || !body.trim() || body.length > 8000 ||
      (source != null && (typeof source !== "string" || source.length > 1000)) ||
      (action === "answer" && !source?.trim())) throw new Error("Provide an author, conclusion and source for an answer");
  return edit(key, async (submissions) => {
    const row = (await readDecisions(key)).find((entry) => entry.id === item);
    if (!row || row.version !== version) throw new Error("The question changed; refresh and review the current wording");
    const submission = { id: randomUUID(), item, version, action, author: author.trim(), body: body.trim(),
      source: source?.trim() ?? "", submittedAt: new Date().toISOString() };
    if (row.submission && !row.submission.closedAt) {
      const { action, author, body, source } = row.submission;
      if (row.submission.version === version && [action, author, body, source].every((value, index) =>
        value === [submission.action, submission.author, submission.body, submission.source][index])) return row.submission;
      const old = submissions.find((entry) => entry.id === row.submission.id);
      Object.assign(old, { closedAt: submission.submittedAt, supersededBy: submission.id });
    }
    submissions.push(submission);
    return submission;
  });
}

export async function resolveDecision(key, id) {
  return edit(key, async (submissions) => {
    const submission = submissions.find((entry) => entry.id === id);
    if (!submission) throw new Error("Submission not found");
    if (submission.closedAt) return submission;
    const row = (await readDecisions(key)).find((entry) => entry.id === submission.item);
    if (!row) throw new Error("Restore the decision row so the outcome remains traceable");
    if (submission.action === "return") {
      if (row.version === submission.version || row.conclusion) throw new Error("Revise the question and leave it open for the next decision");
    } else {
      if (row.version !== submission.version) throw new Error("The question changed; ask the reviewer to confirm the new wording");
      if (!row.conclusion.includes(submission.id)) throw new Error("Record the conclusion and submission ID in the README before resolving");
      const frs = JSON.parse(await fs.readFile(path.join(FEATURES_DIR, key, "FRS.json"), "utf8"));
      const ref = frs.decisionRefs?.[submission.item];
      const acceptance = new Set((frs.acceptance ?? []).map((text) => String(text).match(/^AC\d+/)?.[0]));
      if (ref?.submission !== submission.id || !Array.isArray(ref.acceptance) ||
          ref.acceptance.some((ac) => typeof ac !== "string" || !/^AC\d+$/.test(ac) || !acceptance.has(ac))) {
        throw new Error("Record the submission and affected AC IDs in FRS.decisionRefs before resolving");
      }
    }
    submission.closedAt = new Date().toISOString();
    submission.conclusionHash = sha(row.conclusion);
    return submission;
  });
}
