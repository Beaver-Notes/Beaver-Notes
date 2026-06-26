import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit
import os.log

private let logger = OSLog(subsystem: "com.plugin.pdf.render", category: "PdfRender")

// MARK: - Argument / response models

class RenderArgs: Decodable {
    let htmlPath: String
    let outputPath: String
    let measureScript: String
    let timeoutMs: UInt64
}

class RenderResponse: Encodable {
    let keepBlocksJson: String
    init(keepBlocksJson: String) {
        self.keepBlocksJson = keepBlocksJson
    }
}

class WriteScopedArgs: Decodable {
    let sourcePath: String
    let scopedOutputPath: String
}

// MARK: - Scoped-storage resolution helpers

/// Resolves a `scoped:<folder_id>/<relative_path>` into a file URL
/// by looking up the security-scoped bookmark in UserDefaults
/// (the same store that `tauri-plugin-scoped-storage` uses).
@available(iOS 14.0, *)
private enum ScopedPathResolver {
    private static let bookmarkPrefix = "scoped_storage.bookmark."

    /// Parse a `scoped:` path into `(folderId, relativePath)`.
    static func parse(_ path: String) -> (folderId: String, relativePath: String)? {
        guard path.hasPrefix("scoped:") else { return nil }
        let remainder = String(path.dropFirst("scoped:".count))
        guard let slashIdx = remainder.firstIndex(of: "/") else { return nil }
        let folderId = String(remainder[..<slashIdx])
        let relative = String(remainder[remainder.index(after: slashIdx)...])
        guard !folderId.isEmpty, !relative.isEmpty else { return nil }
        return (folderId, relative)
    }

    /// Look up the security-scoped bookmark for `folderId` and return
    /// a resolved URL pointing to the folder. The caller must call
    /// `startAccessingSecurityScopedResource()` on the returned URL.
    static func resolveFolder(_ folderId: String) -> URL? {
        guard let bookmark = UserDefaults.standard.data(forKey: bookmarkPrefix + folderId) else {
            return nil
        }
        var isStale = false
        guard let url = try? URL(
            resolvingBookmarkData: bookmark,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        ) else {
            return nil
        }
        // Refresh stale bookmarks (same as the scoped-storage plugin).
        if isStale {
            if let refreshed = try? url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            ) {
                UserDefaults.standard.set(refreshed, forKey: bookmarkPrefix + folderId)
            }
        }
        return url
    }

    /// Resolve a full `scoped:` destination.  Returns the resolved
    /// destination URL **and** the folder URL (needed so the caller
    /// can pair `startAccessing` / `stopAccessing` on the same object).
    /// Returns `nil` when the path cannot be resolved or the folder
    /// is no longer accessible.
    static func resolve(_ scopedPath: String) -> (destUrl: URL, folderUrl: URL)? {
        guard let (folderId, relativePath) = parse(scopedPath) else { return nil }
        guard let folderUrl = resolveFolder(folderId) else { return nil }
        guard folderUrl.startAccessingSecurityScopedResource() else { return nil }
        let destUrl = folderUrl.appendingPathComponent(relativePath)
        return (destUrl, folderUrl)
    }
}

// MARK: - File-writing helper

@available(iOS 14.0, *)
private enum FileWriter {
    /// Writes `data` to `pathOrUrl`, transparently handling
    /// `file://` URLs (security-scoped) and plain paths.
    static func write(_ data: Data, to pathOrUrl: String) -> NSError? {
        let url: URL
        var scoped = false
        if pathOrUrl.hasPrefix("file://") {
            guard let parsed = URL(string: pathOrUrl) else {
                return NSError(domain: "PdfRender", code: 1,
                               userInfo: [NSLocalizedDescriptionKey: "invalid file:// URL: \(pathOrUrl)"])
            }
            url = parsed
            if url.startAccessingSecurityScopedResource() {
                scoped = true
            }
        } else {
            url = URL(fileURLWithPath: pathOrUrl)
        }
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            try data.write(to: url, options: .atomic)
            return nil
        } catch {
            return error as NSError
        }
    }
}

// MARK: - Render state

