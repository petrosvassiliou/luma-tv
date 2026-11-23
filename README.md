# Luma TV (`app.lumatv.client`)

Next-Gen High-Luminance Stream, M3U_Plus & Xtream Codes Player — built with **React 19 + TypeScript + Vite + TailwindCSS v4**, packaged for **ChromeOS / Firebase PWA**, **macOS (Apple Silicon & Intel)**, and **Android / GoogleOS** via **Tauri v2**.

## Dual-Platform Design System
- **Googlebook / Android — Material 3 Expressive (`m3-expressive`):** Tonal container hierarchy, stadium/squircle spring geometry, Extended FAB, Navigation Rail/Drawer, and ChromeOS Window Controls Overlay (`window-controls-overlay`).
- **macOS — Apple Liquid Glass (`liquid-glass`):** Translucent multi-layered optical glass (`backdrop-filter: blur(44px) saturate(210%)`), specular refraction rims, spatial ambient backlight bleed, macOS Traffic Lights (`titleBarStyle: "Overlay"`), and floating capsule HUD.

## Architecture Overview
- `src/engine/LumaPlayerEngine.ts` — Multi-driver playback layer (`hls.js` MSE Worker + `mpegts.js` MSE Worker + Subtitles/Audio/ABR + Studio Synth fallback + Tauri v2 Native MPV Bridge).
- `src/workers/ingest.worker.ts` — Off-main-thread M3U/M3U_Plus parser, Xtream Codes API client, and `.xml` / `.xml.gz` (`DecompressionStream`) XMLTV extractor.
- `src/db/lumaDb.ts` — Compound-indexed Dexie.js (IndexedDB) local persistence for 50,000+ entries.
- `src/services/lumaCloudSync.ts` — Client-side PBKDF2-SHA256 + AES-256-GCM Zero-Knowledge Sync Vault integrated with Firebase Auth & Cloud Firestore (`firestore.rules`).
- `functions/src/index.ts` — Firebase Cloud Functions v2 `lumaStreamProxy` (SSRF-hardened CORS bypass, `.m3u8` segment/key URI rewriter, custom IPTV `User-Agent`, and zero-copy `.ts` stream pipe).
- `src-tauri/` — Tauri v2 Rust backend (`app.lumatv.client`) with macOS VideoToolbox / MPV bridge, CORS-free `reqwest` fetcher, and Chromebook/Android Freeform Windowing manifest (`src-tauri/android-chromeos-manifest.xml`).

## Quick Start (Local Antigravity Workspace)

1. **Clone the repository locally:**
   ```bash
   git clone https://github.com/petrosvassiliou/luma-tv.git
   cd luma-tv
   ```
2. **Open in Antigravity Desktop:**
   - Choose **File → Open Folder…** and select your local `luma-tv` directory.
   - Antigravity automatically loads [`AGENTS.md`](./AGENTS.md) and the workspace skill [`.agents/skills/luma-dev/SKILL.md`](./.agents/skills/luma-dev/SKILL.md) (`/luma-dev`).
3. **Bootstrap dependencies & verify:**
   ```bash
   ./scripts/setup-local.sh
   ```

## Build & Deployment Commands

```bash
# Local Web / PWA Development (http://localhost:5173)
npm run dev

# macOS Native Desktop Window (Liquid Glass + Tauri v2)
npm run tauri:dev
npm run tauri:build

# Android, Android TV & Chromebook APK (Material 3 Expressive + Tauri v2 Mobile)
npm run tauri:android:init
npm run tauri:android:build

# Production ChromeOS PWA Build & Firebase Deploy (Hosting + Functions + Firestore Rules)
npm run build
npm --prefix functions run build
firebase deploy --project luma-tv-app
```
