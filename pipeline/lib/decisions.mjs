import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FEATURES_DIR, REPO_ROOT } from "./paths.mjs";
import { listFeatureDirs, parsePendingList, readFeatureReadme } from "./pending-list.mjs";

export const DECISION_STORE = path.join(REPO_ROOT, ".builderharness", "decisions");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const validKey = (key) => typeof key === "string" && /^[A-Za-z0-9_-]+$/.test(key);
export function parseDecisions(markdown) {
  return (parsePendingList(markdown)?.groups ?? []).flatMap((group) => group.items).map((item) => {
    const fingerprint = [item.id, item.question, item.blocking];
    if (item.group !== "A" || item.why || item.recommend || item.alternatives.length || item.landing || item.extra.length) {
      fingerprint.push(item.group, item.why, item.recommend?.text, item.alternatives.map((choice) => choice.text), item.landing, item.extra);
    }
    return { ...item, required: item.blocking, version: sha(JSON.stringify(fingerprint)) };
  });
}

async function records(key) {
  const file = path.join(DECISION_STORE, `${key}.json`);
  return fs.readFile(file, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

export async function readDecisions(key, markdown) {
  if (!validKey(key)) throw new Error("Invalid feature key");
  const readme = markdown ?? await readFeatureReadme(key) ?? "";
  const submissions = await records(key);
  return parseDecisions(readme).map((row) => {
    const latest = submissions.filter((item) => item.item === row.id && !item.withdrawnAt).at(-1);
    const current = latest?.version === row.version;
    let status = row.state === "decided" ? "recorded" : row.state === "provisional" ? "provisional" : "open";
    if (latest && !latest.closedAt) status = current ? "submitted" : "needs-review";
    if (latest?.closedAt && latest.action !== "return" && (!current || latest.conclusionHash !== sha(row.conclusion))) status = "needs-review";
    return { ...row, status, ...(latest ? { submission: latest } : {}) };
  });
}

export async function listDecisions() {
  const features = [];
  for (const key of await listFeatureDirs()) {
    const items = await readDecisions(key);
    if (items.length) features.push({ key, items });
  }
  return features;
}

async function edit(key, change) {
  if (!validKey(key)) throw new Error("Invalid feature key");
  await fs.mkdir(DECISION_STORE, { recursive: true });
  const file = path.join(DECISION_STORE, `${key}.json`);
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

export async function submitDecision(key, { item, version, action, author, body, source, choice, note } = {}) {
  if (!["confirm", "return", "answer"].includes(action)) throw new Error("Choose confirm, return or answer");
  if (typeof author !== "string" || !author.trim() || author.length > 150 ||
      typeof body !== "string" || !body.trim() || body.length > 8000 ||
      (source != null && (typeof source !== "string" || source.length > 1000)) ||
      (action === "answer" && !source?.trim())) throw new Error("Provide an author, conclusion and source for an answer");
  return edit(key, async (submissions) => {
    const row = (await readDecisions(key)).find((entry) => entry.id === item);
    if (!row || row.version !== version) throw new Error("The question changed; refresh and review the current wording");
    if (choice) {
      if (action !== "confirm" || !["recommend", "alt", "own"].includes(choice.kind) ||
          typeof choice.text !== "string" || !choice.text.trim() ||
          (choice.kind === "recommend" && choice.text !== row.recommend?.text) ||
          (choice.kind === "alt" && !row.alternatives.some((option) => option.text === choice.text && option.mark === choice.mark))) {
        throw new Error("This option does not match the current question");
      }
    }
    if (note != null && (typeof note !== "string" || note.length > 8000)) throw new Error("Invalid decision note");
    const submission = { id: randomUUID(), item, version, action, author: author.trim(), body: body.trim(),
      source: source?.trim() ?? "", ...(choice ? { choice: { kind: choice.kind, text: choice.text, mark: choice.mark } } : {}), ...(note?.trim() ? { note: note.trim() } : {}), submittedAt: new Date().toISOString() };
    if (row.submission && !row.submission.closedAt) {
      const { action, author, body, source } = row.submission;
      if (row.submission.version === version && [action, author, body, source].every((value, index) =>
        value === [submission.action, submission.author, submission.body, submission.source][index]) &&
          JSON.stringify(row.submission.choice) === JSON.stringify(submission.choice) && row.submission.note === submission.note) return row.submission;
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
      if (row.version === submission.version || row.state !== "pending") throw new Error("Revise the question and leave it open for the next decision");
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

export async function withdrawDecision(key, id, author) {
  return edit(key, (submissions) => {
    const item = submissions.find((entry) => entry.id === id && entry.author === author);
    if (!item || (item.closedAt && !item.withdrawnAt)) throw new Error("Only the author can withdraw an unrecorded submission");
    if (!item.withdrawnAt) item.closedAt = item.withdrawnAt = new Date().toISOString();
    return item;
  });
}
