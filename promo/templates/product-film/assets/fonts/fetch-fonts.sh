#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

curl -L --fail --retry 3 \
  "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf" \
  -o Inter-Variable.ttf
curl -L --fail --retry 3 \
  "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf" \
  -o NotoSansSC-Variable.ttf
curl -L --fail --retry 3 \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt" \
  -o OFL-Inter.txt
curl -L --fail --retry 3 \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt" \
  -o OFL-NotoSansSC.txt

ls -lh Inter-Variable.ttf NotoSansSC-Variable.ttf OFL-*.txt
