#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "./lib/paths.mjs";

const defaultOutput = path.join(REPO_ROOT, ".builderharness", "fixtures");
const types = new Map(Object.entries({
  ".mp4": "video", ".mov": "video", ".m4v": "video", ".webm": "video", ".mkv": "video",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
  ".wav": "audio", ".mp3": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio", ".flac": "audio",
}));
const run = (tool, args) => execFileSync(tool, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 }).toString();
const ffmpeg = (...args) => run("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args]);
const probe = (file) => JSON.parse(run("ffprobe", ["-v", "error", "-of", "json", "-show_format", "-show_streams", file]));
const mediaFile = (file) => types.get(path.extname(file).toLowerCase());

async function normalize(source, output, keepNames) {
  const files = (await readdir(source, { withFileTypes: true })).filter((entry) => entry.isFile() && mediaFile(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (!files.length) throw new Error("No supported image, audio or video fixtures found");
  const items = [];
  for (const { name } of files) {
    const kind = mediaFile(name);
    const input = path.join(source, name);
    const info = probe(input);
    const stream = info.streams.find((s) => s.codec_type === "video");
    const id = `media-${String(items.length + 1).padStart(3, "0")}`;
    const item = { id, kind, name: keepNames ? name : id,
      duration: Number.isFinite(Number(info.format.duration)) ? Number(info.format.duration) : null,
      ...(stream ? { width: stream.width, height: stream.height } : {}) };
    if (kind === "video") {
      item.file = id + ".mp4";
      item.thumbnail = id + ".jpg";
      ffmpeg("-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
        "-vf", "scale='min(1280,iw)':-2,pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "25", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", path.join(output, item.file));
      ffmpeg("-i", path.join(output, item.file), "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", path.join(output, item.thumbnail));
    } else if (kind === "image") {
      item.file = id + ".png";
      item.thumbnail = id + ".jpg";
      ffmpeg("-i", input, "-map_metadata", "-1", "-frames:v", "1", path.join(output, item.file));
      ffmpeg("-i", input, "-map_metadata", "-1", "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", path.join(output, item.thumbnail));
    } else {
      item.file = id + ".m4a";
      ffmpeg("-i", input, "-map", "0:a:0", "-map_metadata", "-1", "-vn", "-c:a", "aac", "-b:a", "96k", path.join(output, item.file));
    }
    items.push(item);
  }
  return items;
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    out: { type: "string" }, "keep-names": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  } });
  const [command, input] = positionals;
  if (values.help || !command) console.log("builderharness fixtures generate [--out DIR] | import-media <DIR> [--out DIR] [--keep-names]");
  else {
    if (!["generate", "import-media"].includes(command) || command === "import-media" && !input) throw new Error("Choose generate or import-media <DIR>");
    const out = path.resolve(values.out ?? path.join(defaultOutput, command === "generate" ? "synthetic" : "local-media"));
    await mkdir(path.dirname(out), { recursive: true });
    // Reserve an absent target. Existing generated or user data is never removed.
    await mkdir(out);
    let temp;
    try {
      temp = await mkdtemp(path.join(path.dirname(out), ".bh-media-"));
      let source = input ? path.resolve(input) : null;
      if (command === "generate") {
        source = path.join(temp, "seed");
        await mkdir(source);
        ffmpeg("-f", "lavfi", "-i", "testsrc2=size=480x270:rate=24:duration=2", "-c:v", "libx264", path.join(source, "motion.mp4"));
        ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=2", path.join(source, "tone.wav"));
        ffmpeg("-f", "lavfi", "-i", "color=c=steelblue:size=480x270", "-frames:v", "1", path.join(source, "cover.png"));
      }
      const result = path.join(temp, "result");
      await mkdir(result);
      const items = await normalize(source, result, values["keep-names"] === true);
      await writeFile(path.join(result, "manifest.json"), JSON.stringify({ synthetic: command === "generate", items }, null, 2) + "\n");
      for (const file of await readdir(result)) await rename(path.join(result, file), path.join(out, file));
      console.log(`Created ${items.length} fixtures in ${out}`);
    } catch (error) {
      await rm(out, { recursive: true, force: true });
      throw error;
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
