import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function reviewFile(dir, frs) {
  const key = String(frs || "APP_SHELL").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dir, `${key}.json`);
}

async function readReviewFile(file) {
  const raw = await fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "[]";
    throw error;
  });
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data) || Array.isArray(data?.comments)) return data;
  } catch {
    // The caller must never overwrite a corrupt review file.
  }
  throw new Error(`批注文件无法读取，已保留原文件：${path.basename(file)}`);
}

const commentsOf = (data) => Array.isArray(data) ? data : data.comments;

export async function readComments(file) {
  return commentsOf(await readReviewFile(file));
}

async function lockFile(file) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return await fs.open(file, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`批注文件正被占用，请重试。如果上次写入异常退出，关闭批注工具后清理 ${path.basename(file)}。`);
      }
      await delay(20);
    }
  }
}

/** Shared by the dev server, CLI and host, which can run in separate processes. */
export async function editReviews(file, edit) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lockPath = file + ".lock";
  const lock = await lockFile(lockPath);
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    const data = await readReviewFile(file);
    const before = JSON.stringify(data);
    const result = edit(commentsOf(data));
    if (JSON.stringify(data) !== before) {
      const stat = await fs.stat(file).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: stat?.mode ?? 0o600 });
      await fs.rename(temp, file);
    }
    return result;
  } finally {
    try {
      await lock.close();
      await fs.rm(temp, { force: true });
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  }
}
