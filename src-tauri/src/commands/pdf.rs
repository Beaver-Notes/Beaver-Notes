//! PDF export for Beaver Notes.
//!
//! The export HTML (built by `exportBulk.js`) includes a measurement script
//! that inserts `break-after:page` markers into the DOM. Every platform
//! then uses its native print / PDF-capture API to produce a correctly
//! paginated multi-page A4 PDF — no post-hoc PDF surgery is needed.
//!
//! - **macOS**: hidden `WKWebView` inside a Tauri `WebviewWindow`,
//!   captured via `WKWebView.printOperationWithPrintInfo:`.
//! - **Windows**: hidden `WebView2` via `webview2-com`, printed via
//!   `ICoreWebView2.PrintToPdf`.
//! - **Linux**: hidden `WebKitGTK` `WebView`, printed via
//!   `WebKitPrintOperation`.
//! - **iOS/Android**: handled by `tauri-plugin-pdf-render`.
//!   - **iOS**: `WKWebView` with `UIPrintPageRenderer`.
//!   - **Android**: `WebView` with `PrintDocumentAdapter`.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

#[cfg(target_os = "macos")]
use std::sync::mpsc;

#[cfg(target_os = "macos")]
use tokio::sync::oneshot;

#[cfg(target_os = "macos")]
use tauri::webview::PageLoadEvent;

#[cfg(target_os = "macos")]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "macos")]
static PDF_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
fn next_pdf_window_label() -> String {
    let n = PDF_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("pdf-render-{n}")
}

#[cfg(target_os = "macos")]
const A4_CSS_W: f64 = 794.0;

#[cfg(target_os = "macos")]
const A4_CSS_H: f64 = 1123.0;

#[cfg(target_os = "macos")]
const A4_PT_W: f64 = 595.0;

#[cfg(target_os = "macos")]
const A4_PT_H: f64 = 842.0;

#[cfg(target_os = "macos")]
const CSS_PX_TO_PT: f64 = 72.0 / 96.0;

#[cfg(target_os = "macos")]
const PDF_PAGE_MARGIN_CSS_PX: f64 = 60.0;

#[cfg(target_os = "macos")]
const PDF_PAGE_MARGIN_PT: f64 =
    (A4_PT_W - (A4_CSS_W - 2.0 * PDF_PAGE_MARGIN_CSS_PX) * CSS_PX_TO_PT) / 2.0;

#[tauri::command]
pub(crate) async fn render_pdf(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    render_native(app, html, output_path).await
}

// ── macOS ──────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    render_pdf_native(app, html, output_path).await
}



