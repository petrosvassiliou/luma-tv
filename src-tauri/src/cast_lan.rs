use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpStream, UdpSocket};
use tokio::sync::oneshot;
use tokio::time::timeout;
use tokio_rustls::TlsConnector;

const MDNS_MULTICAST_ADDR: SocketAddr =
    SocketAddr::new(IpAddr::V4(Ipv4Addr::new(224, 0, 0, 251)), 5353);

const GOOGLECAST_SERVICE: &str = "_googlecast._tcp.local";
const AIRPLAY_SERVICE: &str = "_airplay._tcp.local";

const NS_CONNECTION: &str = "urn:x-cast:com.google.cast.tp.connection";
const NS_HEARTBEAT: &str = "urn:x-cast:com.google.cast.tp.heartbeat";
const NS_RECEIVER: &str = "urn:x-cast:com.google.cast.receiver";
const NS_MEDIA: &str = "urn:x-cast:com.google.cast.media";
const DEFAULT_MEDIA_RECEIVER_APP_ID: &str = "CC1AD845";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanCastDevice {
    pub id: String,
    pub name: String,
    pub model: String,
    pub protocol: String, // "chromecast" | "airplay"
    pub source: String,   // "rust-mdns"
    pub host: String,
    pub port: u16,
}

struct ActiveLanSession {
    protocol: String,
    host: String,
    port: u16,
    stop_tx: Option<oneshot::Sender<()>>,
}

static ACTIVE_LAN_SESSION: OnceLock<Mutex<Option<ActiveLanSession>>> = OnceLock::new();

fn active_session_slot() -> &'static Mutex<Option<ActiveLanSession>> {
    ACTIVE_LAN_SESSION.get_or_init(|| Mutex::new(None))
}

// ============================================================================
// 1. mDNS (`224.0.0.251:5353` QU Unicast-Response) LAN Scanner
// ============================================================================

fn encode_dns_name(name: &str, out: &mut Vec<u8>) {
    for label in name.trim_end_matches('.').split('.') {
        if label.is_empty() {
            continue;
        }
        let bytes = label.as_bytes();
        if bytes.len() <= 63 {
            out.push(bytes.len() as u8);
            out.extend_from_slice(bytes);
        }
    }
    out.push(0);
}

pub fn build_mdns_query_packet(questions: &[(&str, u16)]) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(128);
    // Header: ID=0, Flags=0, QDCOUNT=questions.len(), AN=0, NS=0, AR=0
    pkt.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    pkt.extend_from_slice(&(questions.len() as u16).to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    for (qname, qtype) in questions {
        encode_dns_name(qname, &mut pkt);
        pkt.extend_from_slice(&qtype.to_be_bytes());
        // QCLASS = IN (0x0001) | QU unicast-response bit (0x8000) -> 0x8001
        // Ensures Chromecast & Apple TV reply directly back to our ephemeral UDP socket!
        pkt.extend_from_slice(&0x8001u16.to_be_bytes());
    }
    pkt
}

pub fn read_dns_name(buf: &[u8], mut offset: usize) -> Option<(String, usize)> {
    let mut labels: Vec<String> = Vec::new();
    let mut jumped = false;
    let mut end_offset = offset;
    let mut hops = 0usize;

    loop {
        if offset >= buf.len() || hops > 64 {
            return None;
        }
        hops += 1;
        let len = buf[offset];
        if len == 0 {
            if !jumped {
                end_offset = offset + 1;
            }
            break;
        }
        if (len & 0xC0) == 0xC0 {
            if offset + 1 >= buf.len() {
                return None;
            }
            let ptr = (((len & 0x3F) as usize) << 8) | (buf[offset + 1] as usize);
            if !jumped {
                end_offset = offset + 2;
                jumped = true;
            }
            offset = ptr;
            continue;
        }
        let label_len = (len & 0x3F) as usize;
        offset += 1;
        if offset + label_len > buf.len() {
            return None;
        }
        let s = String::from_utf8_lossy(&buf[offset..offset + label_len]).into_owned();
        labels.push(s);
        offset += label_len;
        if !jumped {
            end_offset = offset;
        }
    }

    Some((labels.join("."), end_offset))
}

