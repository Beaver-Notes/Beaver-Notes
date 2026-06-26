//! PDF export for Beaver Notes.
//!
//! The export pipeline has two distinct stages:
//!
//! 1. **Render HTML to PDF bytes** (platform-specific).
//!    macOS uses `WKWebView.createPDF`; iOS does the same on its WebView.
//!    Windows/Linux/Android will plug in their own native renderer. The
//!    renderer must return a single PDF document containing the full
//!    note, in any page size.
//!
//! 2. **Split a single-page PDF into A4 pages** (platform-agnostic).
//!    `split_into_a4_pages` rewrites the PDF's page tree so the content
//!    is sliced horizontally into 595×842pt pages. This is implemented
//!    with `lopdf` and is the only piece of reusable logic in the file
//!    — every platform uses the same routine.
//!
//! Keeping the two stages separate means a future iOS / Windows / Linux
//! renderer only has to produce a single PDF; the slicing step is shared.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

/// A4 in CSS pixels at 96 DPI: 210mm × 297mm.
const A4_CSS_W: f64 = 794.0;
const A4_CSS_H: f64 = 1123.0;

/// A4 in PostScript points: 210mm / 25.4 * 72 = 595.28pt;
/// 297mm / 25.4 * 72 = 841.89pt.
const A4_PT_W: f64 = 595.0;
const A4_PT_H: f64 = 842.0;

/// CSS-px to PostScript points: 1 CSS-px = 72/96 pt.
const CSS_PX_TO_PT: f64 = 72.0 / 96.0;

/// Page margin applied to each A4 page in points.
const PDF_PAGE_MARGIN_PT: f64 = 44.75;

use std::sync::atomic::{AtomicU64, Ordering};
static PDF_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_pdf_window_label() -> String {
    let n = PDF_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("pdf-render-{n}")
}

/// Render an export-ready HTML document to an A4-paginated PDF on disk.
///
/// On macOS this loads the HTML into a hidden `WKWebView`, calls
/// `createPDF` to get a single-page PDF, then hands the bytes off to
/// `split_into_a4_pages`. On other platforms the command currently
/// returns an error — plug in a native renderer there when needed.
#[tauri::command]
pub(crate) async fn render_pdf(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    render_native(app, html, output_path).await
}

/// Per-platform entry point. Each platform provides a `render_native`
/// implementation that loads the export HTML into a native webview,
/// measures the keep-together blocks, captures a full-document PDF,
/// and hands the bytes to `split_into_a4_pages`. The implementations
/// are isolated behind `#[cfg]` so the existing macOS code path
/// (`render_pdf_native` above) is reused verbatim on macOS.
#[cfg(target_os = "macos")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    render_pdf_native(app, html, output_path).await
}

// ── macOS-specific render: hidden WKWebView → PDF bytes ────────────

#[cfg(target_os = "macos")]
async fn render_pdf_native(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    // 1) Write the export HTML to a temp file. We avoid `WebviewUrl::App`
    //    because the render window must not run the main app's HTML.
    let html_path = write_html_to_temp(&html)?;
    let url = format!("file://{}", html_path.display());
    eprintln!(
        "[pdf] macOS render: html={} output={} html_len={}",
        html_path.display(),
        output_path,
        html.len()
    );

    // 2) Output directory: the save dialog already returns a path
    //    the user (and the OS) consider writable.

    // 3) Create a hidden webview window sized to A4 in CSS pixels.
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

    // Bridge the sync page-load signal into the async world.
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

    // 4) Wait for the page to fully lay out.  We read the DOM
    //    scrollHeight directly and wait until two consecutive
    //    readings agree.
    let mut doc_h = 0.0_f64;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let h = read_doc_height(&window).await.unwrap_or(0.0);
        if h > 10.0 && (h - doc_h).abs() < 2.0 {
            doc_h = h;
            break;
        }
        doc_h = h;
    }
    if doc_h <= 0.0 {
        doc_h = A4_CSS_H;
    }
    eprintln!("[pdf] macOS: doc_h={:.0}px", doc_h);

    // 5) Read content-aware page cuts from JS, then capture each
    //    page as a variable-height rect and pad to A4 via lopdf.
    let cuts = read_page_cuts(&window).await.unwrap_or_default();
    eprintln!(
        "[pdf] macOS: __bnPageCuts has {} entries → {:?}",
        cuts.len(),
        cuts.iter().map(|c| format!("{:.0}", c)).collect::<Vec<_>>()
    );

    let mut page_pdfs: Vec<Vec<u8>> = Vec::new();

    if cuts.is_empty() {
        // Content fits on a single page — capture the full height.
        eprintln!("[pdf] macOS: single page (no cuts), capturing full height {:.0}px", doc_h);
        match capture_page_rect(&window, 0.0, 0.0, A4_CSS_W, doc_h).await {
            Ok(bytes) => {
                match pad_page_to_a4(&bytes) {
                    Ok(padded) => page_pdfs.push(padded),
                    Err(e) => {
                        let _ = window.destroy();
                        let _ = std::fs::remove_file(&html_path);
                        return Err(format!("pad_page_to_a4 failed: {e}"));
                    }
                }
            }
            Err(e) => {
                let _ = window.destroy();
                let _ = std::fs::remove_file(&html_path);
                return Err(format!("Page capture failed: {e}"));
            }
        }
    } else {
        // Multi-page: each cut is the Y where a page ENDS.
        // Page 1: y=0..cuts[0], Page 2: cuts[0]..cuts[1], etc.
        let mut prev = 0.0_f64;
        for (idx, &cut) in cuts.iter().enumerate() {
            let height = (cut - prev).max(1.0);
            eprintln!(
                "[pdf] macOS: page {} capturing y={:.0} h={:.0}",
                idx + 1,
                prev,
                height
            );
            match capture_page_rect(&window, 0.0, prev, A4_CSS_W, height).await {
                Ok(bytes) => {
                    match pad_page_to_a4(&bytes) {
                        Ok(padded) => page_pdfs.push(padded),
                        Err(e) => {
                            let _ = window.destroy();
                            let _ = std::fs::remove_file(&html_path);
                            return Err(format!("pad_page_to_a4 failed on page {}: {e}", idx + 1));
                        }
                    }
                }
                Err(e) => {
                    let _ = window.destroy();
                    let _ = std::fs::remove_file(&html_path);
                    return Err(format!("Page {} capture failed: {e}", idx + 1));
                }
            }
            prev = cut;
        }
    }

    // 6) Tear the hidden window down regardless of capture outcome.
    let _ = window.destroy();
    let _ = std::fs::remove_file(&html_path);

    // 7) Concatenate all single-page PDFs and write to disk.
    eprintln!(
        "[pdf] macOS: got {} pages, concatenating…",
        page_pdfs.len()
    );
    concatenate_pdfs(&page_pdfs, &output_path)
        .inspect_err(|e| eprintln!("[pdf] macOS: CONCAT FAILED → {e}"))
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

