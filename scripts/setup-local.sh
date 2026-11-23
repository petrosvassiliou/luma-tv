#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Luma TV (app.lumatv.client) — Local Workspace Setup"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed. Install Node.js 24+ (https://nodejs.org or via nvm/fnm) and re-run."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
echo "    Node.js detected: $(node -v)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Warning: Node.js 24+ is recommended for @firebase v13 packages (found $(node -v))."
fi

echo "==> Installing root web & Tauri CLI dependencies..."
npm install --no-audit --no-fund

if [ -d "$ROOT_DIR/functions" ]; then
  echo "==> Installing Firebase Cloud Functions (lumaStreamProxy) dependencies..."
  npm --prefix "$ROOT_DIR/functions" install --no-audit --no-fund
fi

if command -v cargo >/dev/null 2>&1; then
  echo "    Rust toolchain detected: $(rustc --version)"
  echo "==> Verifying Tauri v2 Rust crate (src-tauri)..."
  cargo check --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"
else
  echo "    Note: Rust (cargo) not found. Web/PWA mode works immediately; install Rust via https://rustup.rs to run 'npm run tauri:dev'."
fi

echo "==> Running lint & unit tests..."
npm run lint
npm test

echo ""
echo "Luma TV local workspace is ready!"
echo "  - Start Web / PWA dev server:   npm run dev"
echo "  - Start Native Tauri window:    npm run tauri:dev"