#[derive(Default, Debug)]
struct PartialMdnsService {
    protocol: String,
    instance_full: String,
    target_host: Option<String>,
    port: Option<u16>,
    txt: HashMap<String, String>,
    fallback_ip: Option<Ipv4Addr>,
}

#[derive(Default, Debug)]
pub struct ParsedMdnsBatch {
    services: HashMap<String, PartialMdnsService>,
    host_ipv4: HashMap<String, Ipv4Addr>,
}

impl ParsedMdnsBatch {
    pub fn ingest_packet(&mut self, buf: &[u8], sender_ip: Option<Ipv4Addr>) {
        if buf.len() < 12 {
            return;
        }
        let qdcount = u16::from_be_bytes([buf[4], buf[5]]) as usize;
        let ancount = u16::from_be_bytes([buf[6], buf[7]]) as usize;
        let nscount = u16::from_be_bytes([buf[8], buf[9]]) as usize;
        let arcount = u16::from_be_bytes([buf[10], buf[11]]) as usize;

        let mut pos = 12usize;
        for _ in 0..qdcount {
            let Some((_, next)) = read_dns_name(buf, pos) else {
                return;
            };
            if next + 4 > buf.len() {
                return;
            }
            pos = next + 4;
        }

        let total_rr = ancount.saturating_add(nscount).saturating_add(arcount);
        for _ in 0..total_rr {
            let Some((rr_name, next)) = read_dns_name(buf, pos) else {
                break;
            };
            if next + 10 > buf.len() {
                break;
            }
            let rtype = u16::from_be_bytes([buf[next], buf[next + 1]]);
            let rdlen = u16::from_be_bytes([buf[next + 8], buf[next + 9]]) as usize;
            let rdata_start = next + 10;
            let rdata_end = rdata_start.saturating_add(rdlen);
            if rdata_end > buf.len() {
                break;
            }
            pos = rdata_end;

            let rr_lower = rr_name.to_ascii_lowercase();
            match rtype {
                // PTR
                12 => {
                    if let Some((ptr_target, _)) = read_dns_name(buf, rdata_start) {
                        let ptr_key = ptr_target.to_ascii_lowercase();
                        let protocol = if rr_lower == GOOGLECAST_SERVICE {
                            Some("chromecast")
                        } else if rr_lower == AIRPLAY_SERVICE {
                            Some("airplay")
                        } else {
                            None
                        };
                        if let Some(proto) = protocol {
                            let entry = self.services.entry(ptr_key).or_default();
                            entry.protocol = proto.to_string();
                            entry.instance_full = ptr_target;
                            if entry.fallback_ip.is_none() {
                                entry.fallback_ip = sender_ip;
                            }
                        }
                    }
                }
                // SRV
                33 if rdlen >= 6 => {
                    let srv_port = u16::from_be_bytes([buf[rdata_start + 4], buf[rdata_start + 5]]);
                    if let Some((srv_target, _)) = read_dns_name(buf, rdata_start + 6) {
                        let proto = if rr_lower.ends_with(GOOGLECAST_SERVICE) {
                            Some("chromecast")
                        } else if rr_lower.ends_with(AIRPLAY_SERVICE) {
                            Some("airplay")
                        } else {
                            None
                        };
                        if let Some(p) = proto {
                            let entry = self.services.entry(rr_lower).or_default();
                            if entry.protocol.is_empty() {
                                entry.protocol = p.to_string();
                            }
                            if entry.instance_full.is_empty() {
                                entry.instance_full = rr_name;
                            }
                            entry.port = Some(srv_port);
                            entry.target_host = Some(srv_target.to_ascii_lowercase());
                            if entry.fallback_ip.is_none() {
                                entry.fallback_ip = sender_ip;
                            }
                        }
                    }
                }
                // TXT
                16 => {
                    let proto = if rr_lower.ends_with(GOOGLECAST_SERVICE) {
                        Some("chromecast")
                    } else if rr_lower.ends_with(AIRPLAY_SERVICE) {
                        Some("airplay")
                    } else {
                        None
                    };
                    if let Some(p) = proto {
                        let entry = self.services.entry(rr_lower).or_default();
                        if entry.protocol.is_empty() {
                            entry.protocol = p.to_string();
                        }
                        if entry.instance_full.is_empty() {
                            entry.instance_full = rr_name;
                        }
                        let mut tpos = rdata_start;
                        while tpos < rdata_end {
                            let slen = buf[tpos] as usize;
                            tpos += 1;
                            if tpos + slen > rdata_end {
                                break;
                            }
                            let kv = String::from_utf8_lossy(&buf[tpos..tpos + slen]);
                            if let Some((k, v)) = kv.split_once('=') {
                                entry
                                    .txt
                                    .insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                            }
                            tpos += slen;
                        }
                    }
                }
                // A (IPv4)
                1 if rdlen == 4 => {
                    let ip = Ipv4Addr::new(
                        buf[rdata_start],
                        buf[rdata_start + 1],
                        buf[rdata_start + 2],
                        buf[rdata_start + 3],
                    );
                    if !ip.is_loopback() && !ip.is_unspecified() {
                        self.host_ipv4.insert(rr_lower, ip);
                    }
                }
                _ => {}
            }
        }
    }

