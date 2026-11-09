# 无旁白声音设计

产品价值片可以先没有口播，但不能完全没有声音。声音的任务不是“热闹”，而是：

- 给剪辑点一个落点；
- 让转场不突兀；
- 让产品点击/状态变化更可信；
- 让片子看起来更像“完成品”，而不是静默录屏。

默认只做三层：**低频氛围 + 转场 whoosh + UI 点击/轻 tick**。旁白后续再接。

## 1. 三层结构

| 层 | 作用 | 音量 | 频段 |
|---|---|---|---|
| Bed | 低频氛围，托住整片 | 很低，不抢画面 | 45–300Hz |
| Transition | 场景切换、品牌句出现 | 短、轻、不刺耳 | 300Hz–5kHz |
| UI | 点击、tick、状态落定 | 比转场更小 | 800Hz–4kHz |

规则：

- 音乐/氛围不承载信息；静音看也懂。
- 同一时刻只允许一个音效；不要每个动作都配音。
- 转场音效落在**画面切换的那一帧**，不要提前。
- 产品点击音只给关键动作，不给每个 hover。
- 旁白频段（1–4kHz）留空，方便后续接 TTS。

## 2. 本模板的音轨

`templates/product-film/sound-design.mjs` 用 FFmpeg 合成，不含第三方采样：

```bash
node sound-design.mjs \
  --video out/value-film.mp4 \
  --config sound.config.json \
  --out out/value-film-scored.mp4
```

默认音色：

- Bed：A2 + E3 + A3 正弦叠加 + 粉红噪声，低通 1.4kHz，淡入 2s / 淡出 3s；
- Click：1.5kHz 短正弦，给章节/关键点击；
- Tick：980Hz 极短音，给细节落定；
- Whoosh：粉红噪声 + 带通 + 快淡入慢淡出，给场景切换；
- Rise：170→280Hz 的短滑音，给品牌句/结尾。

输出：

- `out/soundtrack.m4a`：30 秒立体声，48kHz；
- `out/value-film-scored.mp4`：视频流直接 copy，只混入音轨；
- 响度标准化到约 -20 LUFS，峰值 -1.5dB。

只生成音轨：

```bash
node sound-design.mjs --audio-only --out out/soundtrack.m4a
```

## 3. 后续接 TTS / 配音

1. 先锁定画面时长和 beat，不要先做配音再改画面；
2. 按 `film.js` 里的 `// VO:` 时间点写旁白；
3. 旁白生成后，把音乐 bed 降到 -24 LUFS 左右，避免压字；
4. 用 FFmpeg 混音：

```bash
ffmpeg -i value-film.mp4 -i voice.wav -i soundtrack.m4a \
  -filter_complex "[1:a]highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=10:release=150[vo];[2:a]volume=0.55[bed];[vo][bed]amix=inputs=2:duration=first:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest out/final.mp4
```

5. 输出两份：`final-silent.mp4` 和 `final-voiced.mp4`，方便不同渠道。

## 4. 外部音乐/音效

需要更完整的音乐时，优先 CC0：

- **FreePD**：CC0，可商用，无需署名；
- **Freesound**：逐条看 CC0 / CC BY；CC BY 需要署名；
- **Openverse**：聚合 CC 搜索，下载前核对许可证；
- **Free Music Archive**：逐条看许可证，不要默认全部可商用。

不要：

- 用未授权的流行音乐/影视原声；
- 用“免费下载”但许可证不明的素材；
- 把 CC BY-NC 素材用进商业产品；
- 把音乐盖过产品点击音。

## 5. 交付检查

- [ ] 静音看一遍，信息是否完整？
- [ ] 转场音效是否落在剪辑点？
- [ ] 是否每个动作都有声音？（太多就删）
- [ ] 峰值是否超过 -1dB？是否削波？
- [ ] 旁白频段是否留空？
- [ ] 是否记录了音乐/音效来源和许可证？
- [ ] 是否保留无音轨母版？

## 6. 与开源工具的关系

- **FFmpeg**：合成、混音、响度、编码的底座；本模板默认使用。
- **OBS / Screenity**：只在需要真实桌面/浏览器录屏时用；输出视频可商用，但修改并分发软件本身有 GPL 义务。
- **Remotion / Revideo**：需要程序化音视频同步时再引入；Revideo MIT，Remotion 源码可见但非 OSI 开源，团队 ≥4 人需付费。
- **FreePD / Freesound / Openverse**：素材来源，不是软件依赖；逐条记录许可证。
