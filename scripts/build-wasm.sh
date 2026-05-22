#!/usr/bin/env bash
# Build Bobgy decomposer's strategy.cpp → WASM via Docker emsdk.
#
# Run manually (NOT in CI / Vercel) when lib/ai/decomposer/cpp/* changes.
# Output is committed at lib/ai/decomposer/dist/strategy.{js,wasm}.
#
# REPRODUCIBILITY — emsdk tag is pinned, not `:latest`.
# `:latest` drifts between contributors and produces different wasm bytes for
# the same C++ source, defeating the "commit the artifact" strategy. When
# Bobgy's source hasn't changed, re-running this script must yield byte-
# identical output. Bump the tag deliberately when adopting a new toolchain
# (test the resulting wasm against tests/ai/decomposer/*).
#
# To bump: replace EMSDK_TAG below, re-run, run `npm test`, commit both the
# new artifact and the script change in the same PR.
EMSDK_TAG="${EMSDK_TAG:-5.0.7}"

set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p lib/ai/decomposer/dist

docker run --rm \
  -v "$(pwd)/lib/ai/decomposer:/src" \
  -w /src \
  "emscripten/emsdk:${EMSDK_TAG}" \
  em++ cpp/strategy.cpp cpp/common.cpp \
    -o dist/strategy.js \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall"]' \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT='node,web' \
    -s ALLOW_MEMORY_GROWTH=1 \
    --bind

echo
echo "Built lib/ai/decomposer/dist/strategy.{js,wasm} with emsdk ${EMSDK_TAG}:"
ls -la lib/ai/decomposer/dist/