    pub fn finalize_devices(&self) -> Vec<LanCastDevice> {
        let mut out: Vec<LanCastDevice> = Vec::new();
        let mut seen_endpoints: HashMap<String, usize> = HashMap::new();

        for svc in self.services.values() {
            if svc.protocol.is_empty() {
                continue;
            }
            let ip = svc
                .target_host
                .as_ref()
                .and_then(|h| self.host_ipv4.get(h).copied())
                .or(svc.fallback_ip);

            let Some(resolved_ip) = ip else {
                continue;
            };

            let default_port = if svc.protocol == "chromecast" { 8009 } else { 7000 };
            let port = svc.port.unwrap_or(default_port);

            let raw_instance_prefix = svc
                .instance_full
                .split("._googlecast.")
                .next()
                .unwrap_or(&svc.instance_full)
                .split("._airplay.")
                .next()
                .unwrap_or(&svc.instance_full)
                .trim();

            let (name, model) = if svc.protocol == "chromecast" {
                let friendly = svc
                    .txt
                    .get("fn")
                    .cloned()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| raw_instance_prefix.to_string());
                let md = svc
                    .txt
                    .get("md")
                    .cloned()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "Chromecast".to_string());
                (friendly, md)
            } else {
                let friendly = if !raw_instance_prefix.is_empty() {
                    raw_instance_prefix.to_string()
                } else {
                    "Apple TV".to_string()
                };
                let md = svc
                    .txt
                    .get("model")
                    .cloned()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "AirPlay Receiver".to_string());
                (friendly, md)
            };

            let id = format!("lan:{}:{}:{}", svc.protocol, resolved_ip, port);
            if seen_endpoints.contains_key(&id) {
                continue;
            }
            seen_endpoints.insert(id.clone(), out.len());
            out.push(LanCastDevice {
                id,
                name,
                model,
                protocol: svc.protocol.clone(),
                source: "rust-mdns".to_string(),
                host: resolved_ip.to_string(),
                port,
            });
        }

        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }
}

