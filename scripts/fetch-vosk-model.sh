#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/vosk-ru-small.bin"
URL="https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip"
DIR_NAME="vosk-model-small-ru-0.22"

if [[ -f "$OUT" ]] && [[ $(wc -c < "$OUT" | tr -d ' ') -gt 1000000 ]]; then
  echo "Vosk model already present: $OUT"
  exit 0
fi

mkdir -p "$ROOT/public"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Downloading Vosk RU model…"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP/model.zip"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$TMP/model.zip" "$URL"
else
  echo "Need curl or wget" >&2
  exit 1
fi

if command -v unzip >/dev/null 2>&1; then
  unzip -q "$TMP/model.zip" -d "$TMP"
elif command -v tar >/dev/null 2>&1; then
  tar -xf "$TMP/model.zip" -C "$TMP"
else
  echo "Need unzip" >&2
  exit 1
fi

if [[ ! -d "$TMP/$DIR_NAME" ]]; then
  echo "Unexpected archive layout" >&2
  ls -la "$TMP" >&2
  exit 1
fi

tar -czf "$OUT" -C "$TMP" "$DIR_NAME"
echo "Wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
