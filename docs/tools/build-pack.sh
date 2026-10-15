#!/usr/bin/env sh
# Rebuilds Who-Sabi-Complete-Pack.html from the numbered Markdown docs (tested with pandoc 3.1).
# Run from anywhere: sh docs/tools/build-pack.sh
set -eu
cd "$(dirname "$0")/.."
pandoc -f gfm [0-9][0-9]-*.md -s --toc --toc-depth=1 \
  --metadata title="Who Sabi? Complete Documentation Pack" \
  -H tools/pack-header.html -o Who-Sabi-Complete-Pack.html
echo "Built Who-Sabi-Complete-Pack.html"
