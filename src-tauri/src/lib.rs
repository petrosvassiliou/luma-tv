use bytes::Bytes;
use futures_util::TryStreamExt;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{
    HeaderValue, ACCEPT, ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, CACHE_CONTROL, CONTENT_LENGTH,
    CONTENT_RANGE, CONTENT_TYPE, RANGE, USER_AGENT,
};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::OnceCell;
use url::Url;

type ProxyBody = BoxBody<Bytes, std::io::Error>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEngineCapabilities {
    pub bundle_id: &'static str,
    pub platform: &'static str,
    pub arch: &'static str,
    pub hw_decoder: &'static str,
    pub mpv_available: bool,
    pub mpv_path: Option<String>,
    pub local_proxy_url: Option<String>,
    pub cors_free_network: bool,
    pub supported_codecs: Vec<&'static str>,
}

struct LocalProxyServer {
    endpoint_url: String,
}

#[derive(Clone)]
struct ProxyRuntimeContext {
    client: reqwest::Client,
    port: u16,
    expected_path: String,
    endpoint_url: String,
}

static CACHED_MPV_BINARY: OnceLock<PathBuf> = OnceLock::new();
static LOCAL_PROXY_INSTANCE: OnceCell<LocalProxyServer> = OnceCell::const_new();

fn generate_session_token() -> String {
    let mut h1 = RandomState::new().build_hasher();
    h1.write_u64(0x4C55_4D41_5456_3034);
    let mut h2 = RandomState::new().build_hasher();
    h2.write_u64(0x5052_4F58_595F_4B45);
    format!("{:016x}{:016x}", h1.finish(), h2.finish())
}

fn candidate_mpv_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let bin_name = if cfg!(target_os = "windows") {
        "mpv.exe"
    } else {
        "mpv"
    };

    if let Some(explicit) = std::env::var_os("LUMA_MPV_PATH") {
        if !explicit.is_empty() {
            candidates.push(PathBuf::from(explicit));
        }
    }

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            candidates.push(dir.join(bin_name));
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Packaged macOS .app bundles launched via Finder/Dock do not inherit shell PATH
        // (/opt/homebrew/bin or /usr/local/bin), so probe standard install roots explicitly.
        candidates.push(PathBuf::from("/opt/homebrew/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
        candidates.push(PathBuf::from("/Applications/mpv.app/Contents/MacOS/mpv"));
        if let Some(home) = std::env::var_os("HOME") {
            let home_dir = PathBuf::from(home);
            candidates.push(home_dir.join("Applications/mpv.app/Contents/MacOS/mpv"));
            candidates.push(home_dir.join(".local/bin/mpv"));
        }
        candidates.push(PathBuf::from("/opt/local/bin/mpv"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
        candidates.push(PathBuf::from("/snap/bin/mpv"));
        candidates.push(PathBuf::from("/var/lib/flatpak/exports/bin/io.mpv.Mpv"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data).join("Programs\\mpv\\mpv.exe"));
        }
        candidates.push(PathBuf::from("C:\\Program Files\\mpv\\mpv.exe"));
    }

    candidates
}

fn verify_mpv_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn resolve_mpv_binary() -> Option<PathBuf> {
    if let Some(cached) = CACHED_MPV_BINARY.get() {
        if cached.is_file() {
            return Some(cached.clone());
        }
    }

    let mut seen: Vec<PathBuf> = Vec::new();
    for candidate in candidate_mpv_paths() {
        if seen.iter().any(|p| p == &candidate) {
            continue;
        }
        seen.push(candidate.clone());
        if verify_mpv_executable(&candidate) {
            let _ = CACHED_MPV_BINARY.set(candidate.clone());
            return Some(candidate);
        }
    }
    None
}

pub fn validate_mpv_stream_url(raw_url: &str) -> Result<Url, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Leere Stream-URL übergeben.".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|e| format!("Ungültige Stream-URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" | "rtsp" | "rtmp" | "rtmps" | "rtp" | "udp" => Ok(parsed),
        other => Err(format!(
            "Nicht unterstütztes Protokoll '{other}://' für MPV-Wiedergabe."
        )),
    }
}