#[cfg(target_os = "macos")]
async fn render_pdf_native(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    let html_path = write_html_to_temp(&html)?;
    let url = format!("file://{}", html_path.display());
    eprintln!(
        "[pdf] macOS render: html={} output={} html_len={}",
        html_path.display(),
        output_path,
        html.len()
    );

    let (page_tx, page_rx) = oneshot::channel::<()>();
    let (load_tx, load_rx) = mpsc::channel::<()>();
    let builder = WebviewWindowBuilder::new(
        &app,
        &next_pdf_window_label(),
        WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {e}"))?),
    )
    .title("Beaver Notes – PDF Render")
    .visible(false)
    .inner_size(A4_CSS_W, A4_CSS_H)
    .min_inner_size(A4_CSS_W, A4_CSS_H)
    .focused(false)
    .resizable(false)
    .decorations(false)
    .on_page_load(move |_window, payload| {
        if payload.event() == PageLoadEvent::Finished {
            let _ = load_tx.send(());
        }
    });

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create PDF render window: {e}"))?;

    tokio::spawn(async move {
        if load_rx.recv().is_ok() {
            let _ = page_tx.send(());
        }
    });

    if page_rx.await.is_err() {
        let _ = window.destroy();
        let _ = std::fs::remove_file(&html_path);
        return Err("PDF render window signaled an error while loading".to_string());
    }

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let (pdf_tx, pdf_rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let (raw_tx, raw_rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    tokio::spawn(async move {
        if let Ok(data) = raw_rx.recv() {
            let _ = pdf_tx.send(data);
        }
    });

    let output_path_clone = output_path.clone();
    window
        .with_webview(move |webview| {
            if let Err(e) = run_print_page_pdf(webview.inner(), &output_path_clone, raw_tx) {
                eprintln!("Failed to start PDF print: {e}");
            }
        })
        .map_err(|e| e.to_string())?;

    let pdf_bytes = pdf_rx.await.map_err(|e| e.to_string())??;

    let _ = window.destroy();
    let _ = std::fs::remove_file(&html_path);

    std::fs::write(&output_path, &pdf_bytes)
        .map_err(|e| format!("Failed to write output PDF: {e}"))?;
    eprintln!("[pdf] macOS: done → {} bytes written", pdf_bytes.len());
    Ok(())
}

#[cfg(target_os = "macos")]
fn write_html_to_temp(html: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("beaver-pdf-{}-{}.html", std::process::id(), nanos));
    std::fs::write(&path, html).map_err(|e| format!("Failed to write temp HTML: {e}"))?;
    Ok(path)
}

#[cfg(target_os = "macos")]
fn run_print_page_pdf(
    webview_ptr: *mut std::ffi::c_void,
    output_path: &str,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPaperOrientation,
    };
    use objc2_core_foundation::CGSize;
    use objc2_foundation::NSString;
    use objc2_web_kit::WKWebView;

    let _mtm =
        MainThreadMarker::new().ok_or_else(|| "Must be called from the main thread".to_string())?;
    let webview: Retained<WKWebView> = unsafe { Retained::retain(webview_ptr as *mut WKWebView) }
        .ok_or_else(|| "Invalid WKWebView pointer".to_string())?;

    let print_info = NSPrintInfo::new();
    print_info.setPaperSize(CGSize { width: A4_PT_W, height: A4_PT_H });
    print_info.setOrientation(NSPaperOrientation::Portrait);
    print_info.setTopMargin(PDF_PAGE_MARGIN_PT);
    print_info.setBottomMargin(PDF_PAGE_MARGIN_PT);
    print_info.setLeftMargin(PDF_PAGE_MARGIN_PT);
    print_info.setRightMargin(PDF_PAGE_MARGIN_PT);
    print_info.setHorizontallyCentered(false);
    print_info.setVerticallyCentered(false);
    unsafe {
        print_info.setJobDisposition(NSPrintSaveJob);
    }

    let save_url = objc2_foundation::NSURL::fileURLWithPath_isDirectory(
        &NSString::from_str(output_path),
        false,
    );
    unsafe {
        let dict = print_info.dictionary();
        dict.insert(NSPrintJobSavingURL, &*save_url);
    }

    let print_op = unsafe { webview.printOperationWithPrintInfo(&print_info) };
    print_op.setShowsPrintPanel(false);
    print_op.setShowsProgressPanel(false);

    let window = webview
        .window()
        .ok_or_else(|| "WKWebView has no window".to_string())?;
    unsafe {
        print_op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window, None, None, std::ptr::null_mut(),
        );
    }

    std::thread::sleep(std::time::Duration::from_millis(100));
    match std::fs::read(output_path) {
        Ok(bytes) => {
            let _ = tx.send(Ok(bytes));
        }
        Err(e) => {
            let _ = tx.send(Err(format!(
                "PDF not found at {output_path} after print operation: {e}"
            )));
        }
    }
    Ok(())
}

// ── iOS ────────────────────────────────────────────────────────────