/// Poll `window.__bnDocHeight` so we know the page has actually laid
/// out before we try to capture a PDF.
#[cfg(target_os = "macos")]
async fn read_doc_height(window: &tauri::WebviewWindow) -> Result<f64, String> {
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let (raw_tx, raw_rx) = mpsc::channel::<Result<String, String>>();
    tokio::spawn(async move {
        if let Ok(data) = raw_rx.recv() {
            let _ = tx.send(data);
        }
    });

    window
        .with_webview(move |webview| {
            if let Err(e) = run_evaluate_doc_height(webview.inner(), raw_tx) {
                eprintln!("Failed to evaluate doc-height script: {e}");
            }
        })
        .map_err(|e| e.to_string())?;

    let raw = rx.await.map_err(|e| e.to_string())??;
    let h: f64 = raw.trim().parse().unwrap_or(0.0);
    Ok(h)
}

#[cfg(target_os = "macos")]
fn run_evaluate_doc_height(
    webview_ptr: *mut std::ffi::c_void,
    tx: std::sync::mpsc::Sender<Result<String, String>>,
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::WKWebView;

    let webview: Retained<WKWebView> = unsafe { Retained::retain(webview_ptr as *mut WKWebView) }
        .ok_or_else(|| "Invalid WKWebView pointer".to_string())?;

    let script = "String(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))";
    let ns_script = NSString::from_str(script);

    let completion = block2::RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
        if !error.is_null() {
            let e: &NSError = unsafe { &*error };
            let _ = tx.send(Err(format!("{}", e.localizedDescription())));
            return;
        }
        if result.is_null() {
            let _ = tx.send(Ok(String::new()));
            return;
        }
        let s: &NSString = unsafe { &*(result as *const NSString) };
        let _ = tx.send(Ok(s.to_string()));
    });

    unsafe {
        webview.evaluateJavaScript_completionHandler(&ns_script, Some(&completion));
    }
    Ok(())
}

/// Read `window.__bnPageCuts` from the WKWebView.  Returns the Y-positions
/// (in CSS-px) where each page ENDS.  An empty vec means the content fits
/// on a single page.
#[cfg(target_os = "macos")]
async fn read_page_cuts(window: &tauri::WebviewWindow) -> Result<Vec<f64>, String> {
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let (raw_tx, raw_rx) = mpsc::channel::<Result<String, String>>();
    tokio::spawn(async move {
        if let Ok(data) = raw_rx.recv() {
            let _ = tx.send(data);
        }
    });

    window
        .with_webview(move |webview| {
            if let Err(e) = run_evaluate_page_cuts(webview.inner(), raw_tx) {
                eprintln!("Failed to evaluate page-cuts script: {e}");
            }
        })
        .map_err(|e| e.to_string())?;

    let raw = rx.await.map_err(|e| e.to_string())??;
    let cuts: Vec<f64> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(cuts)
}

#[cfg(target_os = "macos")]
fn run_evaluate_page_cuts(
    webview_ptr: *mut std::ffi::c_void,
    tx: std::sync::mpsc::Sender<Result<String, String>>,
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::WKWebView;

    let webview: Retained<WKWebView> = unsafe { Retained::retain(webview_ptr as *mut WKWebView) }
        .ok_or_else(|| "Invalid WKWebView pointer".to_string())?;

    let script = "JSON.stringify((window.__bnPageCuts || []))";
    let ns_script = NSString::from_str(script);

    let completion = block2::RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
        if !error.is_null() {
            let e: &NSError = unsafe { &*error };
            let _ = tx.send(Err(format!("{}", e.localizedDescription())));
            return;
        }
        if result.is_null() {
            let _ = tx.send(Ok("[]".to_string()));
            return;
        }
        let s: &NSString = unsafe { &*(result as *const NSString) };
        let _ = tx.send(Ok(s.to_string()));
    });

    unsafe {
        webview.evaluateJavaScript_completionHandler(&ns_script, Some(&completion));
    }
    Ok(())
}