fn sanitize_cli_value(input: &str) -> String {
    input
        .chars()
        .filter(|c| *c != '\r' && *c != '\n' && *c != '\0')
        .collect()
}

pub fn percent_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 16);
    for &b in input.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn validate_proxy_upstream_url(raw_url: &str, self_proxy_port: u16) -> Result<Url, String> {
    let parsed = Url::parse(raw_url.trim()).map_err(|_| "Invalid upstream stream URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Disallowed upstream URL scheme.".to_string());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let is_loopback =
        host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "[::1]";
    if is_loopback && parsed.port_or_known_default() == Some(self_proxy_port) {
        return Err("Self-referential proxy loop blocked.".to_string());
    }
    Ok(parsed)
}

fn rewrite_tag_uris<F>(line: &str, build_proxied: &F) -> String
where
    F: Fn(&str) -> String,
{
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len() + 64);
    let mut cursor = 0;

    while cursor < bytes.len() {
        let rem = &line[cursor..];
        let found = rem
            .char_indices()
            .map(|(idx, _)| idx)
            .find(|&idx| {
                let tail = &rem.as_bytes()[idx..];
                tail.len() >= 5
                    && tail[..4].eq_ignore_ascii_case(b"URI=")
                    && tail[4] == b'"'
            });

        let Some(rel_pos) = found else {
            out.push_str(rem);
            break;
        };

        let uri_attr_start = cursor + rel_pos;
        out.push_str(&line[cursor..uri_attr_start]);
        let value_start = uri_attr_start + 5;

        if let Some(end_quote_rel) = line[value_start..].find('"') {
            let raw_uri = &line[value_start..value_start + end_quote_rel];
            out.push_str("URI=\"");
            out.push_str(&build_proxied(raw_uri));
            out.push('"');
            cursor = value_start + end_quote_rel + 1;
        } else {
            out.push_str(&line[uri_attr_start..]);
            break;
        }
    }

    out
}

pub fn rewrite_hls_manifest_for_proxy(
    manifest_text: &str,
    upstream_base_url: &Url,
    proxy_endpoint_base: &str,
    custom_ua: Option<&str>,
) -> String {
    let clean_base = proxy_endpoint_base.trim().trim_end_matches('/');
    let ua_trimmed = custom_ua.map(str::trim).filter(|s| !s.is_empty());

    let build_proxied = |target: &str| -> String {
        let trimmed_target = target.trim();
        if trimmed_target.starts_with(clean_base) {
            return trimmed_target.to_string();
        }
        let resolved = upstream_base_url
            .join(trimmed_target)
            .map(|u| u.to_string())
            .unwrap_or_else(|_| trimmed_target.to_string());
        let ua_suffix = match ua_trimmed {
            Some(ua) => format!("&ua={}", percent_encode_component(ua)),
            None => String::new(),
        };
        format!(
            "{clean_base}?url={}{ua_suffix}",
            percent_encode_component(&resolved)
        )
    };

    manifest_text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return line.to_string();
            }
            if trimmed.starts_with('#') {
                return rewrite_tag_uris(line, &build_proxied);
            }
            build_proxied(trimmed)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn full_body(bytes: impl Into<Bytes>) -> ProxyBody {
    Full::new(bytes.into())
        .map_err(|never| match never {})
        .boxed()
}

