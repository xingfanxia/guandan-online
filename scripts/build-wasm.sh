#!/usr/bin/env bash
# Build Bobgy decomposer's strategy.cpp → WASM via Docker emsdk.
#
# Run manually (NOT in CI / Vercel) when lib/ai/decomposer/cpp/* changes.
# Output is committed at lib/ai/decomposer/dist/strategy.{js,wasm}.
#
# Pinned to emscripten/emsdk:latest. If you need reproducibility across
# contributors, pin to a specific tag (e.g., emscripten/emsdk:3.1.69) and
# document the tag in lib/ai/decomposer/README.md.

set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p lib/ai/decomposer/dist

docker run --rm \
  -v "$(pwd)/lib/ai/decomposer:/src" \
  -w /src \
  emscripten/emsdk:latest \
  em++ cpp/strategy.cpp cpp/common.cpp \
    -o dist/strategy.js \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall"]' \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT='node,web' \
    -s ALLOW_MEMORY_GROWTH=1 \
    --bind

echo
echo "Built lib/ai/decomposer/dist/strategy.{js,wasm}:"
ls -la lib/ai/decomposer/dist/
