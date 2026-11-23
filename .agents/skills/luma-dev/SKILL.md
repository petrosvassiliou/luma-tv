---
name: luma-dev
description: Local development, verification, native Tauri v2 (macOS & Android) builds, and release workflow for Luma TV (app.lumatv.client).
---

# Luma TV Local Development (`/luma-dev`)

Use this workspace skill when building features, running local checks, launching Tauri v2 native windows, or cutting a new GitHub release for **Luma TV** (`app.lumatv.client`).

## 1. Local Environment Bootstrap
Run `./scripts/setup-local.sh` from the workspace root to verify Node.js (v24+ recommended), Rust/Cargo, root `npm` packages, and `functions/` dependencies.

## 2. Design Parity Checklist
Every new or modified UI view must support both platform design systems defined in `src/index.css`:
- **macOS (`[data-design="liquid-glass"]`)**: Translucent `.lg-pane`, `.lg-capsule`, `.lg-modal` surfaces with specular top highlights and macOS traffic-light clearance (`CustomTitlebar.tsx`).
- **GoogleOS / Android (`[data-design="m3-expressive"]`)**: Material 3 Expressive tonal hierarchy, stadium/squircle pills, and high-contrast 10-foot `:focus-visible` outlines.
- **10-Foot Spatial Navigation**: Interactive controls should remain reachable via arrow keys / D-Pad (`src/services/spatialNavigation.ts`) and localized in both `DE` and `EN` (`src/i18n/translations.ts`).

## 3. Quality Gate Before Committing
Always run all verification checks locally before committing or tagging:
```bash
npm run lint
npm test
npm run build
npm --prefix functions run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 4. Running Locally by Target
- **Web / ChromeOS PWA**: `npm run dev` (opens on `http://localhost:5173`)
- **macOS Native Window (Tauri v2)**: `npm run tauri:dev`
- **macOS Universal `.dmg`**: `npx tauri build --target universal-apple-darwin`
- **Android / Chromebook `.apk`**:
  ```bash
  npx tauri android init
  npx tauri android build --apk --debug --target aarch64 --target x86_64
  ```

## 5. Cutting a Multi-Platform Release
Pushing a `v*` tag triggers `.github/workflows/release-tauri.yml`, which automatically builds and attaches `Luma_<version>_universal.dmg` and `Luma-TV-Android-Universal.apk` to the GitHub Release:
1. Bump `"version"` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit and push to `origin`, then create and push an annotated tag (`git tag -a v0.4.0-beta.1 -m "..." && git push origin v0.4.0-beta.1`).