/// Capture a single A4-sized rect of the WebView and return the PDF bytes.
/// The rect is in CSS-px (the native coordinate space of WKWebView).
#[cfg(target_os = "macos")]
async fn capture_page_rect(
    window: &tauri::WebviewWindow,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<Vec<u8>, String> {
    let (tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let (raw_tx, raw_rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    tokio::spawn(async move {
        if let Ok(data) = raw_rx.recv() {
            let _ = tx.send(data);
        }
    });

    window
        .with_webview(move |webview| {
            if let Err(e) = run_capture_pdf_rect(webview.inner(), raw_tx, x, y, w, h) {
                eprintln!("Failed to start PDF rect capture: {e}");
            }
        })
        .map_err(|e| e.to_string())?;

    rx.await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn run_capture_pdf_rect(
    webview_ptr: *mut std::ffi::c_void,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView};

    let mtm =
        MainThreadMarker::new().ok_or_else(|| "Must be called from the main thread".to_string())?;
    let webview: Retained<WKWebView> = unsafe { Retained::retain(webview_ptr as *mut WKWebView) }
        .ok_or_else(|| "Invalid WKWebView pointer".to_string())?;
    let config = unsafe { WKPDFConfiguration::new(mtm) };

    let rect = CGRect::new(CGPoint::new(x, y), CGSize::new(w, h));
    unsafe { config.setRect(rect) };

    let completion = block2::RcBlock::new(move |pdf_data: *mut NSData, error: *mut NSError| {
        if !error.is_null() {
            let e: &NSError = unsafe { &*error };
            let _ = tx.send(Err(format!("{}", e.localizedDescription())));
            return;
        }
        if pdf_data.is_null() {
            let _ = tx.send(Err("PDF generation returned no data".to_string()));
            return;
        }
        let data: &NSData = unsafe { &*pdf_data };
        let len = data.length() as usize;
        if len == 0 {
            let _ = tx.send(Err("Generated PDF data is empty".to_string()));
            return;
        }
        let mut bytes = vec![0u8; len];
        unsafe {
            use std::ptr::NonNull;
            data.getBytes_length(
                NonNull::new(bytes.as_mut_ptr() as *mut std::ffi::c_void).expect("non-null"),
                len as objc2_foundation::NSUInteger,
            );
        }
        let _ = tx.send(Ok(bytes));
    });

    unsafe {
        webview.createPDFWithConfiguration_completionHandler(Some(&config), &completion);
    }
    Ok(())
}

// ── Pad a captured page to A4 via lopdf ─────────────────────────────
//
// Each captured page may have a non-A4 height (variable-width rects).
// This function wraps the page content in a form XObject and stamps
// it centered vertically onto a fresh A4 page (595×842 PT).

fn pad_page_to_a4(page_bytes: &[u8]) -> Result<Vec<u8>, String> {
    use lopdf::{Dictionary, Document, Object, Stream};

    let mut doc =
        Document::load_mem(page_bytes).map_err(|e| format!("pad_page_to_a4: failed to load PDF: {e}"))?;

    doc.decompress();

    let source_page_id = *doc
        .get_pages()
        .values()
        .next()
        .ok_or_else(|| "pad_page_to_a4: PDF has no pages".to_string())?;

    // Read the source page's MediaBox to determine content dimensions.
    let (src_w_pt, src_h_pt) = {
        let page = doc
            .get_dictionary(source_page_id)
            .map_err(|e| format!("pad_page_to_a4: failed to get page dict: {e}"))?;
        let mb = page
            .get(b"MediaBox")
            .map_err(|_| "pad_page_to_a4: page has no MediaBox".to_string())?
            .as_array()
            .map_err(|_| "pad_page_to_a4: MediaBox is not an array".to_string())?;
        if mb.len() != 4 {
            return Err("pad_page_to_a4: invalid MediaBox".to_string());
        }
        let nums: Vec<f64> = mb
            .iter()
            .map(|o| match o {
                Object::Real(n) => *n as f64,
                Object::Integer(n) => *n as f64,
                _ => 0.0,
            })
            .collect();
        (nums[2] - nums[0], nums[3] - nums[1])
    };

    // If already A4 height (within 1pt), return as-is.
    if (src_h_pt - A4_PT_H).abs() < 1.0 {
        let mut buf = Vec::new();
        doc.save_to(&mut buf)
            .map_err(|e| format!("pad_page_to_a4: failed to save: {e}"))?;
        return Ok(buf);
    }

    // Extract content streams from the source page.
    let page = doc
        .get_dictionary(source_page_id)
        .map_err(|e| format!("pad_page_to_a4: failed to get page dict: {e}"))?
        .clone();

    let mut combined = Vec::new();
    if let Ok(contents) = page.get(b"Contents") {
        let refs: Vec<lopdf::ObjectId> = match contents {
            Object::Array(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
            Object::Reference(id) => vec![*id],
            _ => Vec::new(),
        };
        for stream_id in refs {
            if let Ok(stream_obj) = doc.get_object(stream_id) {
                if let Ok(s) = stream_obj.as_stream() {
                    combined.extend_from_slice(&s.content);
                }
            }
        }
    }

    // Build a form XObject from the decompressed content.
    let mut xobj_dict = Dictionary::new();
    xobj_dict.set("Type", Object::Name(b"XObject".to_vec()));
    xobj_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    xobj_dict.set(
        "BBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(src_w_pt as f32),
            Object::Real(src_h_pt as f32),
        ]),
    );
    if let Ok(resources) = page.get(b"Resources") {
        xobj_dict.set("Resources", resources.clone());
    }
    let form_id = doc.add_object(Stream::new(xobj_dict, combined));

    // Vertical centering: y_offset = (A4_PT_H - src_h_pt) / 2
    let y_offset = (A4_PT_H - src_h_pt) / 2.0;
    let content_bytes = format!("q\n1 0 0 1 0 {y_offset:.2} cm\n/Fm0 Do\nQ\n").into_bytes();
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content_bytes));

    // Resources pointing to the form XObject.
    let mut xobj_res = Dictionary::new();
    xobj_res.set("Fm0", Object::Reference(form_id));
    let mut res_dict = Dictionary::new();
    res_dict.set("XObject", Object::Dictionary(xobj_res));
    let res_id = doc.add_object(res_dict);

    // Create the new A4 page.
    let root_id: lopdf::ObjectId = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| "pad_page_to_a4: missing Root reference".to_string())?;
    let pages_id: lopdf::ObjectId = doc
        .get_dictionary(root_id)
        .map_err(|e| format!("pad_page_to_a4: failed to get Root: {e}"))?
        .get(b"Pages")
        .and_then(|o| o.as_reference())
        .map_err(|_| "pad_page_to_a4: missing Pages reference".to_string())?;

    let mut a4_page = Dictionary::new();
    a4_page.set("Type", Object::Name(b"Page".to_vec()));
    a4_page.set("Parent", Object::Reference(pages_id));
    a4_page.set(
        "MediaBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(A4_PT_W as f32),
            Object::Real(A4_PT_H as f32),
        ]),
    );
    a4_page.set("Resources", Object::Reference(res_id));
    a4_page.set("Contents", Object::Reference(content_id));
    let new_page_id = doc.add_object(a4_page);

    // Update the Pages tree to point to the new page.
    {
        let pages_dict = doc
            .get_dictionary_mut(pages_id)
            .map_err(|e| format!("pad_page_to_a4: failed to get Pages: {e}"))?;
        pages_dict.set("Kids", Object::Array(vec![Object::Reference(new_page_id)]));
        pages_dict.set("Count", Object::Integer(1));
    }
    doc.objects.remove(&source_page_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf)
        .map_err(|e| format!("pad_page_to_a4: failed to save: {e}"))?;
    Ok(buf)
}