#[cfg(target_os = "ios")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use tauri_plugin_pdf_render::{PdfRenderExt, RenderRequest, WriteScopedRequest};

    let html_path = write_export_html_to_temp(&html)?;

    let scoped_info = parse_scoped_path(&output_path);
    let render_output = if scoped_info.is_some() {
        scoped_temp_output_path()
    } else {
        output_path.clone()
    };

    let request = RenderRequest {
        html_path: html_path.to_string_lossy().into_owned(),
        output_path: render_output.clone(),
        timeout_ms: 30_000,
    };

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || app_clone.pdf_render().render(request))
        .await
        .map_err(|e| format!("PDF render task join error: {e}"))?
        .map_err(|e| format!("iOS PDF render failed: {e}"))?;

    let _ = std::fs::remove_file(&html_path);

    let pdf_bytes =
        std::fs::read(&render_output).map_err(|e| format!("Failed to read iOS PDF: {e}"))?;

    std::fs::write(&render_output, &pdf_bytes)
        .map_err(|e| format!("Failed to write PDF: {e}"))?;

    if scoped_info.is_some() {
        let app_clone = app.clone();
        let temp_path = render_output.clone();
        let orig_output = output_path.clone();
        tokio::task::spawn_blocking(move || {
            app_clone.pdf_render().write_to_scoped(WriteScopedRequest {
                source_path: temp_path,
                scoped_output_path: orig_output,
            })
        })
        .await
        .map_err(|e| format!("PDF scoped write join error: {e}"))?
        .map_err(|e| format!("Failed to copy PDF to scoped storage: {e}"))?;
        let _ = std::fs::remove_file(&render_output);
    }

    Ok(())
}

// ── Android ────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use tauri_plugin_pdf_render::{PdfRenderExt, RenderRequest, WriteScopedRequest};

    let html_path = write_export_html_to_temp(&html)?;

    let scoped_info = parse_scoped_path(&output_path);
    let render_output = if scoped_info.is_some() {
        scoped_temp_output_path()
    } else {
        output_path.clone()
    };

    let request = RenderRequest {
        html_path: html_path.to_string_lossy().into_owned(),
        output_path: render_output.clone(),
        timeout_ms: 30_000,
    };

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || app_clone.pdf_render().render(request))
        .await
        .map_err(|e| format!("PDF render task join error: {e}"))?
        .map_err(|e| format!("Android PDF render failed: {e}"))?;

    let _ = std::fs::remove_file(&html_path);

    let pdf_bytes =
        std::fs::read(&render_output).map_err(|e| format!("Failed to read Android PDF: {e}"))?;

    std::fs::write(&render_output, &pdf_bytes)
        .map_err(|e| format!("Failed to write PDF: {e}"))?;

    if scoped_info.is_some() {
        let app_clone = app.clone();
        let temp_path = render_output.clone();
        let orig_output = output_path.clone();
        tokio::task::spawn_blocking(move || {
            app_clone.pdf_render().write_to_scoped(WriteScopedRequest {
                source_path: temp_path,
                scoped_output_path: orig_output,
            })
        })
        .await
        .map_err(|e| format!("PDF scoped write join error: {e}"))?
        .map_err(|e| format!("Failed to copy PDF to scoped storage: {e}"))?;
        let _ = std::fs::remove_file(&render_output);
    }

    Ok(())
}

// ── Windows ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
const A4_CSS_W: i32 = 794;

#[cfg(target_os = "windows")]
const A4_CSS_H: i32 = 1123;

