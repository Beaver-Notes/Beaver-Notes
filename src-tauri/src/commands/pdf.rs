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
async fn render_native(_app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use std::sync::mpsc as smpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        CreateCoreWebView2EnvironmentCompletedHandler, CreateCoreWebView2EnvironmentWithOptions,
        ExecuteScriptCompletedHandler, ICoreWebView2, ICoreWebView2Controller,
        ICoreWebView2Environment, NavigationCompletedEventHandler, PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, RegisterClassExW, HWND_MESSAGE, WNDCLASSEXW,
        WS_EX_LAYERED, WS_OVERLAPPEDWINDOW,
    };

    let html_path = write_export_html_to_temp(&html)?;
    let url_string = format!(
        "file:///{}",
        html_path.display().to_string_lossy().replace('\\', "/")
    );

    let (result_tx, result_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

    std::thread::spawn(move || {
        let run = || -> Result<Vec<u8>, String> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
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
            unsafe {
                let instance = windows::Win32::System::LibraryLoader::GetModuleHandleW(None)
                    .map_err(|e| format!("GetModuleHandleW: {e}"))?;
                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    style: 0,
                    lpfnWndProc: Some(wndproc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: instance,
                    hIcon: Default::default(),
                    hCursor: Default::default(),
                    hbrBackground: Default::default(),
                    lpszMenuName: PCWSTR::null(),
                    lpszClassName: PCWSTR(class_name.as_wide().as_ptr()),
                    hIconSm: Default::default(),
                };
                let _ = RegisterClassExW(&wc);
            }
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_LAYERED,
                    PCWSTR(class_name.as_wide().as_ptr()),
                    PCWSTR::null(),
                    WS_OVERLAPPEDWINDOW,
                    0,
                    0,
                    A4_CSS_W as i32,
                    A4_CSS_H as i32,
                    HWND_MESSAGE,
                    None,
                    None,
                    None,
                )
            }
            .map_err(|e| format!("CreateWindowExW: {e}"))?;

            let (env_tx, env_rx) = smpsc::channel::<Result<ICoreWebView2Environment, String>>();
            let (ctrl_tx, ctrl_rx) = smpsc::channel::<Result<ICoreWebView2Controller, String>>();
            let (nav_tx, nav_rx) = smpsc::channel::<Result<(), String>>();
            let (pdf_tx, pdf_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

            let hwnd_for_env = hwnd;
            let env_handler =
                CreateCoreWebView2EnvironmentCompletedHandler::create(move |_result, env| {
                    let _ = env_tx.send(match env {
                        Some(e) => Ok(e),
                        None => Err("WebView2 env creation returned null".into()),
                    });
                    Ok(())
                });
            unsafe {
                CreateCoreWebView2EnvironmentWithOptions(
                    PCWSTR::null(),
                    PCWSTR::null(),
                    None,
                    &env_handler,
                )
                .map_err(|e| format!("CreateCoreWebView2EnvironmentWithOptions: {e}"))?;
            }
            let env = env_rx.recv().map_err(|e| format!("env channel: {e}"))??;

            let ctrl_handler =
                webview2_com::Microsoft::Web::WebView2::Win32::CreateCoreWebView2ControllerCompletedHandler::create(
                    move |_result, controller| {
                        let _ = ctrl_tx.send(match controller {
                            Some(c) => Ok(c),
                            None => Err("WebView2 controller creation returned null".into()),
                        });
                        Ok(())
                    },
                );
            unsafe {
                env.CreateCoreWebView2ControllerWithOptions(hwnd_for_env, None, &ctrl_handler)
                    .map_err(|e| format!("CreateCoreWebView2Controller: {e}"))?;
            }
            let controller: ICoreWebView2Controller =
                ctrl_rx.recv().map_err(|e| format!("ctrl channel: {e}"))??;

            let webview: ICoreWebView2 = unsafe {
                controller
                    .CoreWebView2()
                    .map_err(|e| format!("CoreWebView2: {e}"))?
            };
            unsafe {
                controller
                    .put_Bounds(RECT {
                        left: 0,
                        top: 0,
                        right: A4_CSS_W as i32,
                        bottom: A4_CSS_H as i32,
                    })
                    .map_err(|e| format!("put_Bounds: {e}"))?;
                controller
                    .put_IsVisible(false)
                    .map_err(|e| format!("put_IsVisible: {e}"))?;
            }

            let nav_token = {
                let nav_tx = nav_tx.clone();
                let handler = NavigationCompletedEventHandler::create(move |_w, _args| {
                    let _ = nav_tx.send(Ok(()));
                    Ok(())
                });
                unsafe {
                    webview
                        .add_NavigationCompleted(&handler)
                        .map_err(|e| format!("add_NavigationCompleted: {e}"))?
                }
            };
            unsafe {
                webview
                    .Navigate(PCWSTR(HSTRING::from(&url_string).as_wide().as_ptr()))
                    .map_err(|e| format!("Navigate: {e}"))?;
            }
            nav_rx.recv().map_err(|e| format!("nav channel: {e}"))??;

            std::thread::sleep(std::time::Duration::from_millis(150));
            let noop_handler = ExecuteScriptCompletedHandler::create(move |_result, _val| {
                let _ = _val;
                Ok(())
            });
            unsafe {
                let _ = webview.ExecuteScript(
                    PCWSTR(HSTRING::from("JSON.stringify((window.__bnLayout || []))").as_wide().as_ptr()),
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
            let pdf_handler = PrintToPdfCompletedHandler::create(move |_result| {
                let _ = pdf_tx.send(match std::fs::read(&pdf_path) {
                    Ok(b) => Ok(b),
                    Err(e) => Err(format!("Read staged PDF: {e}")),
                });
                Ok(())
            });
            unsafe {
                webview
                    .PrintToPdf(
                        PCWSTR(pdf_path_hstring.as_wide().as_ptr()),
                        None,
                        &pdf_handler,
                    )
                    .map_err(|e| format!("PrintToPdf: {e}"))?;
            }
            let pdf_bytes = pdf_rx.recv().map_err(|e| format!("pdf channel: {e}"))??;

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
    std::fs::write(&output_path, &pdf_bytes)
        .map_err(|e| format!("Failed to write PDF: {e}"))
}

// ── Linux ──────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
async fn render_native(_app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use std::sync::mpsc as smpsc;

    let html_path = write_export_html_to_temp(&html)?;

    let (result_tx, result_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

    std::thread::spawn(move || {
        let run = || -> Result<Vec<u8>, String> {
            use gio::Cancellable;
            use glib::MainLoop;
            use gtk::glib;
            use gtk::prelude::*;
            use std::cell::RefCell;
            use std::rc::Rc;
            use webkit2gtk::prelude::*;
            use webkit2gtk::WebViewExt as _;
            use webkit2gtk::{
                PrintOperation, PrintOperationResult, WebView, WebViewExt, WebViewExtManual,
            };

            gtk::init().map_err(|e| format!("gtk::init: {e}"))?;

            let window = gtk::Window::new(gtk::WindowType::Toplevel);
            window.set_default_size(A4_CSS_W as i32, A4_CSS_H as i32);

            let webview = WebView::new();
            window.add(&webview);
            webview.set_size_request(A4_CSS_W as i32, A4_CSS_H as i32);

            let load_result: Rc<RefCell<Option<Result<(), String>>>> = Rc::new(RefCell::new(None));
            let pdf_result: Rc<RefCell<Option<Result<Vec<u8>, String>>>> =
                Rc::new(RefCell::new(None));

            let loop_load = MainLoop::new(None, false);
            let loop_pdf = MainLoop::new(None, false);

            let file_uri = format!("file://{}", html_path.display());
            webview.load_uri(&file_uri);

            let load_result_clone = load_result.clone();
            let loop_load_clone = loop_load.clone();
            webview.connect_load_changed(move |_w, event| {
                use webkit2gtk::LoadEvent;
                if event == LoadEvent::Finished {
                    *load_result_clone.borrow_mut() = Some(Ok(()));
                    loop_load_clone.quit();
                }
            });
            loop_load.run();
            load_result
                .borrow_mut()
                .take()
                .ok_or_else(|| "load event never fired".to_string())??;

            glib::timeout_future(150).wait();

            let pdf_stage = std::env::temp_dir().join(format!(
                "beaver-pdf-stage-{}-{}.pdf",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let pdf_uri = format!("file://{}", pdf_stage.display());

            let print_op = PrintOperation::new(&webview);
            let settings = print_op.print_settings();
            settings.set_print_to_file(true);
            settings.set_output_format(webkit2gtk::PrintOutputFormat::Pdf);
            settings.set_output_uri(&pdf_uri);

            let pdf_result_clone = pdf_result.clone();
            let loop_pdf_clone = loop_pdf.clone();
            print_op.connect_finished(move |_op, result| {
                let outcome = if result == PrintOperationResult::Finished {
                    std::fs::read(&pdf_stage).map_err(|e| format!("read staged PDF: {e}"))
                } else {
                    Err(format!("PrintOperation did not finish: {result:?}"))
                };
                *pdf_result_clone.borrow_mut() = Some(outcome);
                loop_pdf_clone.quit();
            });
            print_op.run();
            loop_pdf.run();
            let pdf_bytes = pdf_result
                .borrow_mut()
                .take()
                .ok_or_else(|| "print operation never completed".to_string())??;
            let _ = std::fs::remove_file(&pdf_stage);

            window.destroy();

            Ok(pdf_bytes)
        };

        let result = run();
        let _ = result_tx.send(result);
    });

    let pdf_bytes = result_rx
        .recv()
        .map_err(|e| format!("Linux render channel closed: {e}"))??;

    let _ = std::fs::remove_file(&html_path);
    std::fs::write(&output_path, &pdf_bytes)
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