// ── Platform-agnostic PDF concatenation (the reusable part) ────────

/// Concatenate a series of single-page PDFs into one multi-page PDF on
/// disk. Each input `Vec<u8>` contains a standalone single-page PDF
/// produced by a platform's native WebView capture (e.g. WKWebView
/// `createPDF` with a rect, or WebView2 `PrintToPdf`).
///
/// The function copies every object from each source PDF into a fresh
/// output document with ID remapping, then links all the source pages
/// under a single Pages tree.  No coordinate transforms, form XObjects
/// or content-stream manipulation are involved — each page's content
/// is preserved byte-for-byte from the source.
pub(crate) fn concatenate_pdfs(pages: &[Vec<u8>], output_path: &str) -> Result<(), String> {
    use lopdf::{Dictionary, Document, Object, ObjectId};
    use std::collections::HashMap;

    if pages.is_empty() {
        return Err("No pages to concatenate".to_string());
    }

    eprintln!(
        "[pdf] concatenate_pdfs: {} pages -> {}",
        pages.len(),
        output_path
    );

    let mut output = Document::new();
    let pages_dict_id = output.new_object_id();

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Kids", Object::Array(vec![]));
    pages_dict.set("Count", Object::Integer(0));
    output
        .objects
        .insert(pages_dict_id, Object::Dictionary(pages_dict));

    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_dict_id));
    let catalog_id = output.new_object_id();
    output
        .objects
        .insert(catalog_id, Object::Dictionary(catalog));
    output
        .trailer
        .set("Root", Object::Reference(catalog_id));

    let mut page_num: usize = 0;

    for page_bytes in pages {
        if page_bytes.is_empty() {
            continue;
        }

        let source =
            Document::load_mem(page_bytes).map_err(|e| format!("Failed to load page PDF: {e}"))?;

        let source_pages = source.get_pages();
        if source_pages.is_empty() {
            continue;
        }

        let mut id_map: HashMap<ObjectId, ObjectId> = HashMap::new();
        for src_id in source.objects.keys() {
            let new_id = output.new_object_id();
            id_map.insert(*src_id, new_id);
        }

        for (src_id, src_obj) in &source.objects {
            let new_id = id_map[src_id];
            let new_obj = remap_object(src_obj, &id_map);
            output.objects.insert(new_id, new_obj);
        }

        for src_page_id in source_pages.values() {
            let new_page_id = id_map[src_page_id];
            if let Ok(obj) = output.get_object_mut(new_page_id) {
                if let Object::Dictionary(ref mut page_dict) = obj {
                    page_dict.set("Parent", Object::Reference(pages_dict_id));
                }
            }
        }

        let pages = output
            .get_dictionary_mut(pages_dict_id)
            .map_err(|e| format!("Failed to get Pages dict: {e}"))?;

        let mut kids = match pages.get(b"Kids") {
            Ok(Object::Array(arr)) => arr.clone(),
            _ => Vec::new(),
        };

        for src_page_id in source_pages.values() {
            let new_page_id = id_map[src_page_id];
            kids.push(Object::Reference(new_page_id));
            page_num += 1;
        }

        pages.set("Kids", Object::Array(kids));
        pages.set("Count", Object::Integer(page_num as i64));
    }

    eprintln!("[pdf] concatenate: saving {} pages…", page_num);
    let mut buf = Vec::new();
    output
        .save_to(&mut buf)
        .map_err(|e| format!("Failed to save concatenated PDF: {e}"))?;
    std::fs::write(output_path, &buf).map_err(|e| format!("Failed to write PDF: {e}"))?;

    eprintln!(
        "[pdf] concatenate_pdfs: done → {} pages, {} bytes",
        page_num,
        buf.len()
    );
    Ok(())
}