#[cfg(target_os = "windows")]
async fn render_native(_app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use std::sync::mpsc as smpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2Controller,
        ICoreWebView2Environment, ICoreWebView2_7,
    };
    use webview2_com::{
        CreateCoreWebView2ControllerCompletedHandler,
        CreateCoreWebView2EnvironmentCompletedHandler, ExecuteScriptCompletedHandler,
        NavigationCompletedEventHandler, PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, PeekMessageW, RegisterClassExW, DispatchMessageW,
        HWND_MESSAGE, MSG, PM_REMOVE, WNDCLASSEXW, WNDCLASS_STYLES, WINDOW_EX_STYLE,
        WS_OVERLAPPEDWINDOW,
    };

    fn pump_messages() {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = DispatchMessageW(&msg);
            }
        }
    }

    fn recv_with_pump<T>(rx: &smpsc::Receiver<T>) -> Result<T, String> {
        loop {
            match rx.try_recv() {
                Ok(val) => return Ok(val),
                Err(smpsc::TryRecvError::Empty) => {
                    pump_messages();
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(smpsc::TryRecvError::Disconnected) => {
                    return Err("channel disconnected".into());
                }
            }
        }
    }

    let html_path = write_export_html_to_temp(&html)?;
    let url_string = format!(
        "file:///{}",
        html_path.display().to_string().replace('\\', "/")
    );

    eprintln!("[pdf] Windows render: html at {} output={}", html_path.display(), output_path);

    let (result_tx, result_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

    std::thread::spawn(move || {
        let run = || -> Result<Vec<u8>, String> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .ok()
                    .map_err(|e| format!("CoInitializeEx: {e}"))?;
            }

            let class_name = HSTRING::from("BeaverNotesPdfRenderClass");
            unsafe extern "system" fn wndproc(
                hwnd: HWND,
                msg: u32,
                wparam: windows::Win32::Foundation::WPARAM,
                lparam: windows::Win32::Foundation::LPARAM,
            ) -> windows::Win32::Foundation::LRESULT {
                use windows::Win32::UI::WindowsAndMessaging::DefWindowProcW;
                unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
            }
            let instance = unsafe {
                let hmod = windows::Win32::System::LibraryLoader::GetModuleHandleW(None)
                    .map_err(|e| format!("GetModuleHandleW: {e}"))?;
                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    style: WNDCLASS_STYLES(0),
                    lpfnWndProc: Some(wndproc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: hmod.into(),
                    hIcon: Default::default(),
                    hCursor: Default::default(),
                    hbrBackground: Default::default(),
                    lpszMenuName: PCWSTR::null(),
                    lpszClassName: PCWSTR(class_name.as_ptr()),
                    hIconSm: Default::default(),
                };
                let _ = RegisterClassExW(&wc);
                hmod
            };
            let hwnd = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    &class_name,
                    PCWSTR::null(),
                    WS_OVERLAPPEDWINDOW,
                    0,
                    0,
                    A4_CSS_W,
                    A4_CSS_H,
                    Some(HWND_MESSAGE),
                    None,
                    Some(instance.into()),
                    None,
                )
            }
            .map_err(|e| format!("CreateWindowExW: {e}"))?;

            eprintln!("[pdf] Window created, creating WebView2 env");

            let (env_tx, env_rx) = smpsc::channel::<Result<ICoreWebView2Environment, String>>();
            let (ctrl_tx, ctrl_rx) = smpsc::channel::<Result<ICoreWebView2Controller, String>>();
            let (nav_tx, nav_rx) = smpsc::channel::<Result<(), String>>();
            let (pdf_tx, pdf_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

            let env_handler =
                CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |_result, env| {
                    let _ = env_tx.send(match env {
                        Some(e) => Ok(e),
                        None => Err("WebView2 env creation returned null".into()),
                    });
                    Ok(())
                }));
            unsafe {
                CreateCoreWebView2EnvironmentWithOptions(
                    PCWSTR::null(),
                    PCWSTR::null(),
                    None,
                    &env_handler,
                )
                .map_err(|e| format!("CreateCoreWebView2EnvironmentWithOptions: {e}"))?;
            }
            let env = recv_with_pump(&env_rx).map_err(|e| format!("env: {e}"))??;
            eprintln!("[pdf] WebView2 env created");

            let ctrl_handler =
                CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |_result, controller| {
                    let _ = ctrl_tx.send(match controller {
                        Some(c) => Ok(c),
                        None => Err("WebView2 controller creation returned null".into()),
                    });
                    Ok(())
                }));
            unsafe {
                env.CreateCoreWebView2Controller(hwnd, &ctrl_handler)
                    .map_err(|e| format!("CreateCoreWebView2Controller: {e}"))?;
            }
            let controller: ICoreWebView2Controller =
                recv_with_pump(&ctrl_rx).map_err(|e| format!("ctrl: {e}"))??;
            eprintln!("[pdf] WebView2 controller created");

            let webview: ICoreWebView2 = unsafe {
                controller
                    .CoreWebView2()
                    .map_err(|e| format!("CoreWebView2: {e}"))?
            };
            unsafe {
                controller
                    .SetBounds(RECT {
                        left: 0,
                        top: 0,
                        right: A4_CSS_W,
                        bottom: A4_CSS_H,
                    })
                    .map_err(|e| format!("SetBounds: {e}"))?;
                controller
                    .SetIsVisible(false)
                    .map_err(|e| format!("SetIsVisible: {e}"))?;
            }

            let mut nav_token: i64 = 0;
            {
                let nav_tx = nav_tx.clone();
                let handler = NavigationCompletedEventHandler::create(Box::new(move |_w, _args| {
                    let _ = nav_tx.send(Ok(()));
                    Ok(())
                }));
                unsafe {
                    webview
                        .add_NavigationCompleted(&handler, &mut nav_token)
                        .map_err(|e| format!("add_NavigationCompleted: {e}"))?;
                }
            }
            unsafe {
                webview
                    .Navigate(&HSTRING::from(&url_string))
                    .map_err(|e| format!("Navigate: {e}"))?;
            }
            eprintln!("[pdf] Navigated, waiting for page load");
            recv_with_pump(&nav_rx).map_err(|e| format!("nav: {e}"))??;
            eprintln!("[pdf] Page loaded");

            std::thread::sleep(std::time::Duration::from_millis(150));
            let noop_handler = ExecuteScriptCompletedHandler::create(Box::new(move |_result, _val| {
                let _ = _val;
                Ok(())
            }));
            unsafe {
                let script = HSTRING::from("JSON.stringify((window.__bnLayout || []))");
                let _ = webview.ExecuteScript(
                    &script,
                    &noop_handler,
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(50));

            let pdf_path = std::env::temp_dir().join(format!(
                "beaver-pdf-stage-{}-{}.pdf",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let pdf_path_hstring = HSTRING::from(pdf_path.to_string_lossy().as_ref());
            let pdf_path_clone = pdf_path.clone();
            let pdf_handler = PrintToPdfCompletedHandler::create(Box::new(move |_result, _success| {
                let _ = pdf_tx.send(match std::fs::read(&pdf_path_clone) {
                    Ok(b) => Ok(b),
                    Err(e) => Err(format!("Read staged PDF: {e}")),
                });
                Ok(())
            }));
            unsafe {
                let webview_7: ICoreWebView2_7 =
                    webview.cast().map_err(|e| format!("Cast ICoreWebView2_7: {e}"))?;
                webview_7
                    .PrintToPdf(
                        PCWSTR(pdf_path_hstring.as_ptr()),
                        None,
                        &pdf_handler,
                    )
                    .map_err(|e| format!("PrintToPdf: {e}"))?;
            }
            eprintln!("[pdf] PrintToPdf called, waiting for result");
            let pdf_bytes = recv_with_pump(&pdf_rx).map_err(|e| format!("pdf: {e}"))??;
            eprintln!("[pdf] Got PDF ({} bytes)", pdf_bytes.len());

            let _ = std::fs::remove_file(&pdf_path);
            unsafe {
                let _ = webview.remove_NavigationCompleted(nav_token);
                let _ = DestroyWindow(hwnd);
            }

            Ok(pdf_bytes)
        };

        let result = run();
        let _ = result_tx.send(result);
    });

    let pdf_bytes = result_rx
        .recv()
        .map_err(|e| format!("Windows render channel closed: {e}"))??;

    let _ = std::fs::remove_file(&html_path);
    eprintln!("[pdf] Writing PDF to {}", output_path);
    std::fs::write(&output_path, &pdf_bytes)
        .map_err(|e| format!("Failed to write PDF: {e}"))
}

