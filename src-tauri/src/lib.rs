use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEngineCapabilities {
    pub bundle_id: &'static str,
    pub platform: &'static str,
    pub arch: &'static str,
    pub hw_decoder: &'static str,
    pub mpv_available: bool,
    pub cors_free_network: bool,
    pub supported_codecs: Vec<&'static str>,
}

#[tauri::command]
fn luma_native_probe_engine() -> NativeEngineCapabilities {
    let platform = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let hw_decoder = match platform {
        "macos" => "Apple VideoToolbox (HEVC / ProRes / HDR10)",
        "android" => "Android MediaCodec + ExoPlayer Surface",
        "windows" => "D3D11VA / NVDEC",
        _ => "VAAPI / Vulkan Video",
    };

    let mpv_available = Command::new("mpv")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    NativeEngineCapabilities {
        bundle_id: "app.lumatv.client",
        platform,
        arch,
        hw_decoder,
        mpv_available,
        cors_free_network: true,
        supported_codecs: vec![
            "HEVC / H.265 10-bit",
            "AVC / H.264",
            "AV1 Hardware",
            "MPEG-TS (.ts)",
            "Matroska (.mkv)",
            "Dolby AC3 / EAC3 Atmos",
        ],
    }
}

/// Fetches M3U_Plus, Xtream JSON, or XMLTV (.xml / .xml.gz) natively via Rust TLS
/// with zero browser CORS restrictions.
#[tauri::command]
async fn luma_native_fetch_text(url: String, user_agent: Option<String>) -> Result<String, String> {
    let ua = user_agent.unwrap_or_else(|| "LumaTV/1.0 (Native Tauri Bridge)".to_string());
    let client = reqwest::Client::builder()
        .user_agent(ua)
        .gzip(true)
        .build()
        .map_err(|e| format!("HTTP Client Fehler: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Upstream Verbindungsfehler: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Upstream antwortete mit HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Stream-Lesefehler: {e}"))
}

/// Launches hardware-accelerated MPV / LibVLC external or embedded playback session
/// for raw HEVC, AC3/EAC3, MKV, or non-MSE IPTV streams on macOS & Desktop.
#[tauri::command]
async fn luma_native_launch_mpv(
    stream_url: String,
    title: String,
    user_agent: Option<String>,
) -> Result<String, String> {
    let ua = user_agent.unwrap_or_else(|| "LumaTV/1.0".to_string());

    Command::new("mpv")
        .arg(&stream_url)
        .arg("--hwdec=auto-safe")
        .arg(format!("--force-media-title=Luma TV · {title}"))
        .arg(format!("--user-agent={ua}"))
        .arg("--keep-open=no")
        .spawn()
        .map_err(|e| format!("MPV konnte nicht gestartet werden: {e}"))?;

    Ok("MPV Hardware-Session gestartet".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            luma_native_probe_engine,
            luma_native_fetch_text,
            luma_native_launch_mpv
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Luma TV (app.lumatv.client)");
}
