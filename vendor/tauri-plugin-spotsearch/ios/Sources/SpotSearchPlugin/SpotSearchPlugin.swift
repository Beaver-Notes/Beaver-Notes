import SwiftRs
import Tauri
import Foundation
import CoreSpotlight
import os.log

private let logger = OSLog(subsystem: "com.beavernotes.beaver-notes", category: "SpotSearch")

class EnableIndexingArgs: Decodable {
    let enabled: Bool
}

class SpotItemArgs: Decodable {
    let id: String
    let domain: String
    let title: String
    let snippet: String?
    let keywords: [String]?
    let url: String?
    let thumbnailBase64: String?
    let extra: [String: String]?
}

class IndexItemsArgs: Decodable {
    let items: [SpotItemArgs]
}

class DeleteItemsArgs: Decodable {
    let ids: [String]
}

class DeleteDomainArgs: Decodable {
    let domain: String
}

class SpotSearchPlugin: Plugin {

    @objc public func enableIndexing(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(EnableIndexingArgs.self)
        NSLog("SpotSearch: enableIndexing called enabled=%@", args.enabled ? "YES" : "NO")
        invoke.resolve()
    }

    @objc public func indexItems(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(IndexItemsArgs.self)
        os_log("indexItems called with %d items", log: logger, type: .info, args.items.count)

        guard #available(iOS 14.0, *) else {
            invoke.reject("Spotlight indexing requires iOS 14 or newer")
            return
        }

        var searchable: [CSSearchableItem] = []

        for item in args.items {
            os_log("  indexing: id=%@ title=%@ domain=%@", log: logger, type: .debug, item.id, item.title, item.domain)

            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = item.title
            attrs.contentDescription = item.snippet
            attrs.keywords = item.keywords
            if let urlStr = item.url {
                attrs.contentURL = URL(string: urlStr)
            }
            if let thumb = item.thumbnailBase64,
               let data = Data(base64Encoded: thumb) {
                attrs.thumbnailData = data
            }

            let searchableItem = CSSearchableItem(
                uniqueIdentifier: item.id,
                domainIdentifier: item.domain,
                attributeSet: attrs
            )
            searchable.append(searchableItem)
        }

        CSSearchableIndex.default().indexSearchableItems(searchable) { error in
            if let e = error {
                os_log("indexItems failed: %@", log: logger, type: .error, e.localizedDescription)
                invoke.reject(e.localizedDescription)
            } else {
                os_log("indexItems succeeded (%d items)", log: logger, type: .info, args.items.count)
                invoke.resolve()
            }
        }
    }

    @objc public func deleteItems(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(DeleteItemsArgs.self)
        os_log("deleteItems called with %d ids", log: logger, type: .info, args.ids.count)

        CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: args.ids) { error in
            if let e = error {
                os_log("deleteItems failed: %@", log: logger, type: .error, e.localizedDescription)
                invoke.reject(e.localizedDescription)
            } else {
                os_log("deleteItems succeeded (%d ids)", log: logger, type: .info, args.ids.count)
                invoke.resolve()
            }
        }
    }

    @objc public func deleteDomain(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(DeleteDomainArgs.self)
        os_log("deleteDomain called: %@", log: logger, type: .info, args.domain)

        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [args.domain]) { error in
            if let e = error {
                os_log("deleteDomain failed: %@", log: logger, type: .error, e.localizedDescription)
                invoke.reject(e.localizedDescription)
            } else {
                os_log("deleteDomain succeeded: %@", log: logger, type: .info, args.domain)
                invoke.resolve()
            }
        }
    }
}

@_cdecl("init_plugin_spotsearch")
func initPlugin() -> Plugin {
    os_log("SpotSearchPlugin initialized", log: logger, type: .info)
    return SpotSearchPlugin()
}