fn remap_object(obj: &lopdf::Object, id_map: &std::collections::HashMap<lopdf::ObjectId, lopdf::ObjectId>) -> lopdf::Object {
    use lopdf::{Dictionary, Object, Stream};

    match obj {
        Object::Reference(id) => Object::Reference(*id_map.get(id).unwrap_or(id)),
        Object::Array(arr) => Object::Array(arr.iter().map(|o| remap_object(o, id_map)).collect()),
        Object::Dictionary(d) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in d.iter() {
                new_dict.set(k.clone(), remap_object(v, id_map));
            }
            Object::Dictionary(new_dict)
        }
        Object::Stream(stream) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in stream.dict.iter() {
                new_dict.set(k.clone(), remap_object(v, id_map));
            }
            Object::Stream(Stream::new(new_dict, stream.content.clone()))
        }
        other => other.clone(),
    }
}

// ═══════════════════════════════════════════════════════════════════
// Cross-platform PDF renderers
// ═══════════════════════════════════════════════════════════════════
//
// macOS uses rect-based capture + concatenation (above).
// Windows / Linux use the native print pipeline with CSS page breaks
// (no post-processing needed).
// iOS / Android use a simplified splitter (TODO: port to rect-based
// once the vendor plugin supports per-page rect capture).

/// Shared JS snippet that reads the page cuts computed by the export
/// HTML's inline script. Used by mobile platforms (iOS / Android).
#[cfg(any(target_os = "ios", target_os = "android"))]
const RENDER_PAGE_CUTS_SCRIPT: &str = "JSON.stringify((window.__bnPageCuts || []))";

/// Write the export HTML to a uniquely-named temp file. Mirrors the
/// existing macOS `write_html_to_temp` (which stays under its
/// original `#[cfg]` gate) so the non-Apple renderers can use the
/// same on-disk layout.
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

// ── iOS / Android scoped-storage helpers ────────────────────────────
//
// On mobile, the save dialog (scoped-storage.js) returns paths like
// `scoped:<folder_id>/<relative_path>`.  The native PDF render plugin
// and `std::fs` cannot resolve that scheme, so we stage the PDF
// through a temp file and then ask the native plugin to copy the
// final A4-split result into the scoped destination.

/// Parses a `scoped:` path into `(folder_id, relative_path)`.
/// Returns `None` if the path does not use the scoped scheme.
#[cfg(any(target_os = "ios", target_os = "android"))]
fn parse_scoped_path(path: &str) -> Option<(String, String)> {
    let remainder = path.strip_prefix("scoped:")?;
    let (folder_id, relative) = remainder.split_once('/')?;
    if folder_id.is_empty() || relative.is_empty() {
        return None;
    }
    Some((folder_id.to_string(), relative.to_string()))
}

/// Creates a unique temp file path the native plugin and `std::fs` can safely use.
#[cfg(any(target_os = "ios", target_os = "android"))]
fn scoped_temp_output_path() -> String {
    let mut temp = std::env::temp_dir();
    temp.push(format!("beaver-pdf-scoped-{}.pdf", std::process::id()));
    temp.to_string_lossy().into_owned()
}

// ── Mobile-only A4 splitter (TODO: remove once the plugin supports rects) ──
//
// iOS / Android still render a single tall PDF via the vendor plugin.
// The splitter below slices it into A4 pages.  We call doc.decompress()
// first so the form XObject is built from decompressed content streams,
// fixing the FlateDecode concatenation bug that existed in the old
// platform-agnostic splitter.

