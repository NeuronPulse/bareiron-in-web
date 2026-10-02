#!/usr/bin/env bash
#
# Build bareiron as WebAssembly for the browser/WASM target.
#
# This compiles the C sources with `-DWASM`, which selects src/net_wasm.c
# (the JS-bridge transport) instead of src/net_posix.c. Asyncify is enabled so
# that blocking net_recv/net_send/net_poll calls suspend and resume against the
# browser event loop, and IDBFS is available for world persistence.
#
# Prerequisites (see README):
#   - Emscripten SDK on PATH (emcc)
#   - include/registries.h + src/registries.c generated (extract_registries.sh)
#
set -euo pipefail

SRC=src
OUT=src/web/dist

mkdir -p "$OUT"

# Asyncify is enabled; EM_ASYNC_JS imports (net_js_wait) are registered
# automatically, so no manual ASYNCIFY_IMPORTS list is needed.

emcc \
  -DWASM \
  "$SRC"/*.c \
  -Iinclude \
  -O2 \
  -o "$OUT/bareiron.js" \
  -sWASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=BareironModule \
  -sASYNCIFY=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFORCE_FILESYSTEM=1 \
  -sEXIT_RUNTIME=0 \
  -sENVIRONMENT=web,node \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS \
  -sINVOKE_RUN=1 \
  -sASSERTIONS=1

echo "Built $OUT/bareiron.js and $OUT/bareiron.wasm"
