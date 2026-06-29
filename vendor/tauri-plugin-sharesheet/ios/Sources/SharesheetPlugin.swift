import Foundation
import Tauri
import UIKit
import WebKit

struct ShareTextOptions: Decodable {
    let text: String
    let mimeType: String?
}

struct ShareFileOptions: Decodable {
    let path: String
    let mimeType: String?
}

class SharesheetPlugin: Plugin {
    var webview: WKWebView!

    public override func load(webview: WKWebView) {
        self.webview = webview
    }

    @objc func shareText(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ShareTextOptions.self)

        DispatchQueue.main.async {
            let activityViewController = UIActivityViewController(
                activityItems: [args.text],
                applicationActivities: nil
            )
            self.present(activityViewController)
        }
    }

    @objc func shareFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ShareFileOptions.self)
        let fileURL = URL(fileURLWithPath: args.path)

        DispatchQueue.main.async {
            let activityViewController = UIActivityViewController(
                activityItems: [fileURL],
                applicationActivities: nil
            )
            self.present(activityViewController)
        }
    }

    private func present(_ controller: UIActivityViewController) {
        controller.popoverPresentationController?.sourceView = self.webview
        controller.popoverPresentationController?.sourceRect = CGRect(
            x: self.webview.bounds.midX,
            y: self.webview.bounds.midY,
            width: 0,
            height: 0
        )
        self.manager.viewController?.present(controller, animated: true, completion: nil)
    }
}

@_cdecl("init_plugin_sharesheet")
func initPlugin() -> Plugin {
    return SharesheetPlugin()
}