// ── Linux ──────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    // Force only the file print backend so GTK doesn't require CUPS
    // to have a printer configured. Set before any GTK init.
    std::env::set_var("GTK_PRINT_BACKENDS", "file");

    use std::sync::mpsc as smpsc;
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let html_path = write_export_html_to_temp(&html)?;
    let url = format!("file://{}", html_path.display());

    let (loaded_tx, loaded_rx) = smpsc::channel::<()>();

    let label = format!("pdf-render-{}", std::process::id());

    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {e}"))?),
    )
    .title("Beaver Notes – PDF Render")
    .visible(false)
    .inner_size(794.0, 1123.0)
    .min_inner_size(794.0, 1123.0)
    .resizable(false)
    .decorations(false)
    .on_page_load(move |_window, payload| {
        if payload.event() == PageLoadEvent::Finished {
            let _ = loaded_tx.send(());
        }
    });

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create PDF render window: {e}"))?;

    loaded_rx
        .recv()
        .map_err(|_| "PDF render window load channel closed".to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(150));

    let pdf_stage = std::env::temp_dir().join(format!(
        "beaver-pdf-stage-{}-{}.pdf",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let pdf_uri = format!("file://{}", pdf_stage.display());

    let (result_tx, result_rx) = smpsc::channel::<Result<Vec<u8>, String>>();
    let pdf_stage_print = pdf_stage.clone();
    let output_path_clone = output_path.clone();

    window
        .with_webview(move |webview| {
            use webkit2gtk::PrintOperation;
            use webkit2gtk::PrintOperationExt;

            let wk = webview.inner();
            let print_op = PrintOperation::new(&wk);
            let settings = gtk::PrintSettings::new();
            settings.set_bool("print-to-file", true);
            settings.set("output-file-format", Some("pdf"));
            settings.set("output-uri", Some(&pdf_uri));
            settings.set_printer("Print to File");
            print_op.set_print_settings(&settings);

            let page_setup = gtk::PageSetup::new();
            let paper_size = gtk::PaperSize::new(Some("iso_a4"));
            page_setup.set_paper_size(&paper_size);
            page_setup.set_orientation(gtk::PageOrientation::Portrait);
            print_op.set_page_setup(&page_setup);

            let tx_ok = result_tx.clone();
            let tx_err = result_tx;
            let stage = pdf_stage_print;
            print_op.connect_finished(move |_op| {
                std::thread::sleep(std::time::Duration::from_millis(200));
                let outcome =
                    std::fs::read(&stage).map_err(|e| format!("read staged PDF: {e}"));
                let _ = tx_ok.send(outcome);
            });
            print_op.connect_failed(move |_op, err| {
                let _ = tx_err.send(Err(format!("print failed: {err}")));
            });
            print_op.print();
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    let pdf_bytes = result_rx
        .recv()
        .map_err(|e| format!("Linux render channel closed: {e}"))??;

    let _ = window.destroy();
    let _ = std::fs::remove_file(&pdf_stage);
    let _ = std::fs::remove_file(&html_path);

    std::fs::write(&output_path_clone, &pdf_bytes)
        .map_err(|e| format!("Failed to write PDF: {e}"))
}

// ── Shared helpers ─────────────────────────────────────────────────

#[cfg(any(
    target_os = "ios",
    target_os = "windows",
    target_os = "linux",
    target_os = "android"
))]
fn write_export_html_to_temp(html: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("beaver-pdf-{}-{}.html", std::process::id(), nanos));
    std::fs::write(&path, html).map_err(|e| format!("Failed to write temp HTML: {e}"))?;
    Ok(path)
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn parse_scoped_path(path: &str) -> Option<(String, String)> {
    let remainder = path.strip_prefix("scoped:")?;
    let (folder_id, relative) = remainder.split_once('/')?;
    if folder_id.is_empty() || relative.is_empty() {
        return None;
    }
    Some((folder_id.to_string(), relative.to_string()))
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn scoped_temp_output_path() -> String {
    let mut temp = std::env::temp_dir();
    temp.push(format!("beaver-pdf-scoped-{}.pdf", std::process::id()));
    temp.to_string_lossy().into_owned()
}

// ── Fallback ───────────────────────────────────────────────────────

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux",
    target_os = "android"
)))]
async fn render_native(_app: AppHandle, _html: String, _output_path: String) -> Result<(), String> {
    Err("Native PDF rendering is not implemented for this platform".to_string())
}
