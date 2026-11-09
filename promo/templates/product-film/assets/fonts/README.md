# 字体

模板默认使用两款 SIL Open Font License 字体：

- **Inter**：拉丁字母、数字、界面标签
- **Noto Sans SC**：中文正文与标题

两者都可免费商用。字体文件体积较大，不随模板提交；首次使用运行：

```bash
bash assets/fonts/fetch-fonts.sh
```

脚本从 Google Fonts 官方仓库下载：

- `Inter[opsz,wght].ttf` → `Inter-Variable.ttf`
- `NotoSansSC[wght].ttf` → `NotoSansSC-Variable.ttf`
- 两份 `OFL.txt`

如果宿主已经有品牌字体，直接替换 `brand.json` 的 `fonts` 和 `index.html` 的 `@font-face` 即可。

## 中文子集

Noto Sans SC 完整字体约 17MB。只做固定文案的产品片，可以用 `fonttools` 子集化：

```bash
pip install fonttools brotli
pyftsubset assets/fonts/NotoSansSC-Variable.ttf \
  --text-file=copy.txt \
  --flavor=woff2 \
  --output-file=assets/fonts/NotoSansSC-Subset.woff2
```

然后把 `@font-face` 的 `src` 指向子集文件。文案变化后要重新子集化。