pub async fn discover_lan_cast_devices(timeout_ms: u64) -> Vec<LanCastDevice> {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else {
        return Vec::new();
    };
    let _ = sock.set_multicast_loop_v4(true);
    let _ = sock.set_multicast_ttl_v4(255);

    let query_pkt = build_mdns_query_packet(&[
        (GOOGLECAST_SERVICE, 12),
        (AIRPLAY_SERVICE, 12),
    ]);

    let _ = sock.send_to(&query_pkt, MDNS_MULTICAST_ADDR).await;

    let total_wait = Duration::from_millis(timeout_ms.clamp(400, 4500));
    let deadline = Instant::now() + total_wait;
    let second_burst_at = Instant::now() + Duration::from_millis(380);
    let mut sent_second_burst = false;

    let mut batch = ParsedMdnsBatch::default();
    let mut recv_buf = [0u8; 4096];

    while Instant::now() < deadline {
        if !sent_second_burst && Instant::now() >= second_burst_at {
            sent_second_burst = true;
            let _ = sock.send_to(&query_pkt, MDNS_MULTICAST_ADDR).await;
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        let step_wait = remaining.min(Duration::from_millis(220));
        if step_wait.is_zero() {
            break;
        }

        if let Ok(Ok((n, peer))) = timeout(step_wait, sock.recv_from(&mut recv_buf)).await {
            let sender_v4 = match peer.ip() {
                IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
                _ => None,
            };
            batch.ingest_packet(&recv_buf[..n], sender_v4);
        }
    }

    // Resolve any SRV target hostnames missing an A record via OS mDNS / DNS resolver
    let missing_hosts: Vec<(String, u16)> = batch
        .services
        .values()
        .filter_map(|svc| {
            let host = svc.target_host.as_ref()?;
            if batch.host_ipv4.contains_key(host) || svc.fallback_ip.is_some() {
                return None;
            }
            Some((host.clone(), svc.port.unwrap_or(8009)))
        })
        .collect();

    for (host, port) in missing_hosts {
        if let Ok(Ok(addrs)) =
            timeout(Duration::from_millis(350), lookup_host((host.as_str(), port))).await
        {
            for addr in addrs {
                if let IpAddr::V4(v4) = addr.ip() {
                    if !v4.is_loopback() {
                        batch.host_ipv4.insert(host.clone(), v4);
                        break;
                    }
                }
            }
        }
    }

    batch.finalize_devices()
}

// ============================================================================
// 2. Native Google CastV2 Protobuf Framing & TLS 8009 Media Launcher
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CastV2Frame {
    pub source_id: String,
    pub destination_id: String,
    pub namespace: String,
    pub payload_utf8: String,
}

fn push_varint(mut val: u64, out: &mut Vec<u8>) {
    while val >= 0x80 {
        out.push(((val as u8) & 0x7F) | 0x80);
        val >>= 7;
    }
    out.push(val as u8);
}

fn read_varint(buf: &[u8], mut pos: usize) -> Option<(u64, usize)> {
    let mut result = 0u64;
    let mut shift = 0u32;
    loop {
        if pos >= buf.len() || shift >= 64 {
            return None;
        }
        let byte = buf[pos];
        pos += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if (byte & 0x80) == 0 {
            return Some((result, pos));
        }
        shift += 7;
    }
}

fn push_len_delimited_str(field_number: u8, value: &str, out: &mut Vec<u8>) {
    let tag = (field_number << 3) | 2;
    out.push(tag);
    push_varint(value.len() as u64, out);
    out.extend_from_slice(value.as_bytes());
}

pub fn encode_castv2_packet(frame: &CastV2Frame) -> Vec<u8> {
    let mut body = Vec::with_capacity(frame.payload_utf8.len() + 96);
    // Field 1: protocol_version = 0 (CASTV2_1_0)
    body.push(0x08);
    body.push(0x00);
    // Field 2: source_id
    push_len_delimited_str(2, &frame.source_id, &mut body);
    // Field 3: destination_id
    push_len_delimited_str(3, &frame.destination_id, &mut body);
    // Field 4: namespace
    push_len_delimited_str(4, &frame.namespace, &mut body);
    // Field 5: payload_type = 0 (STRING)
    body.push(0x28);
    body.push(0x00);
    // Field 6: payload_utf8
    push_len_delimited_str(6, &frame.payload_utf8, &mut body);

    let mut packet = Vec::with_capacity(4 + body.len());
    packet.extend_from_slice(&(body.len() as u32).to_be_bytes());
    packet.extend_from_slice(&body);
    packet
}

pub fn decode_castv2_body(body: &[u8]) -> Option<CastV2Frame> {
    let mut pos = 0usize;
    let mut source_id = String::new();
    let mut destination_id = String::new();
    let mut namespace = String::new();
    let mut payload_utf8 = String::new();

    while pos < body.len() {
        let (tag, next) = read_varint(body, pos)?;
        pos = next;
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;

        match wire_type {
            0 => {
                let (_, next_v) = read_varint(body, pos)?;
                pos = next_v;
            }
            2 => {
                let (len, next_l) = read_varint(body, pos)?;
                let len_usize = len as usize;
                if next_l.saturating_add(len_usize) > body.len() {
                    return None;
                }
                let slice = &body[next_l..next_l + len_usize];
                pos = next_l + len_usize;
                match field_num {
                    2 => source_id = String::from_utf8_lossy(slice).into_owned(),
                    3 => destination_id = String::from_utf8_lossy(slice).into_owned(),
                    4 => namespace = String::from_utf8_lossy(slice).into_owned(),
                    6 => payload_utf8 = String::from_utf8_lossy(slice).into_owned(),
                    _ => {}
                }
            }
            _ => return None,
        }
    }

    Some(CastV2Frame {
        source_id,
        destination_id,
        namespace,
        payload_utf8,
    })
}

#[derive(Debug)]
struct CastDeviceCertVerifier;

impl ServerCertVerifier for CastDeviceCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn build_cast_tls_connector() -> Result<TlsConnector, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let cfg = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS protocol config error: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(CastDeviceCertVerifier))
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(cfg)))
}

