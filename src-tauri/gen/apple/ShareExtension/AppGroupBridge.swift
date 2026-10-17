// src-tauri/ios/ShareExtension/AppGroupBridge.swift
import Foundation

enum AppGroupBridge {
  static let suiteName = "group.com.beavernotes.beaver-notes"

  struct PendingSave: Codable {
    var id: String = UUID().uuidString
    var url: String = ""
    var title: String = ""
    var text: String = ""
    var kind: String = "text"          // url | text | image | file
    var filePaths: [String] = []
    var folderId: String?
    var workspaceId: String?
    var targetNoteId: String?
    var contentMode: String = "full"   // full | link
    var confirmed: Bool = false
    var addedAt: String = ISO8601DateFormatter().string(from: Date())

    // Rust (Task 5, share.rs) derives serde with no rename_all, so its keys
    // are snake_case. Keep these in sync or the host silently drops fields.
    enum CodingKeys: String, CodingKey {
      case id, url, title, text, kind
      case filePaths = "file_paths"
      case folderId = "folder_id"
      case workspaceId = "workspace_id"
      case targetNoteId = "target_note_id"
      case contentMode = "content_mode"
      case confirmed
      case addedAt = "added_at"
    }
  }

  struct Folder: Codable { var id: String; var name: String; var icon: String }
  struct Workspace: Codable { var id: String; var name: String }
  struct Note: Codable {
    var id: String; var title: String; var updatedAt: Int64?
    enum CodingKeys: String, CodingKey {
      case id, title
      case updatedAt = "updated_at"
    }
  }

  static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }

  /// Shared container dir readable by BOTH extension and host app after the
  /// extension terminates. Extension tmp paths are NOT — always copy here.
  static var containerDir: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: suiteName)?
      .appendingPathComponent("shared-inbox", isDirectory: true)
  }

  static func copyIntoContainer(from source: URL) -> String? {
    guard let dir = containerDir else { return nil }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let dst = dir.appendingPathComponent("\(UUID().uuidString)-\(source.lastPathComponent)")
    do {
      try FileManager.default.copyItem(at: source, to: dst)
      return dst.path
    } catch { return nil }
  }

  static func writeDataIntoContainer(_ data: Data, fileName: String) -> String? {
    guard let dir = containerDir else { return nil }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let dst = dir.appendingPathComponent("\(UUID().uuidString)-\(fileName)")
    do { try data.write(to: dst); return dst.path } catch { return nil }
  }

  static func readSaves() -> [PendingSave] { readSavesImpl() }
  static func readSavesImpl() -> [PendingSave] { decodeString([PendingSave].self, "sharePendingSaves") ?? [] }

  static func append(save: PendingSave) {
    var all = readSavesImpl(); all.append(save)
    if let data = try? JSONEncoder().encode(all),
       let str = String(data: data, encoding: .utf8) {
      defaults?.set(str, forKey: "sharePendingSaves")
    }
  }

  static func readFolders() -> [Folder] { decodeString([Folder].self, "shareFolders") ?? [] }
  static func readWorkspaces() -> [Workspace] { decodeString([Workspace].self, "shareWorkspaces") ?? [] }
  static func readNotes() -> [Note] { decodeString([Note].self, "shareNotes") ?? [] }

  // Freshness marker the host writes (ms epoch) whenever it syncs folders or
  // notes. Missing key = host predates T4 or never synced: treat as stale.
  static func readListsUpdatedAt() -> Int64? { decodeString(Int64.self, "shareListsUpdatedAt") }

  static let listsStaleAfterMs: Int64 = 24 * 3600 * 1000

  /// Where-section footer: "Lists updated <relative>" when fresh,
  /// "Lists may be outdated" when older than 24h or never synced.
  static func listsFooter(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> String {
    guard let ms = readListsUpdatedAt(), nowMs - ms <= listsStaleAfterMs else {
      return "Lists may be outdated"
    }
    return "Lists updated \(relativeAge(ms: ms, nowMs: nowMs))"
  }

  /// Short relative age, no deps. Pure — unit-testable without UserDefaults.
  static func relativeAge(ms: Int64, nowMs: Int64) -> String {
    let mins = max(0, nowMs - ms) / 60000
    if mins < 1 { return "just now" }
    if mins < 60 { return "\(mins)m ago" }
    return "\(mins / 60)h ago"
  }

  private static func decodeString<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
    guard let s = defaults?.string(forKey: key),
          let data = s.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
}