fn empty_body() -> ProxyBody {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

fn with_cors_headers(mut builder: hyper::http::response::Builder) -> hyper::http::response::Builder {
    builder = builder
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(
            ACCESS_CONTROL_ALLOW_HEADERS,
            "Range, Content-Type, X-Luma-User-Agent",
        )
        .header(
            ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Length, Content-Range, Content-Type, Accept-Ranges",
        );
    builder
}

fn json_response(status: StatusCode, payload: serde_json::Value) -> Response<ProxyBody> {
    with_cors_headers(Response::builder().status(status))
        .header(CONTENT_TYPE, "application/json; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .body(full_body(payload.to_string()))
        .unwrap_or_else(|_| Response::new(empty_body()))
}

async fn handle_proxy_request(
    req: Request<Incoming>,
    ctx: Arc<ProxyRuntimeContext>,
) -> Result<Response<ProxyBody>, hyper::Error> {
    if req.method() == Method::OPTIONS {
        let resp = with_cors_headers(Response::builder().status(StatusCode::NO_CONTENT))
            .body(empty_body())
            .unwrap_or_else(|_| Response::new(empty_body()));
        return Ok(resp);
    }

    if req.uri().path() != ctx.expected_path {
        return Ok(json_response(
            StatusCode::FORBIDDEN,
            serde_json::json!({ "error": "Invalid local proxy capability token." }),
        ));
    }

    if req.method() != Method::GET && req.method() != Method::HEAD {
        return Ok(json_response(
            StatusCode::METHOD_NOT_ALLOWED,
            serde_json::json!({ "error": "Only GET, HEAD, and OPTIONS are supported." }),
        ));
    }

    let mut raw_target = String::new();
    let mut query_ua: Option<String> = None;
    let mut is_health = false;

    if let Some(q) = req.uri().query() {
        for (k, v) in url::form_urlencoded::parse(q.as_bytes()) {
            match k.as_ref() {
                "url" => raw_target = v.into_owned(),
                "ua" if !v.trim().is_empty() => query_ua = Some(v.into_owned()),
                "health" if v == "1" => is_health = true,
                _ => {}
            }
        }
    }

    if is_health {
        return Ok(json_response(
            StatusCode::OK,
            serde_json::json!({
                "ok": true,
                "service": "lumaNativeRustProxy",
                "version": "0.4.0",
            }),
        ));
    }

    let target_url = match validate_proxy_upstream_url(&raw_target, ctx.port) {
        Ok(u) => u,
        Err(msg) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": msg }),
            ));
        }
    };

    let header_ua = req
        .headers()
        .get("x-luma-user-agent")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    let effective_ua = query_ua
        .or(header_ua)
        .unwrap_or_else(|| "LumaTV/0.4 (Native Tauri Stream Engine)".to_string());

    let method = if req.method() == Method::HEAD {
        reqwest::Method::HEAD
    } else {
        reqwest::Method::GET
    };

    let mut upstream_req = ctx
        .client
        .request(method, target_url.clone())
        .header(USER_AGENT, sanitize_cli_value(&effective_ua))
        .header(ACCEPT, "*/*");

    if let Some(range_val) = req.headers().get(RANGE) {
        if let Ok(range_str) = range_val.to_str() {
            upstream_req = upstream_req.header(RANGE, range_str);
        }
    }

    let upstream = match upstream_req.send().await {
        Ok(res) => res,
        Err(err) => {
            return Ok(json_response(
                StatusCode::BAD_GATEWAY,
                serde_json::json!({
                    "error": "Upstream stream gateway error",
                    "detail": err.to_string(),
                }),
            ));
        }
    };

    let upstream_status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let final_upstream_url = upstream.url().clone();

    let is_hls_playlist = content_type.to_ascii_lowercase().contains("mpegurl")
        || final_upstream_url
            .path()
            .to_ascii_lowercase()
            .ends_with(".m3u8");

    if is_hls_playlist && req.method() != Method::HEAD {
        match upstream.text().await {
            Ok(manifest_text) => {
                let rewritten = rewrite_hls_manifest_for_proxy(
                    &manifest_text,
                    &final_upstream_url,
                    &ctx.endpoint_url,
                    Some(&effective_ua),
                );
                let resp = with_cors_headers(Response::builder().status(upstream_status))
                    .header(CONTENT_TYPE, "application/vnd.apple.mpegurl; charset=utf-8")
                    .header(CACHE_CONTROL, "no-store, max-age=0")
                    .body(full_body(rewritten))
                    .unwrap_or_else(|_| Response::new(empty_body()));
                return Ok(resp);
            }
            Err(err) => {
                return Ok(json_response(
                    StatusCode::BAD_GATEWAY,
                    serde_json::json!({
                        "error": "Failed reading upstream HLS playlist",
                        "detail": err.to_string(),
                    }),
                ));
            }
        }
    }

    let mut resp_builder = with_cors_headers(Response::builder().status(upstream_status))
        .header(CONTENT_TYPE, content_type)
        .header(CACHE_CONTROL, "no-store");

    for passthrough_header in [CONTENT_LENGTH, CONTENT_RANGE, ACCEPT_RANGES] {
        if let Some(val) = upstream.headers().get(&passthrough_header) {
            if let Ok(hv) = HeaderValue::from_bytes(val.as_bytes()) {
                resp_builder = resp_builder.header(passthrough_header, hv);
            }
        }
    }

    if req.method() == Method::HEAD {
        return Ok(resp_builder
            .body(empty_body())
            .unwrap_or_else(|_| Response::new(empty_body())));
    }

    let byte_stream = upstream
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(std::io::Error::other);
    let stream_body: ProxyBody = StreamBody::new(byte_stream).boxed();

    Ok(resp_builder
        .body(stream_body)
        .unwrap_or_else(|_| Response::new(empty_body())))
}