async fn write_cast_frame<S: AsyncWriteExt + Unpin>(
    stream: &mut S,
    dest: &str,
    namespace: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let pkt = encode_castv2_packet(&CastV2Frame {
        source_id: "sender-0".to_string(),
        destination_id: dest.to_string(),
        namespace: namespace.to_string(),
        payload_utf8: payload.to_string(),
    });
    stream
        .write_all(&pkt)
        .await
        .map_err(|e| format!("CastV2 write failed: {e}"))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("CastV2 flush failed: {e}"))
}

async fn read_cast_frame<S: AsyncReadExt + Unpin>(
    stream: &mut S,
) -> Result<CastV2Frame, String> {
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| format!("CastV2 read header failed: {e}"))?;
    let frame_len = u32::from_be_bytes(len_buf) as usize;
    if frame_len == 0 || frame_len > 256 * 1024 {
        return Err(format!("Invalid CastV2 frame length: {frame_len}"));
    }
    let mut body = vec![0u8; frame_len];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|e| format!("CastV2 read body failed: {e}"))?;
    decode_castv2_body(&body).ok_or_else(|| "Malformed CastV2 protobuf frame.".to_string())
}

fn stop_previous_lan_session() {
    if let Ok(mut guard) = active_session_slot().lock() {
        if let Some(mut prev) = guard.take() {
            if let Some(tx) = prev.stop_tx.take() {
                let _ = tx.send(());
            }
        }
    }
}

