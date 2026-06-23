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

const PDF_WINDOW_LABEL: &str = "pdf-render";

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
    #[cfg(target_os = "macos")]
    {
        render_pdf_native(app, html, output_path).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, html, output_path);
        Err("Native PDF rendering is currently supported on macOS only".to_string())
    }
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

    // 2) Make sure the output directory exists.
    let output_path_buf = PathBuf::from(&output_path);
    if let Some(parent) = output_path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // 3) Create a hidden webview window sized to A4 in CSS pixels.
    let (page_tx, page_rx) = oneshot::channel::<()>();
    let (load_tx, load_rx) = mpsc::channel::<()>();
    let builder = WebviewWindowBuilder::new(
        &app,
        PDF_WINDOW_LABEL,
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

    // 4) Let inlined images and any remaining reflows settle.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // 5) Capture the entire document as a single tall PDF page.
    let pdf_bytes = create_full_page_pdf(&window).await;

    // 6) Tear the hidden window down regardless of capture outcome.
    let _ = window.destroy();
    let _ = std::fs::remove_file(&html_path);

    // 7) Split the tall page into A4 pages and write to disk.
    let pdf_bytes = pdf_bytes?;
    split_into_a4_pages(&pdf_bytes, &output_path)
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

/// Capture the entire document as a single PDF page sized to fit the
/// content, and return the bytes. WebKit's `createPDF` with no rect
/// captures the document's full bounds in screen mode — this is the
/// "single tall page" the splitter will slice into A4 pages.
#[cfg(target_os = "macos")]
async fn create_full_page_pdf(window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    let (tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let (raw_tx, raw_rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    tokio::spawn(async move {
        if let Ok(data) = raw_rx.recv() {
            let _ = tx.send(data);
        }
    });

    window
        .with_webview(move |webview| {
            if let Err(e) = run_create_pdf(webview.inner(), raw_tx) {
                eprintln!("Failed to start PDF generation: {e}");
            }
        })
        .map_err(|e| e.to_string())?;

    rx.await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn run_create_pdf(
    webview_ptr: *mut std::ffi::c_void,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView};

    let mtm =
        MainThreadMarker::new().ok_or_else(|| "Must be called from the main thread".to_string())?;
    let webview: Retained<WKWebView> = unsafe { Retained::retain(webview_ptr as *mut WKWebView) }
        .ok_or_else(|| "Invalid WKWebView pointer".to_string())?;
    let config = unsafe { WKPDFConfiguration::new(mtm) };
    // Leave `rect` at the default (the null rect) so WebKit captures the
    // entire document. The document is rendered at its natural size in
    // a single PDF page; we slice it into A4 pages in `split_into_a4_pages`.

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

// ── Platform-agnostic A4 splitter (the reusable part) ──────────────

/// Take a PDF that consists of a single page whose height is taller than
/// A4, and rewrite it so the content is split horizontally across N
/// pages of `A4_PT_W × A4_PT_H` (595×842 pt). The source page is
/// reused as a form XObject that is stamped onto each new A4 page with
/// the appropriate vertical translation.
///
/// This routine is the only piece of platform-agnostic PDF logic in
/// this file. Any future renderer (iOS WebView, Windows WebView2,
/// Linux webkit2gtk, mobile WebView) just needs to hand its raw PDF
/// bytes to this function; the output is always an A4-paginated PDF
/// on disk.
pub(crate) fn split_into_a4_pages(pdf_bytes: &[u8], output_path: &str) -> Result<(), String> {
    use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

    if pdf_bytes.is_empty() {
        return Err("Empty PDF input".to_string());
    }

    let mut doc = Document::load_mem(pdf_bytes).map_err(|e| format!("Failed to parse PDF: {e}"))?;

    if doc.get_pages().is_empty() {
        return Err("PDF has no pages".to_string());
    }

    // We expect a single source page. Read its media box so we know
    // how tall the content is and how to scale the form onto A4.
    // `read_page_size` returns CSS-px (the source's native units; see
    // its doc comment).
    let source_page_id = *doc
        .get_pages()
        .values()
        // .values() yields &ObjectId; we need ObjectId by value
        .next()
        .ok_or_else(|| "PDF has no pages".to_string())?;
    let (src_w_css_px, src_h_css_px) = read_page_size(&doc, source_page_id)?;

    // CSS-px → pt: 1 CSS-px = 72/96 pt. WebKit's `createPDF` produces a
    // PDF in CSS-px units; the A4 pages we emit are in points. The
    // form XObject's content is in CSS-px, so the transform has to do
    // the unit conversion.
    let css_px_to_pt = 72.0 / 96.0;
    let src_h_pt = src_h_css_px * css_px_to_pt;

    let n_strips = ((src_h_pt / A4_PT_H).ceil() as usize).max(1);

    // Build a form XObject from the source page so we can stamp it
    // onto multiple A4 pages with different vertical translations.
    // The form's BBox is in CSS-px (matching the source's coord
    // system) so the form's content is rendered at its natural size
    // before the transform scales it to A4's pt.
    let form_id = build_page_form_xobject(&mut doc, source_page_id)?;

    // Find the unified Pages dict (the one the source page references).
    let root_id: lopdf::ObjectId = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| "Missing Root reference".to_string())?;
    let root_dict = doc
        .get_dictionary(root_id)
        .map_err(|e| format!("Failed to get Root: {e}"))?;
    let pages_id: lopdf::ObjectId = root_dict
        .get(b"Pages")
        .and_then(|o| o.as_reference())
        .map_err(|_| "Missing Pages reference".to_string())?;

    // Create N A4 pages, each rendering the form translated and scaled
    // so the i-th A4-tall strip of the source (in CSS-px) fills the
    // A4 page (in pt).
    //
    // The transform `cm a b c d e f` maps form-coord (x, y) to
    // page-coord (a*x + c*y + e, b*x + d*y + f). We want:
    //   - form-x in [0, src_w_css_px]  -> page-x in [0, A4_PT_W]
    //   - form-y in [src_h_css_px - (i+1)*A4_CSS_H, src_h_css_px - i*A4_CSS_H]
    //     -> page-y in [0, A4_PT_H]
    //
    // The form's content is in CSS-px, the page is in pt, so the
    // natural scale is `css_px_to_pt` (≈ 0.75). One A4 strip in
    // CSS-px is `A4_CSS_H` = 1123 CSS-px = 842 pt (after conversion).
    let x_scale = css_px_to_pt;
    for i in 0..n_strips {
        // Solve page-y = d * form-y + f with d = css_px_to_pt and the
        // strip's top mapping to A4_PT_H.
        let y_offset = A4_PT_H - css_px_to_pt * (src_h_css_px - (i as f64) * A4_CSS_H);

        let content_bytes =
            format!("q\n{x_scale} 0 0 {x_scale} 0 {y_offset} cm\n/Im0 Do\nQ\n").into_bytes();

        let content_id = doc.add_object(Stream::new(Dictionary::new(), content_bytes));

        // Build the resources for the new page: just the form XObject.
        let mut xobject_dict = Dictionary::new();
        xobject_dict.set("Im0", Object::Reference(form_id));
        let mut resources_dict = Dictionary::new();
        resources_dict.set("XObject", Object::Dictionary(xobject_dict));
        let resources_id = doc.add_object(resources_dict);

        // Build the new A4 page.
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
        page_dict.set("Resources", Object::Reference(resources_id));
        page_dict.set("Contents", Object::Reference(content_id));
        let page_id: ObjectId = doc.add_object(page_dict);

        // Append the new page to the page tree.
        let pages_dict = doc
            .get_dictionary_mut(pages_id)
            .map_err(|e| format!("Failed to get Pages: {e}"))?;
        let kids = pages_dict
            .get_mut(b"Kids")
            .map_err(|_| "Pages dict has no Kids".to_string())?;
        let kids_arr = kids
            .as_array_mut()
            .map_err(|_| "Pages Kids is not an array".to_string())?;
        kids_arr.push(Object::Reference(page_id));
        let count = pages_dict
            .get_mut(b"Count")
            .map_err(|_| "Pages dict has no Count".to_string())?;
        if let Object::Integer(c) = count {
            *c += 1;
        }
    }

    // Remove the original tall source page from the page tree and
    // from the object table.
    remove_page(&mut doc, source_page_id)?;

    // Save.
    let mut buf = Vec::new();
    doc.save_to(&mut buf)
        .map_err(|e| format!("Failed to save PDF: {e}"))?;
    std::fs::write(output_path, &buf).map_err(|e| format!("Failed to write PDF: {e}"))?;

    Ok(())
}

/// Read a page's media box and return `(width, height)` in the source's
/// native units.
///
/// `WKWebView.createPDF` produces a PDF where the MediaBox is in **CSS
/// pixels** (not points), and the content stream is also in CSS-px
/// (WebKit's internal render units). This is unlike most other PDF
/// producers. We return the raw CSS-px values here; the splitter's
/// transform handles the CSS-px → pt conversion when stamping the
/// source onto new A4 pages.
fn read_page_size(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> Result<(f64, f64), String> {
    use lopdf::Object;

    let page = doc
        .get_dictionary(page_id)
        .map_err(|e| format!("Failed to get page: {e}"))?;
    let mb = page
        .get(b"MediaBox")
        .map_err(|_| "Page has no MediaBox".to_string())?;
    let arr = mb
        .as_array()
        .map_err(|_| "MediaBox is not an array".to_string())?;
    if arr.len() != 4 {
        return Err(format!("MediaBox has {} entries, expected 4", arr.len()));
    }
    let nums: Vec<f64> = arr
        .iter()
        .map(|o| match o {
            Object::Real(n) => *n as f64,
            Object::Integer(n) => *n as f64,
            _ => 0.0,
        })
        .collect();
    Ok((nums[2] - nums[0], nums[3] - nums[1]))
}

/// Build a form XObject from a page's content stream + resources.
/// Returns the new XObject's id. Fonts, images, and other resources are
/// preserved in the form so the new pages render exactly the same.
///
/// **Important:** the source's content stream may be FlateDecode-compressed.
/// We must preserve the source's `Filter` / `DecodeParms` on the form
/// XObject's dict, otherwise the PDF interpreter will try to render the
/// raw compressed bytes as plain PostScript and produce blank pages.
fn build_page_form_xobject(
    doc: &mut lopdf::Document,
    page_id: lopdf::ObjectId,
) -> Result<lopdf::ObjectId, String> {
    use lopdf::{Dictionary, Object, Stream};

    let page = doc
        .get_dictionary(page_id)
        .map_err(|e| format!("Failed to get page dict: {e}"))?
        .clone();

    // Concatenate all content streams (Contents may be a single ref or
    // an array of refs). We keep the first stream's dict (with its
    // Filter/DecodeParms) so the form can be decoded the same way.
    let mut combined = Vec::new();
    let mut source_dict: Option<Dictionary> = None;
    if let Ok(contents) = page.get(b"Contents") {
        let refs: Vec<lopdf::ObjectId> = match contents {
            Object::Array(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
            Object::Reference(id) => vec![*id],
            _ => Vec::new(),
        };
        for stream_id in refs {
            if let Ok(stream_obj) = doc.get_object(stream_id) {
                if let Ok(s) = stream_obj.as_stream() {
                    if source_dict.is_none() {
                        source_dict = Some(s.dict.clone());
                    }
                    combined.extend_from_slice(&s.content);
                }
            }
        }
    }

    let (src_w_pt, src_h_pt) = read_page_size(doc, page_id)?;

    // Start from the source's stream dict so Filter / DecodeParms /
    // etc. carry over. Drop `Length` because the writer recomputes it.
    let mut dict = source_dict.unwrap_or_else(Dictionary::new);
    dict.remove(b"Length");
    dict.set("Type", Object::Name(b"XObject".to_vec()));
    dict.set("Subtype", Object::Name(b"Form".to_vec()));
    dict.set(
        "BBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(src_w_pt as f32),
            Object::Real(src_h_pt as f32),
        ]),
    );
    if let Ok(resources) = page.get(b"Resources") {
        dict.set("Resources", resources.clone());
    }

    let id = doc.add_object(Stream::new(dict, combined));
    Ok(id)
}

/// Remove a page from the document's page tree and from the object
/// table, fixing up `Kids` and `Count`.
fn remove_page(doc: &mut lopdf::Document, page_id: lopdf::ObjectId) -> Result<(), String> {
    use lopdf::Object;

    let root_id: lopdf::ObjectId = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| "Missing Root reference".to_string())?;
    let root_dict = doc
        .get_dictionary(root_id)
        .map_err(|e| format!("Failed to get Root: {e}"))?;
    let pages_id: lopdf::ObjectId = root_dict
        .get(b"Pages")
        .and_then(|o| o.as_reference())
        .map_err(|_| "Missing Pages reference".to_string())?;

    let pages_dict = doc
        .get_dictionary_mut(pages_id)
        .map_err(|e| format!("Failed to get Pages: {e}"))?;
    if let Ok(kids) = pages_dict.get_mut(b"Kids") {
        if let Ok(arr) = kids.as_array_mut() {
            arr.retain(|k| !matches!(k, Object::Reference(id) if *id == page_id));
        }
    }
    if let Ok(count) = pages_dict.get_mut(b"Count") {
        if let Object::Integer(c) = count {
            *c -= 1;
        }
    }

    doc.objects.remove(&page_id);
    Ok(())
}
