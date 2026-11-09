#!/usr/bin/env node
/**
 * 无旁白声音设计：低频氛围 + 点击/转场音效，直接混进成片。
 *
 * 用法：
 *   node sound-design.mjs --video out/value-film.mp4 \
 *     --config sound.config.json --out out/value-film-scored.mp4
 *
 * 只生成音轨：
 *   node sound-design.mjs --audio-only --out out/soundtrack.m4a
 *
 * 依赖本机 ffmpeg。声音全部由 ffmpeg 合成，不含第三方采样；
 * 后续接 TTS/音乐时，保留画面时长，替换 soundtrack 即可。
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const get = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const configPath = get("config", "sound.config.json");
const video = get("video");
const out = get("out", "out/value-film-scored.mp4");
const audioOnly = has("audio-only");

const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));
const duration = Number(cfg.duration || 30);
const root = Number(cfg.bed?.root || 110);
const gain = Number(cfg.bed?.gain || 0.018);
const noise = Number(cfg.bed?.noise || 0.004);

const filters = [];
const labels = [];

// 低频氛围：A2 + E3 + A3，轻微滤波和淡入淡出，不抢画面
filters.push(
  `aevalsrc=${gain}*sin(2*PI*${root}*t)+${(gain * 0.55).toFixed(4)}*sin(2*PI*${(root * 1.5).toFixed(2)}*t)+${(gain * 0.35).toFixed(4)}*sin(2*PI*${(root * 2).toFixed(2)}*t):s=48000:d=${duration}[bed]`,
);
filters.push(`anoisesrc=color=pink:duration=${duration}:sample_rate=48000,lowpass=f=900,volume=${noise}[noise]`);
filters.push(`[bed][noise]amix=inputs=2:duration=first:normalize=0,highpass=f=45,lowpass=f=1400,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, duration - 3)}:d=3[amb]`);
labels.push("amb");

for (const [i, cue] of (cfg.cues || []).entries()) {
  const at = Number(cue.at || 0) * 1000;
  const type = cue.type || "click";
  const label = `cue${i}`;
  if (type === "click") {
    filters.push(`sine=frequency=1500:duration=0.07:sample_rate=48000,afade=t=out:st=0:d=0.07,volume=0.30,adelay=${at}[${label}]`);
  } else if (type === "tick") {
    filters.push(`sine=frequency=980:duration=0.04:sample_rate=48000,afade=t=out:st=0:d=0.04,volume=0.16,adelay=${at}[${label}]`);
  } else if (type === "whoosh") {
    filters.push(`anoisesrc=color=pink:duration=0.6:sample_rate=48000,highpass=f=260,lowpass=f=5200,afade=t=in:st=0:d=0.12,afade=t=out:st=0.22:d=0.36,volume=0.16,adelay=${at}[${label}]`);
  } else if (type === "rise") {
    filters.push(`aevalsrc=0.035*sin(2*PI*(170+110*t)*t):s=48000:d=1.8,afade=t=in:st=0:d=0.25,afade=t=out:st=0.9:d=0.9,volume=0.22,adelay=${at}[${label}]`);
  } else {
    throw new Error(`未知音效类型：${type}`);
  }
  labels.push(label);
}

filters.push(
  `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,alimiter=limit=0.8,aformat=channel_layouts=stereo,loudnorm=I=-20:TP=-1.5:LRA=7,aresample=48000[aout]`,
);

await fs.mkdir(path.dirname(out), { recursive: true });
const soundtrack = audioOnly ? out : path.join(path.dirname(out), "soundtrack.m4a");

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-t",
    String(duration),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    soundtrack,
  ],
  { stdio: "inherit" },
);

console.log(`✓ 音轨 ${soundtrack}`);

if (!audioOnly) {
  if (!video) throw new Error("需要 --video out/value-film.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      video,
      "-i",
      soundtrack,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-shortest",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );
  console.log(`✓ 带声音成片 ${out}`);
}
