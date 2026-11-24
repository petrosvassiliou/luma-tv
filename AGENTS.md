# Luma TV (`app.lumatv.client`) — Antigravity Workspace Context

**Luma TV** (System/Dock short name: **Luma**, Bundle ID: `app.lumatv.client`, current version: `0.7.0-beta.4`) is a cross-platform M3U/M3U_Plus, Xtream Codes & XMLTV streaming player targeting:
1. **macOS (Apple Silicon & Intel)** via **Tauri v2** — native **Apple Liquid Glass** (`data-design="liquid-glass"`) design language, traffic-light titlebar overlay, CORS-free Rust `reqwest` ingestion, and hardware `MPV` handoff.
2. **Android, Android TV & GoogleOS / Chromebook** via **Tauri v2 Mobile** — native **Google Material 3 Expressive** (`data-design="m3-expressive"`) tonal hierarchy, 10-foot D-Pad spatial focus engine, and freeform resizable windows.
3. **ChromeOS / Web PWA** via **Vite 8 + Firebase Hosting & Cloud Functions** — standalone PWA with `window-controls-overlay`, offline Service Worker (`public/sw.js`), and optional `lumaStreamProxy` CORS/HLS rewriter (`functions/src/index.ts`).

## Core Architectural Modules
- **Dual Design System & 10-Foot Focus Rings:** `src/index.css` (`[data-design="m3-expressive"]` and `[data-design="liquid-glass"]`). Always preserve parity across both design modes when adding or restyling UI components.
- **Playback, Audio DSP & DVR:**
  - `src/engine/LumaPlayerEngine.ts` — `hls.js` + `mpegts.js` MSE Workers, audio/subtitle/ABR track switching, Tauri native bridge detection, and 3.4s fallback to `src/components/player/BroadcastSynthCanvas.tsx`.
  - `src/engine/audioProcessor.ts` — WebAudio DSP (`Linear Direct`, `Vocal Boost`, `Cinema Bass`, `Night DRC`, pre-amp up to `160%`).
  - `src/engine/dvrRecorder.ts` — Live stream clip recording (`MediaRecorder` MP4/WebM).
  - `src/engine/catchupUrlBuilder.ts` — Xtream `/timeshift/`, M3U_Plus `catchup-source`, Flussonic & Shift archive URL builder.
  - `src/engine/tauriNativeBridge.ts` & `src-tauri/src/lib.rs` — Rust Tauri v2 commands (`luma_native_probe_engine`, `luma_native_fetch_text`, `luma_native_launch_mpv`) and embedded `127.0.0.1` loopback HLS/TS stream proxy.
- **Off-Main-Thread Ingestion, Local DB & Zero-Knowledge Sync:**
  - `src/workers/parsers.ts` & `src/workers/ingest.worker.ts` — M3U_Plus, Xtream Codes API (Live, VOD & Series), and XMLTV / `.xml.gz` (`DecompressionStream`) parsers.
  - `src/db/lumaDb.ts` & `src/services/playlistService.ts` — Dexie.js IndexedDB persistence (`sources`, `channels`, `vodItems`, `seriesItems`, `epgPrograms`) and lazy `get_series_info` hydration.
  - `src/services/lumaCloudSync.ts` — Client-side `PBKDF2-SHA256` (150k iterations) + `AES-256-GCM` encrypted Firebase sync vault.
- **Navigation, Views & Localization:**
  - `src/services/spatialNavigation.ts` & `src/services/universalInput.ts` — 2D D-Pad raycasting, keyboard zapping, `?` Shortcut OSD, and W3C Gamepad polling.
  - `src/i18n/translations.ts` — Live 6-language dictionary (`DE`, `EN`, `IT`, `FR`, `ES`, `GR`) with BCP-47 formatting.
  - `src/services/channelSearch.ts` & `src/components/command/CommandBar.tsx` — NFKD + IPTV Unicode superscript normalized multi-token ranked search across 54,000+ channels, VOD Movies, and Xtream Series (`Cmd+K` / `Ctrl+K`).
  - `src/components/views/LiveTvView.tsx` & `src/components/epg/VirtualizedEpgGrid.tsx` — Default clean Cinema Live TV view with 60fps virtualized channel drawer alongside the virtualized 2D EPG grid.
  - `src/components/views/` — `LiveTvView.tsx`, `HomeAndSeriesHub.tsx`, `ChannelStudioView.tsx`, `MediaDetailModal.tsx`, `SettingsHubView.tsx`, `SecondaryViews.tsx`, `Phase4PlatformSyncPanel.tsx`.

## Local Development & Verification Commands
- **Install dependencies:** `./scripts/setup-local.sh` (or `npm install`)
- **Web / PWA Dev Server (`http://localhost:5173`):** `npm run dev`
- **Lint (`oxlint` — keep at 0 warnings, 0 errors):** `npm run lint`
- **Unit Tests (`vitest`):** `npm test`
- **Production Web Build:** `npm run build`
- **macOS Native Dev Window (Tauri v2):** `npm run tauri:dev`
- **macOS Native Production `.app` / `.dmg`:** `npm run tauri:build`
- **Android / Chromebook `.apk`:** `npm run tauri:android:init && npm run tauri:android:build`
- **Rust Check:** `cargo check --manifest-path src-tauri/Cargo.toml`