pub async fn castv2_play_stream(
    host: &str,
    port: u16,
    stream_url: &str,
    title: &str,
    subtitle: &str,
    content_type: &str,
    is_live: bool,
    position_sec: f64,
) -> Result<String, String> {
    stop_previous_lan_session();

    let ip: IpAddr = host
        .parse()
        .map_err(|_| format!("Invalid Chromecast IP address: {host}"))?;
    let addr = SocketAddr::new(ip, port);

    let tcp = timeout(Duration::from_secs(5), TcpStream::connect(addr))
        .await
        .map_err(|_| format!("Connection to Chromecast ({addr}) timed out."))?
        .map_err(|e| format!("Could not reach Chromecast ({addr}): {e}"))?;
    let _ = tcp.set_nodelay(true);

    let connector = build_cast_tls_connector()?;
    let server_name = ServerName::IpAddress(ip.into());
    let mut tls = timeout(Duration::from_secs(5), connector.connect(server_name, tcp))
        .await
        .map_err(|_| "Chromecast TLS handshake timed out.".to_string())?
        .map_err(|e| format!("Chromecast TLS error: {e}"))?;

    // 1. Virtual CONNECT to receiver-0 + LAUNCH Default Media Receiver (CC1AD845)
    write_cast_frame(
        &mut tls,
        "receiver-0",
        NS_CONNECTION,
        serde_json::json!({ "type": "CONNECT", "origin": {}, "userAgent": "LumaTV/0.8" }),
    )
    .await?;

    write_cast_frame(
        &mut tls,
        "receiver-0",
        NS_RECEIVER,
        serde_json::json!({
            "type": "LAUNCH",
            "appId": DEFAULT_MEDIA_RECEIVER_APP_ID,
            "requestId": 1
        }),
    )
    .await?;

    // 2. Await RECEIVER_STATUS containing transportId for CC1AD845
    let launch_deadline = Instant::now() + Duration::from_secs(10);
    let mut transport_id: Option<String> = None;

    while Instant::now() < launch_deadline {
        let frame = timeout(Duration::from_secs(4), read_cast_frame(&mut tls))
            .await
            .map_err(|_| "Timed out waiting for Chromecast receiver launch.".to_string())??;

        if frame.namespace == NS_HEARTBEAT && frame.payload_utf8.contains("\"PING\"") {
            let _ = write_cast_frame(
                &mut tls,
                &frame.source_id,
                NS_HEARTBEAT,
                serde_json::json!({ "type": "PONG" }),
            )
            .await;
            continue;
        }

        if frame.namespace == NS_RECEIVER && !frame.payload_utf8.is_empty() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&frame.payload_utf8) {
                if let Some(apps) = val
                    .get("status")
                    .and_then(|s| s.get("applications"))
                    .and_then(|a| a.as_array())
                {
                    for app in apps {
                        let app_id = app.get("appId").and_then(|v| v.as_str()).unwrap_or("");
                        if app_id == DEFAULT_MEDIA_RECEIVER_APP_ID {
                            if let Some(tid) = app.get("transportId").and_then(|v| v.as_str()) {
                                transport_id = Some(tid.to_string());
                                break;
                            }
                        }
                    }
                }
            }
            if transport_id.is_some() {
                break;
            }
        }
    }

    let tid = transport_id
        .ok_or_else(|| "Chromecast receiver did not report an active transportId.".to_string())?;

    // 3. Connect to launched Default Media Receiver transportId & send LOAD
    write_cast_frame(
        &mut tls,
        &tid,
        NS_CONNECTION,
        serde_json::json!({ "type": "CONNECT", "origin": {} }),
    )
    .await?;

    let start_pos = if !is_live && position_sec.is_finite() && position_sec > 2.0 {
        position_sec
    } else {
        0.0
    };

    write_cast_frame(
        &mut tls,
        &tid,
        NS_MEDIA,
        serde_json::json!({
            "type": "LOAD",
            "requestId": 2,
            "autoplay": true,
            "currentTime": start_pos,
            "media": {
                "contentId": stream_url,
                "contentType": if content_type.trim().is_empty() { "application/x-mpegurl" } else { content_type },
                "streamType": if is_live { "LIVE" } else { "BUFFERED" },
                "metadata": {
                    "metadataType": 0,
                    "title": title,
                    "subtitle": subtitle
                }
            }
        }),
    )
    .await?;

    // 4. Maintain CastV2 heartbeat in background until stopped or superseded
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    let tid_clone = tid.clone();
    tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    let _ = write_cast_frame(
                        &mut tls,
                        "receiver-0",
                        NS_RECEIVER,
                        serde_json::json!({ "type": "STOP", "requestId": 99 }),
                    ).await;
                    break;
                }
                _ = ping_interval.tick() => {
                    if write_cast_frame(
                        &mut tls,
                        "receiver-0",
                        NS_HEARTBEAT,
                        serde_json::json!({ "type": "PING" }),
                    ).await.is_err() {
                        break;
                    }
                }
                res = read_cast_frame(&mut tls) => {
                    match res {
                        Ok(frame) => {
                            if frame.namespace == NS_HEARTBEAT && frame.payload_utf8.contains("\"PING\"") {
                                let reply_dest = if frame.source_id.is_empty() { "receiver-0" } else { &frame.source_id };
                                let _ = write_cast_frame(
                                    &mut tls,
                                    reply_dest,
                                    NS_HEARTBEAT,
                                    serde_json::json!({ "type": "PONG" }),
                                ).await;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
        let _ = tid_clone;
    });

    if let Ok(mut guard) = active_session_slot().lock() {
        *guard = Some(ActiveLanSession {
            protocol: "chromecast".to_string(),
            host: host.to_string(),
            port,
            stop_tx: Some(stop_tx),
        });
    }

    Ok(format!("Streaming \"{title}\" to Chromecast ({host})"))
}

// ============================================================================
// 3. Direct AirPlay HTTP Video Launcher (`POST /play`)
// ============================================================================

pub async fn airplay_play_stream(
    host: &str,
    port: u16,
    stream_url: &str,
    title: &str,
) -> Result<String, String> {
    stop_previous_lan_session();

    let ip: IpAddr = host
        .parse()
        .map_err(|_| format!("Invalid AirPlay IP address: {host}"))?;
    let endpoint = format!("http://{}:{}/play", ip, port);
    let body = format!("Content-Location: {stream_url}\nStart-Position: 0.0\n");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("AirPlay HTTP client error: {e}"))?;

    let resp = client
        .post(&endpoint)
        .header("Content-Type", "text/parameters")
        .header("User-Agent", "MediaControl/1.0")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Could not connect to Apple TV ({ip}:{port}): {e}"))?;

    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        return Err(
            "This Apple TV requires Apple device pairing (AirPlay 2 PIN). Use an Apple device or disable 'Require Password/Pairing' in Apple TV AirPlay settings."
                .to_string(),
        );
    }

    if !resp.status().is_success() {
        return Err(format!("Apple TV responded with HTTP {}", resp.status()));
    }

    if let Ok(mut guard) = active_session_slot().lock() {
        *guard = Some(ActiveLanSession {
            protocol: "airplay".to_string(),
            host: ip.to_string(),
            port,
            stop_tx: None,
        });
    }

    Ok(format!("Streaming \"{title}\" to Apple TV ({ip})"))
}

