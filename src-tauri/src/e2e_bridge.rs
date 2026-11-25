//! Test-only HTTP bridge: drives the real webview from an external Node script.
//!
//! Replaces `tauri-plugin-webdriver-automation`, whose runtime-registered `resolve`
//! command is rejected by Tauri 2.11.5, so every JS-eval route timed out.
//! The page is served by Vite on another origin, so every response is CORS-open.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(30);

type Shared = Arc<Mutex<Option<String>>>;

pub fn start(app: tauri::AppHandle) {
    let listener = match bind() {
        Ok(l) => l,
        Err(err) => {
            eprintln!("[e2e-bridge] failed to bind: {err}");
            return;
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    println!("[e2e-bridge] listening on port {port}");
    let _ = std::io::stdout().flush();

    let result: Shared = Arc::new(Mutex::new(None));
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            let result = Arc::clone(&result);
            // One thread per connection: a stalled page must not stop the listener.
            std::thread::spawn(move || {
                let _ = handle(stream, app, result, port);
            });
        }
    });
}

fn bind() -> std::io::Result<TcpListener> {
    if let Ok(raw) = std::env::var("BEAVER_E2E_PORT") {
        if let Ok(port) = raw.trim().parse::<u16>() {
            return TcpListener::bind(("127.0.0.1", port));
        }
    }
    TcpListener::bind(("127.0.0.1", 0))
}

fn handle(
    mut stream: TcpStream,
    app: tauri::AppHandle,
    result: Shared,
    port: u16,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;

    let Some((method, path, body)) = read_request(&mut stream) else {
        respond(&mut stream, 400, r#"{"error":"bad request"}"#);
        return Ok(());
    };

    if method == "OPTIONS" {
        respond(&mut stream, 204, "");
        return Ok(());
    }

    match (method.as_str(), path.as_str()) {
        ("GET", "/ping") => {
            respond(&mut stream, 200, &format!(r#"{{"ok":true,"port":{port}}}"#));
        }
        ("POST", "/eval") => {
            *result.lock().unwrap_or_else(|e| e.into_inner()) = None;
            let source = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(str::to_owned))
                .unwrap_or(body);
            let js = eval_wrapper(&source, port);
            let windows = app.webview_windows();
            let window = app
                .get_webview_window("main")
                .or_else(|| windows.values().next().cloned());
            match window {
                None => {
                    eprintln!(
                        "[e2e-bridge] no webview window (labels: {:?})",
                        windows.keys().collect::<Vec<_>>()
                    );
                }
                Some(window) => match window.eval(&js) {
                    Ok(()) => eprintln!(
                        "[e2e-bridge] eval queued on window '{}'",
                        window.label()
                    ),
                    Err(err) => eprintln!("[e2e-bridge] eval failed: {err}"),
                },
            }
            respond(&mut stream, 200, r#"{"queued":true}"#);
        }
        ("POST", "/result") => {
            *result.lock().unwrap_or_else(|e| e.into_inner()) = Some(body);
            respond(&mut stream, 200, r#"{"ok":true}"#);
        }
        ("GET", "/result") => {
            let latest = result.lock().unwrap_or_else(|e| e.into_inner()).clone();
            match latest {
                Some(value) => respond(&mut stream, 200, &value),
                None => respond(&mut stream, 200, r#"{"ok":null,"error":"no result yet"}"#),
            }
        }
        _ => {
            respond(&mut stream, 404, r#"{"error":"not found"}"#);
        }
    }

    Ok(())
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(index) = find(&buf, b"\r\n\r\n") {
            break index + 4;
        }
        if buf.len() > MAX_REQUEST_BYTES {
            return None;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return None,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };

    let head = String::from_utf8_lossy(&buf[..head_end - 4]).to_string();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_string();
    let path = request_line.next()?.to_string();

    let length: usize = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse().ok())
        .unwrap_or(0);

    let mut body = buf.split_off(head_end);
    if body.len() < length {
        let mut rest = vec![0u8; length - body.len()];
        stream.read_exact(&mut rest).ok()?;
        body.extend_from_slice(&rest);
    }
    body.truncate(length);
    Some((method, path, String::from_utf8_lossy(&body).to_string()))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Error",
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: content-type\r\n\
         Content-Type: application/json\r\n\
         Connection: close\r\n"
    );
    if status != 204 {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");

    let _ = stream.write_all(head.as_bytes());
    if status != 204 {
        let _ = stream.write_all(body.as_bytes());
    }
    let _ = stream.flush();
}

/// Wraps the harness source so the page evaluates it once, awaits it and POSTs the
/// value (or the error) back to `/result`.
///
/// The source is spliced in as a function *body* rather than compiled with
/// `new Function`: Tauri's `eval` runs through WebKit's `evaluateJavaScript`,
/// which the page CSP does not cover, but a `new Function` inside the page does
/// (`script-src 'self' 'wasm-unsafe-eval'`, no `unsafe-eval`), so building the
/// function dynamically fails on every call. Callers must pass statements
/// ending in `return`, the same shape the old `new Function` wrapper accepted.
fn eval_wrapper(source: &str, port: u16) -> String {
    format!(
        r#"(async()=>{{
// 127.0.0.1, never "localhost": the bridge binds IPv4 only, but WebKit resolves
// localhost to ::1 first and - unlike curl - does not fall back, so the result
// POST vanished into the catch below and every eval answered "no result yet".
const post=(b)=>fetch("http://127.0.0.1:{port}/result",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(b)}}).catch(()=>{{}});
try{{
const value=await (async()=>{{
{source}
}})();
await post({{ok:true,value:value===undefined?null:value}});
}}catch(e){{
 await post({{ok:false,error:String((e&&(e.stack||e.message))||e)}});
}}
}})()"#
    )
}
