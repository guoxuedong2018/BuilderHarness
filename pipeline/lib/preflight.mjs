import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EXT = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".json", ".map", ".txt", ".svg", ".xml", ".csv", ".md", ".webmanifest", ".yml", ".yaml"]);

const RULES = [
  { id: "dev-endpoint-decisions", re: /\/__decide\b/, why: "decision workbench endpoint" },
  { id: "dev-endpoint-review", re: /\/__proto_review\b/, why: "review middleware endpoint" },
  { id: "dev-endpoint-studio", re: /\/__builder_studio\b/, why: "content studio endpoint" },
  { id: "dev-endpoint-promo", re: /\/__promo\b/, why: "promo middleware endpoint" },
  { id: "dev-endpoint-editor", re: /\/__open-in-editor\b/, why: "open-in-editor endpoint" },
  { id: "source-anchor", re: /\bdata-(?:loc|use|comp)\b/, why: "dev source coordinates" },
  { id: "review-ui", re: /data-review-ui\b/, why: "review UI root" },
  { id: "review-data", re: /docs\/reviews\b/, why: "review data path" },
  { id: "home-path", re: new RegExp(escapeRe(os.homedir())), why: "absolute home path" },
  { id: "users-path", re: /(?:\/Users\/|[A-Za-z]:\\+Users\\+)/, why: "absolute user path" },
  { id: "localhost", re: /(?:localhost|127\.0\.0\.1)(?::\d+)?/, why: "local-only URL" },
  { id: "sourcemap", re: /sourceMappingURL=/, why: "source map reference" },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, why: "private key" },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/, why: "AWS access key" },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, why: "GitHub token" },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, why: "Slack token" },
  { id: "generic-secret", re: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'`][^"'`]{8,}["'`]/i, why: "possible credential" },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function loadScanPolicy(file) {
  if (!file) return null;
  const contents = await readFile(file, "utf8");
  let policy;
  try { policy = JSON.parse(contents); } catch { throw new Error("Artifact policy is not valid JSON"); }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("Artifact policy must be an object");
  for (const field of ["denyPatterns", "denyValues", "allowValues"]) {
    if (policy[field] != null && (!Array.isArray(policy[field]) ||
        policy[field].some((value) => typeof value !== "string" || !value.trim()))) throw new Error(`Artifact policy ${field} must be a list of nonempty strings`);
  }
  return { ...policy, hash: createHash("sha256").update(contents).digest("hex") };
}

/** Scan and identify the exact artifact tree that a deployment will upload. */
export async function inspectArtifact(dir, { denies = [], policy } = {}) {
  const rules = [...RULES, ...[...denies, ...(policy?.denyPatterns ?? [])].map((pattern, i) => {
    try { return { id: `deny-${i + 1}`, re: new RegExp(pattern), why: "host deny pattern" }; }
    catch { throw new Error(`Invalid host deny pattern #${i + 1}`); }
  })];
  const allowedValues = new Set(policy?.allowValues ?? []);
  const denyValues = (policy?.denyValues ?? []).filter((value) => !allowedValues.has(value));
  const findings = [];
  const manifest = [];
  const walk = async (folder) => {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const file = path.join(folder, entry.name);
      const rel = path.relative(dir, file).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile()) {
        findings.push({ rule: "non-regular-file", reason: "symlink or special file", file: rel });
        continue;
      }
      const buf = await readFile(file);
      manifest.push([rel, createHash("sha256").update(buf).digest("hex")]);
      if (/^\.env(?:\.|$)|\.(?:pem|key|p12|map)$/i.test(entry.name)) {
        findings.push({ rule: "private-file", reason: "environment file, key or source map", file: rel });
      }
      if (!EXT.has(path.extname(file).toLowerCase())) continue;
      const body = buf.toString("utf8");
      if (denyValues.some((value) => body.includes(value))) {
        findings.push({ rule: "host-private-value", reason: "host private value", file: rel });
      }
      const lines = body.split("\n");
      for (const rule of rules) {
        const line = lines.findIndex((text) => rule.re.test(text));
        if (line >= 0) findings.push({ rule: rule.id, reason: rule.why, file: rel, line: line + 1 });
      }
    }
  };
  if (!(await lstat(dir)).isDirectory()) throw new Error("Artifact root must be a real directory");
  await walk(dir);
  if (!manifest.length) findings.push({ rule: "empty-artifact", reason: "artifact contains no files", file: "." });
  const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return { dir, files: manifest.length, hash, findings };
}