#[cfg(any(target_os = "ios", target_os = "android"))]
fn split_pdf_into_a4(
    pdf_bytes: &[u8],
    output_path: &str,
) -> Result<(), String> {
    use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
    use std::collections::HashMap;

    if pdf_bytes.is_empty() {
        return Err("Empty PDF input".to_string());
    }

    let mut doc = Document::load_mem(pdf_bytes).map_err(|e| format!("Failed to parse PDF: {e}"))?;
    if doc.get_pages().is_empty() {
        return Err("PDF has no pages".to_string());
    }

    // Decompress all streams so the form XObject gets raw content.
    // This fixes the FlateDecode concatenation bug in the old splitter.
    doc.decompress();

    let source_page_id = *doc
        .get_pages()
        .values()
        .next()
        .ok_or_else(|| "PDF has no pages".to_string())?;

    let (src_w_css_px, src_h_css_px) = {
        let page = doc
            .get_dictionary(source_page_id)
            .map_err(|e| format!("Failed to get page dict: {e}"))?;
        let mb = page
            .get(b"MediaBox")
            .map_err(|_| "Page has no MediaBox".to_string())?
            .as_array()
            .map_err(|_| "MediaBox is not an array".to_string())?;
        if mb.len() != 4 {
            return Err("Invalid MediaBox".to_string());
        }
        let nums: Vec<f64> = mb
            .iter()
            .map(|o| match o {
                Object::Real(n) => *n as f64,
                Object::Integer(n) => *n as f64,
                _ => 0.0,
            })
            .collect();
        (nums[2] - nums[0], nums[3] - nums[1])
    };

    let strip_h_pt = A4_PT_H - 2.0 * PDF_PAGE_MARGIN_PT;
    let strip_h_css_px = strip_h_pt / CSS_PX_TO_PT;

    if src_h_css_px <= strip_h_css_px {
        std::fs::write(output_path, pdf_bytes).map_err(|e| format!("Failed to write PDF: {e}"))?;
        return Ok(());
    }

    // Simple fixed-strip cuts (no keep-block awareness — the mobile
    // plugin doesn't give us keep-block data currently).  This is a
    // deliberate simplification until we port mobile to rect capture.
    //
    // We compute cuts at every `strip_h_css_px` boundary.
    let mut cuts: Vec<f64> = Vec::new();
    let mut y = 0.0;
    while y < src_h_css_px - 0.5 {
        y += strip_h_css_px;
        cuts.push(y.min(src_h_css_px));
    }

    // Build a form XObject from the source page (decompressed).
    let page = doc
        .get_dictionary(source_page_id)
        .map_err(|e| format!("Failed to get page dict: {e}"))?
        .clone();

    let mut combined = Vec::new();
    if let Ok(contents) = page.get(b"Contents") {
        let refs: Vec<lopdf::ObjectId> = match contents {
            Object::Array(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
            Object::Reference(id) => vec![*id],
            _ => Vec::new(),
        };
        for stream_id in refs {
            if let Ok(stream_obj) = doc.get_object(stream_id) {
                if let Ok(s) = stream_obj.as_stream() {
                    combined.extend_from_slice(&s.content);
                }
            }
        }
    }

    let mut xobj_dict = Dictionary::new();
    xobj_dict.set("Type", Object::Name(b"XObject".to_vec()));
    xobj_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    xobj_dict.set(
        "BBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(src_w_css_px as f32),
            Object::Real(src_h_css_px as f32),
        ]),
    );
    if let Ok(resources) = page.get(b"Resources") {
        xobj_dict.set("Resources", resources.clone());
    }
    let form_id = doc.add_object(Stream::new(xobj_dict, combined));

    let root_id: lopdf::ObjectId = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| "Missing Root reference".to_string())?;
    let pages_id: lopdf::ObjectId = doc
        .get_dictionary(root_id)
        .map_err(|e| format!("Failed to get Root: {e}"))?
        .get(b"Pages")
        .and_then(|o| o.as_reference())
        .map_err(|_| "Missing Pages reference".to_string())?;

    let x_scale = CSS_PX_TO_PT;
    let inset_x = PDF_PAGE_MARGIN_PT;
    let inset_y = PDF_PAGE_MARGIN_PT;
    let inset_w = A4_PT_W - 2.0 * PDF_PAGE_MARGIN_PT;
    let inset_h = A4_PT_H - 2.0 * PDF_PAGE_MARGIN_PT;
    let clip_cmd = format!("q\n{inset_x} {inset_y} {inset_w} {inset_h} re W n\n");

    let mut cursor = 0.0_f64;
    let mut new_page_ids: Vec<ObjectId> = Vec::with_capacity(cuts.len());
    for &cut in &cuts {
        let y_offset = (A4_PT_H - PDF_PAGE_MARGIN_PT) - x_scale * (src_h_css_px - cursor);
        let content_bytes = format!(
            "{clip}{x_scale} 0 0 {x_scale} {x_offset} {y_offset} cm\n/Im0 Do\nQ\n",
            clip = clip_cmd,
            x_scale = x_scale,
            x_offset = PDF_PAGE_MARGIN_PT,
            y_offset = y_offset,
        )
        .into_bytes();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content_bytes));

        let mut xobj_dict = Dictionary::new();
        xobj_dict.set("Im0", Object::Reference(form_id));
        let mut res_dict = Dictionary::new();
        res_dict.set("XObject", Object::Dictionary(xobj_dict));
        let res_id = doc.add_object(res_dict);

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set(
            "MediaBox",
            Object::Array(vec![
                Object::Real(0.0),
                Object::Real(0.0),
                Object::Real(A4_PT_W as f32),
                Object::Real(A4_PT_H as f32),
            ]),
        );
        page_dict.set("Resources", Object::Reference(res_id));
        page_dict.set("Contents", Object::Reference(content_id));
        new_page_ids.push(doc.add_object(page_dict));
        cursor = cut;
    }

    {
        let pages_dict = doc
            .get_dictionary_mut(pages_id)
            .map_err(|e| format!("Failed to get Pages: {e}"))?;
        let new_kids: Vec<Object> = new_page_ids
            .iter()
            .map(|id| Object::Reference(*id))
            .collect();
        pages_dict.set("Kids", Object::Array(new_kids));
        pages_dict.set("Count", Object::Integer(new_page_ids.len() as i64));
    }
    doc.objects.remove(&source_page_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf)
        .map_err(|e| format!("Failed to save PDF: {e}"))?;
    std::fs::write(output_path, &buf).map_err(|e| format!("Failed to write PDF: {e}"))?;
    Ok(())
}