async fn start_local_proxy_server() -> Result<LocalProxyServer, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("Local proxy bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Local proxy addr failed: {e}"))?
        .port();

    let token = generate_session_token();
    let expected_path = format!("/luma-proxy/{token}/stream");
    let endpoint_url = format!("http://127.0.0.1:{port}{expected_path}");

    let client = reqwest::Client::builder()
        .gzip(true)
        .connect_timeout(Duration::from_secs(12))
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Local proxy HTTP client failed: {e}"))?;

    let ctx = Arc::new(ProxyRuntimeContext {
        client,
        port,
        expected_path,
        endpoint_url: endpoint_url.clone(),
    });

    tokio::spawn(async move {
        loop {
            let Ok((stream, _peer)) = listener.accept().await else {
                continue;
            };
            let _ = stream.set_nodelay(true);
            let conn_ctx = Arc::clone(&ctx);
            tokio::spawn(async move {
                let io = TokioIo::new(stream);
                let svc = service_fn(move |req| handle_proxy_request(req, Arc::clone(&conn_ctx)));
                let _ = http1::Builder::new()
                    .keep_alive(true)
                    .serve_connection(io, svc)
                    .await;
            });
        }
    });

    Ok(LocalProxyServer { endpoint_url })
}

async fn ensure_local_proxy_url() -> Option<String> {
    LOCAL_PROXY_INSTANCE
        .get_or_try_init(start_local_proxy_server)
        .await
        .ok()
        .map(|srv| srv.endpoint_url.clone())
}