@available(iOS 14.0, *)
private final class RenderSession: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let args: RenderArgs
    let invoke: Invoke
    private var didFinish = false

    init(webView: WKWebView, args: RenderArgs, invoke: Invoke) {
        self.webView = webView
        self.args = args
        self.invoke = invoke
    }

    func start() {
        // Timeout: bail with an error if the WebView doesn't finish
        // loading + capturing the PDF within the configured budget.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(args.timeoutMs))) { [weak self] in
            guard let self = self, !self.didFinish else { return }
            self.fail("timed out after \(self.args.timeoutMs)ms")
        }

        let htmlURL = URL(fileURLWithPath: args.htmlPath)
        let readAccess = htmlURL.deletingLastPathComponent()
        webView.navigationDelegate = self
        webView.loadFileURL(htmlURL, allowingReadAccessTo: readAccess)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Give inlined images and `setTimeout(0)` measurement a beat.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150)) { [weak self] in
            self?.captureMeasureAndPDF()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("navigation failed: \(error.localizedDescription)")
    }

    private func captureMeasureAndPDF() {
        webView.evaluateJavaScript(args.measureScript) { [weak self] result, error in
            guard let self = self, !self.didFinish else { return }
            if let error = error {
                self.fail("measure eval: \(error.localizedDescription)")
                return
            }
            // `result` is a JSON.stringify(...) string. Unwrap the
            // surrounding quotes so the Rust side gets a plain JSON
            // array string.
            var blocksJson = (result as? String) ?? "[]"
            if blocksJson.count >= 2,
               blocksJson.hasPrefix("\""),
               blocksJson.hasSuffix("\"") {
                let inner = blocksJson.index(blocksJson.startIndex, offsetBy: 1)
                let endIdx = blocksJson.index(blocksJson.endIndex, offsetBy: -1)
                blocksJson = String(blocksJson[inner..<endIdx])
                    .replacingOccurrences(of: "\\\"", with: "\"")
                    .replacingOccurrences(of: "\\\\", with: "\\")
            }

            let config = WKPDFConfiguration()
            webView.createPDF(configuration: config) { [weak self] result in
                guard let self = self, !self.didFinish else { return }
                switch result {
                case .failure(let err):
                    self.fail("createPDF: \(err.localizedDescription)")
                case .success(let pdfData):
                    if pdfData.isEmpty {
                        self.fail("PDF data is empty")
                        return
                    }
                    if let writeError = FileWriter.write(pdfData, to: self.args.outputPath) {
                        self.fail("write pdf: \(writeError.localizedDescription)")
                        return
                    }
                    os_log("wrote PDF (%d bytes) to %@", log: logger, type: .info,
                           pdfData.count, self.args.outputPath)
                    self.didFinish = true
                    let response = RenderResponse(keepBlocksJson: blocksJson)
                    self.invoke.resolve(response)
                }
            }
        }
    }

    private func fail(_ message: String) {
        if didFinish { return }
        didFinish = true
        os_log("render failed: %@", log: logger, type: .error, message)
        invoke.reject("SCOPED_STORAGE_ERROR:NATIVE_ERROR:\(message)")
    }
}

// MARK: - Plugin

@available(iOS 14.0, *)
class PdfRenderPlugin: Plugin {
    private var session: RenderSession?

    override func load(webview: WKWebView) {
        // No-op: the actual WKWebView is the Tauri-provided one, and
        // is only attached for the lifetime of a single `render` call.
    }

    @objc public func render(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RenderArgs.self)
        os_log("render request: html=%@ output=%@ timeout=%dms",
               log: logger, type: .info,
               args.htmlPath, args.outputPath, args.timeoutMs)

        DispatchQueue.main.async {
            let config = WKWebViewConfiguration()
            let frame = CGRect(x: 0, y: 0, width: 794, height: 1123) // A4 in CSS-px
            let webView = WKWebView(frame: frame, configuration: config)
            let session = RenderSession(webView: webView, args: args, invoke: invoke)
            self.session = session
            session.start()
        }
    }

    /// Copy a file from a local temp path into a `scoped:` destination.
    /// Called by the Rust side after the A4-split step completes,
    /// because `std::fs::write` cannot resolve the scoped scheme.
    @objc public func writeScoped(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WriteScopedArgs.self)
        os_log("writeScoped request: source=%@ dest=%@",
               log: logger, type: .info,
               args.sourcePath, args.scopedOutputPath)

        // Read the source file.
        let sourceUrl = URL(fileURLWithPath: args.sourcePath)
        let data: Data
        do {
            data = try Data(contentsOf: sourceUrl)
        } catch {
            os_log("writeScoped: failed to read source: %@", log: logger, type: .error,
                   error.localizedDescription)
            invoke.reject("writeScoped: failed to read source file: \(error.localizedDescription)")
            return
        }

        // Resolve the scoped destination.
        guard let (destUrl, folderUrl) = ScopedPathResolver.resolve(args.scopedOutputPath) else {
            os_log("writeScoped: failed to resolve scoped path: %@", log: logger, type: .error,
                   args.scopedOutputPath)
            invoke.reject("writeScoped: failed to resolve scoped destination")
            return
        }
        defer { folderUrl.stopAccessingSecurityScopedResource() }

        // Ensure parent directories exist inside the scoped folder.
        let parentDir = destUrl.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(
                at: parentDir,
                withIntermediateDirectories: true,
                attributes: nil
            )
        } catch {
            os_log("writeScoped: failed to create parent dir: %@", log: logger, type: .error,
                   error.localizedDescription)
            invoke.reject("writeScoped: failed to create parent directory: \(error.localizedDescription)")
            return
        }

        // Write the data.
        do {
            try data.write(to: destUrl, options: .atomic)
        } catch {
            os_log("writeScoped: write failed: %@", log: logger, type: .error,
                   error.localizedDescription)
            invoke.reject("writeScoped: write failed: \(error.localizedDescription)")
            return
        }

        os_log("writeScoped: wrote %d bytes to %@", log: logger, type: .info,
               data.count, args.scopedOutputPath)
        invoke.resolve()
    }
}

// MARK: - Plugin entry point

@available(iOS 14.0, *)
@_cdecl("init_plugin_pdf_render")
func initPlugin() -> Plugin {
    os_log("PdfRenderPlugin initialized", log: logger, type: .info)
    return PdfRenderPlugin()
}