// ── iOS ─────────────────────────────────────────────────────────────────────
//
// iOS PDF export is driven by the iOS app's native runtime through the
// `tauri-plugin-pdf-render` plugin (see `vendor/tauri-plugin-pdf-render`).
// The `objc2-web-kit` 0.3 crate does not expose `WKWebView` on iOS
// (its Rust binding is gated to macOS), so the actual WebView work
// has to run in the app's native runtime, wired in via the plugin
// mechanism. The plugin drives a real `WKWebView` on iOS / `WebView`
// on Android to load the export HTML, run the keep-blocks
// measurement script, and write the resulting PDF + keep-blocks JSON
// to disk; the split-into-A4 step then runs in Rust.

#[cfg(target_os = "ios")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use tauri_plugin_pdf_render::{PdfRenderExt, RenderRequest, WriteScopedRequest};

    let html_path = write_export_html_to_temp(&html)?;

    // Resolve the output path: on mobile the save dialog returns a
    // `scoped:` path that the native plugin and `std::fs` cannot
    // resolve, so we stage the render through a temp file.
    let scoped_info = parse_scoped_path(&output_path);
    let render_output = if scoped_info.is_some() {
        scoped_temp_output_path()
    } else {
        output_path.clone()
    };

    let request = RenderRequest {
        html_path: html_path.to_string_lossy().into_owned(),
        output_path: render_output.clone(),
        measure_script: RENDER_PAGE_CUTS_SCRIPT.to_string(),
        timeout_ms: 30_000,
    };

    let app_clone = app.clone();
    let response = tokio::task::spawn_blocking(move || app_clone.pdf_render().render(request))
        .await
        .map_err(|e| format!("PDF render task join error: {e}"))?
        .map_err(|e| format!("iOS PDF render failed: {e}"))?;

    let _ = std::fs::remove_file(&html_path);

    let pdf_bytes =
        std::fs::read(&render_output).map_err(|e| format!("Failed to read iOS PDF: {e}"))?;

    // Use the mobile-only splitter (with decompress fix) to slice into A4 pages.
    split_pdf_into_a4(&pdf_bytes, &render_output)?;

    // If the user picked a scoped-storage folder, copy the split PDF
    // from the temp file into the scoped destination.
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
//
// Uses `webview2-com` (Microsoft.Web.WebView2) to render the HTML in
// an off-screen `CoreWebView2Controller` hosted on a message-only
// HWND. The webview is navigated to the temp HTML file; once the
// load finishes we run the measurement script via `ExecuteScript`
// and then `PrintToPdf` to get the raw PDF bytes.

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
        CreateWindowExW, DestroyWindow, RegisterClassExW, HWND_MESSAGE, WM_DESTROY, WNDCLASSEXW,
        WS_EX_LAYERED, WS_OVERLAPPEDWINDOW,
    };

    let html_path = write_export_html_to_temp(&html)?;
    let url_string = format!(
        "file:///{}",
        html_path.display().to_string_lossy().replace('\\', "/")
    );

    // Output directory: the save dialog already returns a path
    // the user (and the OS) consider writable. We skip
    // `create_dir_all` to avoid EROFS on sandboxed/mobile
    // platforms where the chosen path may sit inside a
    // read-only system mount.

    // WebView2 setup: create a hidden message-only HWND, navigate
    // to the HTML, wait for the JS page-break script to run, then
    // call PrintToPdf.  The JS-inserted `break-after: page` rules
    // let the print engine paginate automatically — no post-processing.
    let (result_tx, result_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

    std::thread::spawn(move || {
        let run = || -> Result<Vec<u8>, String> {
            // Initialise COM for this thread (apartment-threaded
            // matches WebView2's STA expectation).
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .map_err(|e| format!("CoInitializeEx: {e}"))?;
            }

            // Register a minimal window class and create a hidden
            // message-only HWND to host the WebView2 controller.
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
                // RegisterClassExW returns 0 on failure (including
                // duplicate class); ignore — the class may already
                // be registered from a prior call in the same
                // process.
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

            // The COM callback chain. Each step sends its result on
            // a `smpsc` channel; the next step receives it inside
            // the callback. The final step (PrintToPdf) sends the
            // PDF bytes; we then run a `GetMessage`/`DispatchMessage`
            // pump until shutdown, at which point the
            // `NavigationCompleted` and `PrintToPdf` callbacks have
            // fired.
            let (env_tx, env_rx) = smpsc::channel::<Result<ICoreWebView2Environment, String>>();
            let (ctrl_tx, ctrl_rx) = smpsc::channel::<Result<ICoreWebView2Controller, String>>();
            let (nav_tx, nav_rx) = smpsc::channel::<Result<(), String>>();
            let (pdf_tx, pdf_rx) = smpsc::channel::<Result<Vec<u8>, String>>();

            // 1) Create the WebView2 environment.
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

            // 2) Create the controller bound to our hidden HWND.
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

            // 3) Make the controller's webview fill the HWND and stay
            //    hidden. `put_IsVisible(false)` keeps it off-screen
            //    even though it's parented.
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

            // 4) Subscribe to `NavigationCompleted` and navigate.
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

            // 5) Wait for the JS page-break script and layout to settle.
            std::thread::sleep(std::time::Duration::from_millis(250));

            // 6) PrintToPdf handles pagination natively: the JS
            //    `break-after: page` rules cause the print engine
            //    to produce a multi-page A4 PDF directly.
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

            // Clean up the staged PDF and the hidden HWND.
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
//
// Uses `webkit2gtk` (WebKitGTK 2.x, GTK3) to render the HTML in an
// off-screen `WebView` inside a hidden `GtkWindow`. The measurement
// script is evaluated via `WebViewExt::evaluate_javascript` and the
// PDF is produced by `WebKitPrintOperation` configured with
// `print-to-file=true` and `output-format=pdf`.
//
// All GTK / WebKit work must run on the main thread; we dispatch
// there from a helper thread and bridge the result back via a sync
// channel.

#[cfg(target_os = "linux")]
async fn render_native(_app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use std::sync::mpsc as smpsc;

    let html_path = write_export_html_to_temp(&html)?;

    // Output directory: the save dialog already returns a path
    // the user (and the OS) consider writable. We skip
    // `create_dir_all` to avoid EROFS on sandboxed/mobile
    // platforms where the chosen path may sit inside a
    // read-only system mount.

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

            // Initialise GTK (safe to call multiple times; subsequent
            // calls return Ok(()) without re-init).
            gtk::init().map_err(|e| format!("gtk::init: {e}"))?;

            // Build a hidden toplevel window that hosts the webview.
            // We never call `show_all` so the window never appears.
            let window = gtk::Window::new(gtk::WindowType::Toplevel);
            window.set_default_size(A4_CSS_W as i32, A4_CSS_H as i32);

            let webview = WebView::new();
            window.add(&webview);
            // The webview needs a size allocation for layout.
            webview.set_size_request(A4_CSS_W as i32, A4_CSS_H as i32);

            // Shared state for the main loop and results.
            let load_result: Rc<RefCell<Option<Result<(), String>>>> = Rc::new(RefCell::new(None));
            let pdf_result: Rc<RefCell<Option<Result<Vec<u8>, String>>>> =
                Rc::new(RefCell::new(None));

            let loop_load = MainLoop::new(None, false);
            let loop_pdf = MainLoop::new(None, false);

            // 1) Load the file and wait for the load to finish.
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

            // Give the JS page-break script + inlined images time to settle.
            glib::timeout_future(250).wait();

            // 2) Run a print operation.  The JS-inserted `break-after: page`
            //    rules let WebKit's print engine paginate automatically —
            //    no post-processing needed.
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

            // `print_op.run()` is async on the main loop; connect
            // `finished` to capture the result.
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

            // Tear down the window (the webview is dropped with it).
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

// ── Android ──────────────────────────────────────────────────────────────────
//
// Android PDF export is driven by the Android app's Kotlin runtime through
// the `tauri-plugin-pdf-render` plugin (see
// `vendor/tauri-plugin-pdf-render`). The Rust side cannot drive the
// Android WebView directly (UI APIs are Kotlin-only), so the plugin
// drives a real `WebView` to load the export HTML, run the
// keep-blocks measurement script, and write the resulting PDF +
// keep-blocks JSON to disk; the split-into-A4 step then runs in Rust.

#[cfg(target_os = "android")]
async fn render_native(app: AppHandle, html: String, output_path: String) -> Result<(), String> {
    use tauri_plugin_pdf_render::{PdfRenderExt, RenderRequest, WriteScopedRequest};

    let html_path = write_export_html_to_temp(&html)?;

    // Resolve the output path: on mobile the save dialog returns a
    // `scoped:` path that the native plugin and `std::fs` cannot
    // resolve, so we stage the render through a temp file.
    let scoped_info = parse_scoped_path(&output_path);
    let render_output = if scoped_info.is_some() {
        scoped_temp_output_path()
    } else {
        output_path.clone()
    };

    let request = RenderRequest {
        html_path: html_path.to_string_lossy().into_owned(),
        output_path: render_output.clone(),
        measure_script: RENDER_PAGE_CUTS_SCRIPT.to_string(),
        timeout_ms: 30_000,
    };

    let app_clone = app.clone();
    let response = tokio::task::spawn_blocking(move || app_clone.pdf_render().render(request))
        .await
        .map_err(|e| format!("PDF render task join error: {e}"))?
        .map_err(|e| format!("Android PDF render failed: {e}"))?;

    let _ = std::fs::remove_file(&html_path);

    let pdf_bytes =
        std::fs::read(&render_output).map_err(|e| format!("Failed to read Android PDF: {e}"))?;

    // Use the mobile-only splitter (with decompress fix) to slice into A4 pages.
    split_pdf_into_a4(&pdf_bytes, &render_output)?;

    // If the user picked a scoped-storage folder, copy the split PDF
    // from the temp file into the scoped destination.
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

// ── Fallback for any platform we haven't implemented ───────────────
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