#[tauri::command]
async fn luma_native_probe_engine() -> NativeEngineCapabilities {
    let platform = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let hw_decoder = match platform {
        "macos" => "Apple VideoToolbox (HEVC / ProRes / HDR10)",
        "android" => "Android MediaCodec + ExoPlayer Surface",
        "windows" => "D3D11VA / NVDEC",
        _ => "VAAPI / Vulkan Video",
    };

    let mpv_resolved = resolve_mpv_binary();
    let mpv_available = mpv_resolved.is_some();
    let mpv_path = mpv_resolved.map(|p| p.to_string_lossy().into_owned());
    let local_proxy_url = ensure_local_proxy_url().await;

    NativeEngineCapabilities {
        bundle_id: "app.lumatv.client",
        platform,
        arch,
        hw_decoder,
        mpv_available,
        mpv_path,
        local_proxy_url,
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
async fn luma_native_fetch_text(
    url: String,
    user_agent: Option<String>,
) -> Result<String, String> {
    let parsed = validate_proxy_upstream_url(&url, 0)?;
    let ua = sanitize_cli_value(
        user_agent
            .as_deref()
            .unwrap_or("LumaTV/0.4 (Native Tauri Bridge)"),
    );
    let client = reqwest::Client::builder()
        .user_agent(ua)
        .gzip(true)
        .connect_timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("HTTP Client Fehler: {e}"))?;

    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Upstream Verbindungsfehler: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Upstream antwortete mit HTTP {}",
            response.status()
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Stream-Lesefehler: {e}"))
}

/// Launches hardware-accelerated MPV session for raw HEVC, AC3/EAC3, MKV,
/// or non-MSE IPTV streams on macOS & Desktop.
#[tauri::command]
async fn luma_native_launch_mpv(
    stream_url: String,
    title: String,
    user_agent: Option<String>,
) -> Result<String, String> {
    let validated_url = validate_mpv_stream_url(&stream_url)?;
    let mpv_bin = resolve_mpv_binary().ok_or_else(|| {
        "MPV wurde nicht gefunden. Bitte via 'brew install mpv' oder mpv.io installieren."
            .to_string()
    })?;

    let clean_title = sanitize_cli_value(&title);
    let clean_ua = sanitize_cli_value(user_agent.as_deref().unwrap_or("LumaTV/0.4"));

    Command::new(&mpv_bin)
        .arg("--hwdec=auto-safe")
        .arg(format!("--force-media-title=Luma TV · {clean_title}"))
        .arg(format!("--user-agent={clean_ua}"))
        .arg("--keep-open=no")
        .arg("--")
        .arg(validated_url.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("MPV konnte nicht gestartet werden ({}): {e}", mpv_bin.display()))?;

    Ok(format!("MPV Hardware-Session gestartet ({})", mpv_bin.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            tauri::async_runtime::spawn(async {
                let _ = ensure_local_proxy_url().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            luma_native_probe_engine,
            luma_native_fetch_text,
            luma_native_launch_mpv
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Luma TV (app.lumatv.client)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_hls_manifest_segments_keys_and_preserves_plus_signs() {
        let base = Url::parse("http://iptv.local:8080/live/u/p/ch+1/index.m3u8").unwrap();
        let manifest = [
            "#EXTM3U",
            "#EXT-X-VERSION:6",
            "#EXT-X-KEY:METHOD=AES-128,URI=\"keys/master+1.key\",IV=0x01",
            "#EXT-X-MAP:URI=\"init.mp4\"",
            "#EXTINF:4.000,",
            "seg_001.ts?token=a+b&exp=99",
        ]
        .join("\n");

        let proxy = "http://127.0.0.1:51234/luma-proxy/tok123/stream";
        let out = rewrite_hls_manifest_for_proxy(&manifest, &base, proxy, Some("TiviMate/4.7.0"));

        let expected_key = percent_encode_component(
            "http://iptv.local:8080/live/u/p/ch+1/keys/master+1.key",
        );
        let expected_seg = percent_encode_component(
            "http://iptv.local:8080/live/u/p/ch+1/seg_001.ts?token=a+b&exp=99",
        );
        assert!(out.contains(&format!("URI=\"{proxy}?url={expected_key}&ua=TiviMate%2F4.7.0\"")));
        assert!(out.contains(&format!("{proxy}?url={expected_seg}&ua=TiviMate%2F4.7.0")));
    }

    #[test]
    fn validates_upstream_urls_and_blocks_self_loop_or_file_scheme() {
        assert!(validate_proxy_upstream_url("file:///etc/passwd", 45000).is_err());
        assert!(validate_proxy_upstream_url("http://127.0.0.1:45000/luma-proxy/x", 45000).is_err());
        assert!(validate_proxy_upstream_url("http://localhost:45000/test", 45000).is_err());
        // LAN IPTV tuners (HDHomeRun / Threadfin / TVHeadend) and public HTTP/HTTPS streams are allowed
        assert!(validate_proxy_upstream_url("http://192.168.178.50:9981/stream/chan1", 45000).is_ok());
        assert!(validate_proxy_upstream_url("https://cdn.example.com/live/master.m3u8", 45000).is_ok());
    }

    #[test]
    fn validates_mpv_stream_url_and_blocks_flag_or_file_injection() {
        assert!(validate_mpv_stream_url("--script=/tmp/evil.lua").is_err());
        assert!(validate_mpv_stream_url("file:///Users/test/secret.mkv").is_err());
        assert!(validate_mpv_stream_url("rtsp://192.168.1.10:554/live").is_ok());
        assert!(validate_mpv_stream_url("http://provider.tv:8080/live/u/p/123.ts").is_ok());
    }

    #[test]
    fn local_proxy_serves_health_rewrites_m3u8_streams_ts_and_enforces_token() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");

        rt.block_on(async {
            // Mock upstream IPTV server
            let upstream_listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let upstream_port = upstream_listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = upstream_listener.accept().await else {
                        break;
                    };
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let svc = service_fn(move |req: Request<Incoming>| async move {
                            let path = req.uri().path().to_string();
                            let ua = req
                                .headers()
                                .get(USER_AGENT)
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                                .to_string();
                            if path == "/live/master.m3u8" {
                                let m3u8 = "#EXTM3U\n#EXTINF:4.0,\nchunk_01.ts\n";
                                return Ok::<_, hyper::Error>(
                                    Response::builder()
                                        .status(StatusCode::OK)
                                        .header(CONTENT_TYPE, "application/vnd.apple.mpegurl")
                                        .body(full_body(m3u8))
                                        .unwrap(),
                                );
                            }
                            if path == "/live/chunk_01.ts" {
                                let payload = format!("TS_OK_UA={ua}");
                                return Ok(
                                    Response::builder()
                                        .status(StatusCode::OK)
                                        .header(CONTENT_TYPE, "video/mp2t")
                                        .body(full_body(payload))
                                        .unwrap(),
                                );
                            }
                            Ok(Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(empty_body())
                                .unwrap())
                        });
                        let _ = http1::Builder::new().serve_connection(io, svc).await;
                    });
                }
            });

            let srv = start_local_proxy_server().await.expect("proxy starts");
            let client = reqwest::Client::new();

            // 1. Health check
            let ok_res = client
                .get(format!("{}?health=1", srv.endpoint_url))
                .send()
                .await
                .expect("health request");
            assert_eq!(ok_res.status(), reqwest::StatusCode::OK);
            let body: serde_json::Value =
                serde_json::from_str(&ok_res.text().await.expect("text")).expect("json");
            assert_eq!(body["service"], "lumaNativeRustProxy");

            // 2. Invalid token returns 403 Forbidden
            let parsed = Url::parse(&srv.endpoint_url).unwrap();
            let bad_url = format!(
                "http://127.0.0.1:{}/luma-proxy/wrong-token/stream?health=1",
                parsed.port().unwrap()
            );
            let forbidden = client.get(bad_url).send().await.expect("bad token request");
            assert_eq!(forbidden.status(), reqwest::StatusCode::FORBIDDEN);

            // 3. HLS manifest rewrite + segment streaming with custom IPTV User-Agent
            let upstream_m3u8 = format!("http://127.0.0.1:{upstream_port}/live/master.m3u8");
            let proxied_m3u8_url = format!(
                "{}?url={}&ua={}",
                srv.endpoint_url,
                percent_encode_component(&upstream_m3u8),
                percent_encode_component("TiviMate/4.7.0")
            );
            let m3u8_res = client.get(&proxied_m3u8_url).send().await.unwrap();
            assert_eq!(
                m3u8_res.headers().get("access-control-allow-origin").unwrap(),
                "*"
            );
            let rewritten_text = m3u8_res.text().await.unwrap();
            let seg_line = rewritten_text
                .lines()
                .find(|l| !l.starts_with('#') && !l.trim().is_empty())
                .expect("rewritten segment URL");
            assert!(seg_line.starts_with(&srv.endpoint_url));

            let seg_res = client.get(seg_line).send().await.unwrap();
            assert_eq!(seg_res.status(), reqwest::StatusCode::OK);
            assert_eq!(seg_res.text().await.unwrap(), "TS_OK_UA=TiviMate/4.7.0");
        });
    }
}
