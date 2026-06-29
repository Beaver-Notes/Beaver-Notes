import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit
import os.log

private let logger = OSLog(subsystem: "com.plugin.pdf.render", category: "PdfRender")

private let A4_PT_W: CGFloat = 595
private let A4_PT_H: CGFloat = 842
private let PAGE_MARGIN_PT: CGFloat = 48

class RenderArgs: Decodable {
    let htmlPath: String
    let outputPath: String
    let timeoutMs: UInt64
}

class WriteScopedArgs: Decodable {
    let sourcePath: String
    let scopedOutputPath: String
}

// MARK: - Scoped-storage resolution

@available(iOS 14.0, *)
private enum ScopedPathResolver {
    private static let bookmarkPrefix = "scoped_storage.bookmark."

    static func parse(_ path: String) -> (folderId: String, relativePath: String)? {
        guard path.hasPrefix("scoped:") else { return nil }
        let remainder = String(path.dropFirst("scoped:".count))
        guard let slashIdx = remainder.firstIndex(of: "/") else { return nil }
        let folderId = String(remainder[..<slashIdx])
        let relative = String(remainder[remainder.index(after: slashIdx)...])
        guard !folderId.isEmpty, !relative.isEmpty else { return nil }
        return (folderId, relative)
    }

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

    static func resolve(_ scopedPath: String) -> (destUrl: URL, folderUrl: URL)? {
        guard let (folderId, relativePath) = parse(scopedPath) else { return nil }
        guard let folderUrl = resolveFolder(folderId) else { return nil }
        guard folderUrl.startAccessingSecurityScopedResource() else { return nil }
        let destUrl = folderUrl.appendingPathComponent(relativePath)
        return (destUrl, folderUrl)
    }
}

// MARK: - File writing

@available(iOS 14.0, *)
private enum FileWriter {
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

// MARK: - Render session

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
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(300)) { [weak self] in
            self?.capturePDF()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("navigation failed: \(error.localizedDescription)")
    }

    private func capturePDF() {
        let formatter = webView.viewPrintFormatter()
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(formatter, startingAtPageAt: 0)

        let paperRect = CGRect(x: 0, y: 0, width: A4_PT_W, height: A4_PT_H)
        let printableRect = paperRect.insetBy(dx: PAGE_MARGIN_PT, dy: PAGE_MARGIN_PT)
        renderer.setValue(NSValue(cgRect: paperRect), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: printableRect), forKey: "printableRect")

        let pdfData = NSMutableData()
        UIGraphicsBeginPDFContextToData(pdfData, paperRect, nil)

        let totalPages = renderer.numberOfPages
        guard totalPages > 0 else {
            UIGraphicsEndPDFContext()
            fail("print renderer produced zero pages")
            return
        }

        for page in 0..<totalPages {
            UIGraphicsBeginPDFPageWithInfo(paperRect, nil)
            renderer.drawPage(at: page, in: paperRect)
        }
        UIGraphicsEndPDFContext()

        guard (pdfData as Data).count > 0 else {
            fail("PDF data is empty")
            return
        }

        if let writeError = FileWriter.write(pdfData as Data, to: args.outputPath) {
            fail("write pdf: \(writeError.localizedDescription)")
            return
        }

        os_log("wrote PDF (%d bytes, %d pages) to %@",
               log: logger, type: .info, (pdfData as Data).count, totalPages, args.outputPath)
        didFinish = true
        invoke.resolve()
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

    override func load(webview: WKWebView) {}

    @objc public func render(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RenderArgs.self)
        os_log("render request: html=%@ output=%@ timeout=%dms",
               log: logger, type: .info,
               args.htmlPath, args.outputPath, args.timeoutMs)

        DispatchQueue.main.async {
            let config = WKWebViewConfiguration()
            let frame = CGRect(x: 0, y: 0, width: 794, height: 1123)
            let webView = WKWebView(frame: frame, configuration: config)
            let session = RenderSession(webView: webView, args: args, invoke: invoke)
            self.session = session
            session.start()
        }
    }

    @objc public func writeScoped(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WriteScopedArgs.self)
        os_log("writeScoped request: source=%@ dest=%@",
               log: logger, type: .info,
               args.sourcePath, args.scopedOutputPath)

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

        guard let (destUrl, folderUrl) = ScopedPathResolver.resolve(args.scopedOutputPath) else {
            os_log("writeScoped: failed to resolve scoped path: %@", log: logger, type: .error,
                   args.scopedOutputPath)
            invoke.reject("writeScoped: failed to resolve scoped destination")
            return
        }
        defer { folderUrl.stopAccessingSecurityScopedResource() }

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