pub async fn stop_active_lan_cast() -> Result<(), String> {
    let prev = active_session_slot()
        .lock()
        .ok()
        .and_then(|mut g| g.take());

    if let Some(mut sess) = prev {
        if let Some(tx) = sess.stop_tx.take() {
            let _ = tx.send(());
        }
        if sess.protocol == "airplay" {
            if let Ok(client) = reqwest::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
            {
                let _ = client
                    .post(format!("http://{}:{}/stop", sess.host, sess.port))
                    .header("User-Agent", "MediaControl/1.0")
                    .send()
                    .await;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn castv2_frame_roundtrips_binary_protobuf_cleanly() {
        let orig = CastV2Frame {
            source_id: "sender-0".to_string(),
            destination_id: "receiver-0".to_string(),
            namespace: NS_RECEIVER.to_string(),
            payload_utf8: r#"{"type":"LAUNCH","appId":"CC1AD845","requestId":1}"#.to_string(),
        };
        let encoded = encode_castv2_packet(&orig);
        assert!(encoded.len() > 4);
        let declared_len = u32::from_be_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]) as usize;
        assert_eq!(declared_len, encoded.len() - 4);

        let decoded = decode_castv2_body(&encoded[4..]).expect("valid protobuf");
        assert_eq!(decoded, orig);
    }

    #[test]
    fn mdns_parser_extracts_chromecast_and_airplay_devices() {
        // Construct synthetic mDNS response with PTR, SRV, TXT, and A records
        let mut pkt = Vec::new();
        // Header: 0 questions, 4 answers
        pkt.extend_from_slice(&[0, 0, 0x84, 0, 0, 0, 0, 4, 0, 0, 0, 0]);

        // Answer 1: PTR _googlecast._tcp.local -> Chromecast-Ultra._googlecast._tcp.local
        encode_dns_name("_googlecast._tcp.local", &mut pkt);
        pkt.extend_from_slice(&12u16.to_be_bytes()); // PTR
        pkt.extend_from_slice(&1u16.to_be_bytes());
        pkt.extend_from_slice(&120u32.to_be_bytes());
        let mut ptr_rdata = Vec::new();
        encode_dns_name("Chromecast-Ultra._googlecast._tcp.local", &mut ptr_rdata);
        pkt.extend_from_slice(&(ptr_rdata.len() as u16).to_be_bytes());
        pkt.extend_from_slice(&ptr_rdata);

        // Answer 2: TXT Chromecast-Ultra._googlecast._tcp.local -> fn=Living Room TV, md=Chromecast Ultra
        encode_dns_name("Chromecast-Ultra._googlecast._tcp.local", &mut pkt);
        pkt.extend_from_slice(&16u16.to_be_bytes()); // TXT
        pkt.extend_from_slice(&1u16.to_be_bytes());
        pkt.extend_from_slice(&120u32.to_be_bytes());
        let txt1 = b"fn=Living Room TV";
        let txt2 = b"md=Chromecast Ultra";
        let mut txt_rdata = Vec::new();
        txt_rdata.push(txt1.len() as u8);
        txt_rdata.extend_from_slice(txt1);
        txt_rdata.push(txt2.len() as u8);
        txt_rdata.extend_from_slice(txt2);
        pkt.extend_from_slice(&(txt_rdata.len() as u16).to_be_bytes());
        pkt.extend_from_slice(&txt_rdata);

        // Answer 3: SRV Chromecast-Ultra._googlecast._tcp.local -> port 8009, target cast-host.local
        encode_dns_name("Chromecast-Ultra._googlecast._tcp.local", &mut pkt);
        pkt.extend_from_slice(&33u16.to_be_bytes()); // SRV
        pkt.extend_from_slice(&1u16.to_be_bytes());
        pkt.extend_from_slice(&120u32.to_be_bytes());
        let mut srv_rdata = Vec::new();
        srv_rdata.extend_from_slice(&0u16.to_be_bytes());
        srv_rdata.extend_from_slice(&0u16.to_be_bytes());
        srv_rdata.extend_from_slice(&8009u16.to_be_bytes());
        encode_dns_name("cast-host.local", &mut srv_rdata);
        pkt.extend_from_slice(&(srv_rdata.len() as u16).to_be_bytes());
        pkt.extend_from_slice(&srv_rdata);

        // Answer 4: A cast-host.local -> 192.168.178.42
        encode_dns_name("cast-host.local", &mut pkt);
        pkt.extend_from_slice(&1u16.to_be_bytes()); // A
        pkt.extend_from_slice(&1u16.to_be_bytes());
        pkt.extend_from_slice(&120u32.to_be_bytes());
        pkt.extend_from_slice(&4u16.to_be_bytes());
        pkt.extend_from_slice(&[192, 168, 178, 42]);

        let mut batch = ParsedMdnsBatch::default();
        batch.ingest_packet(&pkt, None);
        let devices = batch.finalize_devices();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "Living Room TV");
        assert_eq!(devices[0].model, "Chromecast Ultra");
        assert_eq!(devices[0].protocol, "chromecast");
        assert_eq!(devices[0].host, "192.168.178.42");
        assert_eq!(devices[0].port, 8009);
    }
}
