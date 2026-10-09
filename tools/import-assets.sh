#!/usr/bin/env bash
# Imports the original asset pack (gravity-race-pro-assets) into the game in web-ready form.
#   tools/import-assets.sh path/to/gravity-race-pro-assets
# Needs ffmpeg (libvorbis, aac) and ImageMagick with WebP. Follows 素材リスト「制作ルール」:
#   audio 48kHz, OGG for Web/Android + AAC for iOS, SFX peak -6 dBFS, BGM -16 LUFS;
#   images as WebP where alpha/size allows, icons as PNG.
set -euo pipefail
SRC=${1:?pack directory}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
A=$ROOT/assets
mkdir -p "$A"/{tex,bg,ball,fx,explain} "$ROOT"/audio/{sfx,music}

# ---- branding (I-01〜I-03) ----
cp "$SRC/branding/I-01-app-icon.svg" "$A/icon.svg"
cp "$SRC/branding/I-01-app-icon.png" "$A/icon-1024.png"
for s in 512 192; do convert "$A/icon-1024.png" -resize ${s}x${s} -strip "$A/icon-$s.png"; done
convert "$A/icon-1024.png" -resize 180x180 -strip "$A/apple-touch-icon.png"
# Android maskable: the padded foreground on the icon's own background colour (full bleed)
convert -size 512x512 gradient:'#243a61-#0b1426' \( "$SRC/branding/I-01-android-foreground.png" -resize 512x512 \) -composite -strip "$A/icon-maskable-512.png"
cp "$SRC/branding/I-02-logo-horizontal.svg" "$A/logo.svg"
cp "$SRC/branding/I-02-logo-square.svg" "$A/logo-square.svg"
cp "$SRC/branding/I-03-share-card-1200x630.png" "$A/share-card.png"

# ---- course and race visuals (I-06〜I-11) ----
convert "$SRC/textures/I-06-wood-1024x256.png" -quality 80 "$A/tex/wood.webp"
convert "$SRC/textures/I-07-metal-256x32.png" -quality 85 "$A/tex/metal.webp"
for b in steel hollow ice ring; do
  # balls are drawn at most ~70 device px: 192px keeps them sharp at a tenth of the size
  convert "$SRC/textures/I-08-$b-material-preview.png" -trim +repage -resize 192x192 -quality 85 "$A/ball/$b.webp"
done
for bg in workshop night-lab glacier; do convert "$SRC/backgrounds/I-09-$bg-2048x1024.png" -resize 1600x800 -quality 72 "$A/bg/$bg.webp"; done
cp "$SRC"/particles/I-10-*.png "$A/fx/"
# explain cards: the SVGs carry live Japanese text (the pack's PNGs render it as missing glyphs)
for f in "$SRC"/explain/I-11-*.svg; do cp "$f" "$A/explain/$(basename "$f" | sed 's/^I-11-//')"; done

# ---- audio (S-01〜S-20, M-01〜M-02) ----
peak() { ffmpeg -hide_banner -nostats -i "$1" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p'; }
lufs() { ffmpeg -hide_banner -nostats -i "$1" -af ebur128 -f null - 2>&1 | sed -n 's/^ *I: *\(-*[0-9.]*\) LUFS.*/\1/p' | tail -1; }
enc() { # src, out-base, gain dB, kbps
  ffmpeg -hide_banner -loglevel error -y -i "$1" -af "volume=$3dB" -ar 48000 -ac 1 -c:a libvorbis -b:a "$4k" "$2.ogg"
  ffmpeg -hide_banner -loglevel error -y -i "$1" -af "volume=$3dB" -ar 48000 -ac 1 -c:a aac -b:a "$4k" -movflags +faststart "$2.m4a"
}
for f in "$SRC"/audio/sfx/*.wav; do
  name=$(basename "$f" .wav | sed 's/^S-[0-9]*-//')
  g=$(python3 -c "print(round(-6 - ($(peak "$f")), 2))")
  enc "$f" "$ROOT/audio/sfx/$name" "$g" 64
done
for f in "$SRC"/audio/music/*.wav; do
  name=$(basename "$f" .wav | sed 's/^M-[0-9]*-//; s/-90s$//')
  g=$(python3 -c "print(round(-16 - ($(lufs "$f")), 2))")
  enc "$f" "$ROOT/audio/music/$name" "$g" 72
done
cp "$SRC/docs/CREDITS.md" "$ROOT/CREDITS.md"
du -sh "$A" "$ROOT/audio"
