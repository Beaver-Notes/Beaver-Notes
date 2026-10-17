// src-tauri/ios/ShareExtension/ShareViewController.swift
import PDFKit
import UIKit
import UniformTypeIdentifiers

@objc(SharePrincipalController)
final class SharePrincipalController: UINavigationController {
  override func viewDidLoad() {
    super.viewDidLoad()
    viewControllers = [ShareViewController()]
    setToolbarHidden(false, animated: false)
    // The sheet defaults to a short detent; take the full height so the
    // preview actually fills the modal top to bottom (iOS 15+ only).
    if #available(iOS 15.0, *) {
      sheetPresentationController?.detents = [.large()]
    }
  }
}

final class ShareViewController: UIViewController {
  private var saves: [AppGroupBridge.PendingSave] = []
  private var folders: [AppGroupBridge.Folder] = []
  private var workspaces: [AppGroupBridge.Workspace] = []
  private var notes: [AppGroupBridge.Note] = []
  private var selectedFolderId: String?
  private var selectedWorkspaceId: String?
  // Last-used folder for the smart default (smart-defaults T3). Extension-side
  // store only — the host keeps its own copy in localStorage (see share.ts).
  private let lastFolderKey = "beaver.lastFolderId"
  private var selectedNoteId: String?
  private var contentMode: String = "full"   // full | link
  private var customTitle: String?
  private var didComplete = false
  private var isSaving = false
  private var isPreviewLoading = true
  private var previewText: String = ""
  private var previewTitle: String = ""
  private var previewAuthor: String? // oEmbed author captured during ingest; preview never refetches
  private var previewVideoId: String?
  private var previewImage: UIImage?
  private var previewIsIcon = false
  private var previewURLString: String = ""
  private var saveItem: UIBarButtonItem?
  private var optionsButton: UIButton?
  private var workspaceButton: UIButton?
  private var pendingEmptyAlert = false

  private let scrollView = UIScrollView()
  private let stack = UIStackView()
  private let loadingSpinner = UIActivityIndicatorView(style: .large)
  private let thumbView = UIImageView()
  private let titleLabel = UILabel()
  private let authorLabel = UILabel()
  private let bodyView = UITextView()
  private let urlLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    folders = AppGroupBridge.readFolders()
    workspaces = AppGroupBridge.readWorkspaces()
    notes = AppGroupBridge.readNotes()
    if let last = UserDefaults.standard.string(forKey: lastFolderKey),
       folders.contains(where: { $0.id == last }) {
      selectedFolderId = last
    }
    view.backgroundColor = .systemBackground
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
    setupNav()
    setupPreview()
    updateNav()
    renderPreview()
    Task { await ingest() }
  }

  // MARK: nav — native items only, so Liquid Glass / dark mode / Dynamic Type come free.

  private func setupNav() {
    let save = UIBarButtonItem(title: "Save", style: .done, target: self, action: #selector(save))
    saveItem = save
    let options = UIButton(type: .system)
    options.showsMenuAsPrimaryAction = true
    optionsButton = options
    navigationItem.rightBarButtonItems = [save, UIBarButtonItem(customView: options)]
    let workspace = UIButton(type: .system)
    workspace.showsMenuAsPrimaryAction = true
    workspaceButton = workspace
    setToolbarItems([
      UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
      UIBarButtonItem(customView: workspace),
      UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
    ], animated: false)
  }

  private var selectedFolderName: String {
    guard let id = selectedFolderId else { return "No folder" }
    return folders.first(where: { $0.id == id })?.name ?? "No folder"
  }

  private func updateNav() {
    guard let options = optionsButton, let save = saveItem, let workspace = workspaceButton else { return }
    if #available(iOS 15.0, *) {
      var config = UIButton.Configuration.plain()
      config.image = UIImage(systemName: "folder")
      config.title = selectedFolderName
      // ponytail: plain config tracks Liquid Glass automatically; no custom background.
      options.configuration = config
    } else {
      options.setImage(UIImage(systemName: "folder"), for: .normal)
      options.setTitle(selectedFolderName, for: .normal)
    }
    options.menu = makeOptionsMenu()
    save.isEnabled = !isSaving && !saves.isEmpty
    options.isEnabled = !isSaving
    if #available(iOS 15.0, *) {
      var wsConfig = UIButton.Configuration.plain()
      wsConfig.image = UIImage(systemName: "square.grid.2x2")
      wsConfig.title = selectedWorkspaceName
      workspace.configuration = wsConfig
    } else {
      workspace.setImage(UIImage(systemName: "square.grid.2x2"), for: .normal)
      workspace.setTitle(selectedWorkspaceName, for: .normal)
    }
    workspace.menu = makeWorkspaceMenu()
    workspace.isEnabled = !isSaving
  }

  private var selectedWorkspaceName: String {
    guard let id = selectedWorkspaceId else { return "Workspace" }
    return workspaces.first(where: { $0.id == id })?.name ?? "Workspace"
  }

  private func makeWorkspaceMenu() -> UIMenu {
    let current = UIAction(title: "Current workspace", state: selectedWorkspaceId == nil ? .on : .off) { [weak self] _ in
      self?.selectedWorkspaceId = nil
      self?.updateNav()
    }
    let items = workspaces.map { ws in
      UIAction(title: ws.name, state: ws.id == self.selectedWorkspaceId ? .on : .off) { [weak self] _ in
        self?.selectedWorkspaceId = ws.id
        self?.updateNav()
      }
    }
    return UIMenu(title: "Workspace", children: [current] + items)
  }

  private func makeOptionsMenu() -> UIMenu {
    let foldersMenu = UIMenu(
      title: "Folder",
      options: [],
      children: [UIAction(title: "No folder", state: selectedFolderId == nil ? .on : .off) { [weak self] _ in
        self?.selectedFolderId = nil
        self?.updateNav()
      }] + folders.map { folder in
        UIAction(title: folder.name, state: folder.id == self.selectedFolderId ? .on : .off) { [weak self] _ in
          self?.selectedFolderId = folder.id
          self?.updateNav()
        }
      })

    // ponytail: no filter field — menu lists recent 30, same cap the old picker used.
    let appendMenu = UIMenu(
      title: "Append to",
      options: [],
      children: [UIAction(title: "New Note", state: selectedNoteId == nil ? .on : .off) { [weak self] _ in
        self?.selectedNoteId = nil
        self?.updateNav()
      }] + Array(notes.prefix(30)).map { note in
        let label = note.title.isEmpty ? "(Untitled)" : note.title
        return UIAction(title: label, state: note.id == self.selectedNoteId ? .on : .off) { [weak self] _ in
          self?.selectedNoteId = note.id
          self?.updateNav()
        }
      })

    let contentMenu = UIMenu(
      title: "Content",
      options: [],
      children: [
        UIAction(title: "Full Text", state: contentMode == "link" ? .off : .on) { [weak self] _ in
          self?.contentMode = "full"
          UIImpactFeedbackGenerator(style: .light).impactOccurred()
          self?.updateNav()
        },
        UIAction(title: "Link Only", state: contentMode == "link" ? .on : .off) { [weak self] _ in
          self?.contentMode = "link"
          UIImpactFeedbackGenerator(style: .light).impactOccurred()
          self?.updateNav()
        },
      ])

    let rename = UIAction(title: "Rename", image: UIImage(systemName: "pencil")) { [weak self] _ in
      self?.promptRename()
    }
    return UIMenu(title: "", children: [foldersMenu, appendMenu, contentMenu, rename])
  }

  private func promptRename() {
    let alert = UIAlertController(title: "Rename", message: nil, preferredStyle: .alert)
    alert.addTextField { [weak self] field in
      field.text = self?.customTitle ?? self?.saves.first?.title ?? ""
      field.clearButtonMode = .whileEditing
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Done", style: .default) { [weak self] _ in
      self?.customTitle = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines)
      self?.renderPreview()
    })
    present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
  }

  // MARK: preview — the whole sheet content.

  private func setupPreview() {
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrollView)
    NSLayoutConstraint.activate([
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      // Safe area, not the raw view edges: below the nav bar, above the
      // toolbar (the nav controller folds both into the insets for us).
      scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    scrollView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -20),
      stack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -40),
    ])
    loadingSpinner.hidesWhenStopped = true
    loadingSpinner.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(loadingSpinner)
    NSLayoutConstraint.activate([
      loadingSpinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      loadingSpinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    thumbView.contentMode = .scaleAspectFill
    thumbView.clipsToBounds = true
    thumbView.layer.cornerRadius = 12
    thumbView.backgroundColor = .secondarySystemBackground
    thumbView.translatesAutoresizingMaskIntoConstraints = false
    thumbView.heightAnchor.constraint(equalToConstant: 200).isActive = true
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.numberOfLines = 0
    authorLabel.font = .preferredFont(forTextStyle: .subheadline)
    authorLabel.textColor = .secondaryLabel
    authorLabel.numberOfLines = 0
    bodyView.isEditable = false
    bodyView.isScrollEnabled = false
    bodyView.font = .preferredFont(forTextStyle: .body)
    bodyView.textColor = .secondaryLabel
    bodyView.backgroundColor = .clear
    bodyView.textContainerInset = .zero
    bodyView.textContainer.lineFragmentPadding = 0
    urlLabel.font = .preferredFont(forTextStyle: .footnote)
    urlLabel.textColor = .secondaryLabel
    urlLabel.numberOfLines = 0
  }

  private func renderPreview() {
    if isPreviewLoading {
      loadingSpinner.startAnimating()
      stack.isHidden = true
      return
    }
    loadingSpinner.stopAnimating()
    stack.isHidden = false
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    if previewVideoId != nil || previewImage != nil {
      thumbView.image = previewImage
      // Photos fill the hero; the doc glyph sits centered on the placeholder.
      thumbView.contentMode = previewIsIcon ? .center : .scaleAspectFill
      thumbView.tintColor = previewIsIcon ? .secondaryLabel : nil
      stack.addArrangedSubview(thumbView)
    }
    let effectiveTitle = (customTitle?.isEmpty == false ? customTitle! : previewTitle)
    let titleText = effectiveTitle.isEmpty ? previewURLString : effectiveTitle
    if !titleText.isEmpty {
      titleLabel.text = titleText
      stack.addArrangedSubview(titleLabel)
    }
    let author = previewVideoId != nil ? (previewAuthor ?? "") : ""
    if !author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      authorLabel.text = author
      stack.addArrangedSubview(authorLabel)
    }
    if !previewText.isEmpty {
      bodyView.text = previewText
      stack.addArrangedSubview(bodyView)
    } else if !previewURLString.isEmpty && previewURLString != titleText {
      urlLabel.text = previewURLString
      stack.addArrangedSubview(urlLabel)
    }
  }

  private func showEmptyAlertThenCancel() {
    // Presenting before the view is in a window drops the alert and strands
    // the extension (cancel only fires from OK), so defer to viewDidAppear.
    guard view.window != nil else { pendingEmptyAlert = true; return }
    let alert = UIAlertController(
      title: "Nothing to share",
      message: "There was nothing to share.",
      preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.cancel() })
    present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if pendingEmptyAlert {
      pendingEmptyAlert = false
      showEmptyAlertThenCancel()
    }
  }

  private func ingest() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
      return cancel()
    }
    for item in items {
      var save = AppGroupBridge.PendingSave()
      let pageTitle = item.attributedTitle?.string ?? item.attributedContentText?.string ?? ""
      for provider in (item.attachments ?? []) {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = try? await loadUrl(provider), isHttp(url) {
          save.kind = "url"; save.url = url.absoluteString
          save.title = pageTitle
          if save.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // Best-effort enrichment; never throws into the save path (falls back to empty title).
            // Single oEmbed fetch captures title+author; the preview reuses both without refetching.
            if Self.isYouTubeHost(url.host) {
              let info = await Self.oembedInfo(for: url)
              save.title = info.title ?? pageTitle
              if previewAuthor == nil { previewAuthor = info.author }
            } else {
              save.title = await Self.enrichedTitle(for: url) ?? pageTitle
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                  let text = try? await loadText(provider), !text.isEmpty {
          // Stash accompanying text even when a URL was already seen: the
          // host prepends it above the extraction (text+URL shares).
          if save.text.isEmpty { save.text = text }
          if save.kind != "url" {
            save.kind = "text"
            if let u = Self.firstHttpUrl(in: text) { save.kind = "url"; save.url = u }
            if save.title.isEmpty { save.title = String(text.prefix(80)) }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
          if let data = try? await loadData(provider),
             let path = AppGroupBridge.writeDataIntoContainer(
               data, fileName: provider.suggestedName.map { "\($0).png" } ?? "image.png") {
            save.kind = "image"; save.filePaths.append(path)
            if save.title.isEmpty { save.title = pageTitle.isEmpty ? "Image" : pageTitle }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
          // Keep-as-file: accept every file type (pdf/zip/office/…). The host
          // embeds unknown extensions as fileEmbed data: URLs, so nothing is
          // dropped here. Ceiling: whole-file in-memory base64, same as images.
          if let item = try? await loadItem(provider),
             let path = AppGroupBridge.copyIntoContainer(from: item) {
            save.kind = "file"; save.filePaths.append(path)
            save.title = item.lastPathComponent
          }
        }
      }
      if save.kind != "text" || !save.text.isEmpty || !save.filePaths.isEmpty {
        saves.append(save)
      }
    }
    guard !saves.isEmpty else {
      await MainActor.run {
        self.isPreviewLoading = false
        self.renderPreview()
        self.updateNav()
        self.showEmptyAlertThenCancel()
      }
      return
    }
    await MainActor.run {
      self.customTitle = self.saves.first?.title
      self.updateNav()
      self.renderPreview()
    }
    Task { await self.loadPreview() }
  }

  // MARK: actions

  @objc private func cancel() {
    finish {
      self.extensionContext?.cancelRequest(withError: NSError(domain: "ShareExt", code: NSUserCancelledError))
    }
  }

  @objc private func save() {
    guard !isSaving else { return }
    isSaving = true
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    saveItem?.isEnabled = false
    optionsButton?.isEnabled = false
    workspaceButton?.isEnabled = false
    let name = (customTitle ?? saves.first?.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    for i in saves.indices {
      if !name.isEmpty { saves[i].title = name }
      saves[i].folderId = selectedFolderId
      saves[i].workspaceId = selectedWorkspaceId
      saves[i].targetNoteId = selectedNoteId
      saves[i].contentMode = contentMode
      saves[i].confirmed = true
      AppGroupBridge.append(save: saves[i])
    }
    if let fid = selectedFolderId {
      UserDefaults.standard.set(fid, forKey: lastFolderKey)
    } else {
      UserDefaults.standard.removeObject(forKey: lastFolderKey)
    }
    // Best-effort launch of the host app: responder-chain trick first, extensionContext as fallback.
    // Delayed completeRequest gives the OS a beat to deliver the URL before extension teardown.
    guard let url = URL(string: "beaver-notes://share") else {
      finish { self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
      return
    }
    let r1 = openViaResponderChain(url)
    var r2 = false
    if !r1 {
      // Note: extensionContext.open is documented Today-widget-only; kept as fallback only.
      self.extensionContext?.open(url, completionHandler: nil)
      r2 = self.extensionContext != nil
    }
    NSLog("ShareExt: open host via responder-chain -> \(r1), via extensionContext -> \(r2)")
    if r1 || r2 {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
        self.finish { self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
      }
    } else {
      finish { self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
    }
  }

  private func finish(_ block: @escaping () -> Void) {
    guard !didComplete else { return }; didComplete = true
    DispatchQueue.main.async(execute: block)
  }

  // MARK: attachment loaders

  // iOS 14 target: async NSItemProvider overloads need iOS 16+, so wrap the
  // callback APIs in continuations instead.
  private func loadItemCoding(_ p: NSItemProvider, _ id: String) async throws -> NSSecureCoding? {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<NSSecureCoding?, Error>) in
      p.loadItem(forTypeIdentifier: id, options: nil) { item, error in
        if let e = error { cont.resume(throwing: e); return }
        cont.resume(returning: item)
      }
    }
  }
  private func loadUrl(_ p: NSItemProvider) async throws -> URL? {
    let item = try await loadItemCoding(p, UTType.url.identifier)
    if let url = item as? URL { return url }
    if let s = item as? String { return URL(string: s) }
    return nil
  }
  private func loadText(_ p: NSItemProvider) async throws -> String? {
    let item = try await loadItemCoding(p, UTType.plainText.identifier)
    if let s = item as? String { return s }
    if let d = item as? Data { return String(data: d, encoding: .utf8) }
    return nil
  }
  private func loadData(_ p: NSItemProvider) async throws -> Data {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
      _ = p.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, error in
        if let e = error { cont.resume(throwing: e); return }
        guard let data = data else {
          cont.resume(throwing: NSError(domain: "ShareExt", code: 2)); return
        }
        cont.resume(returning: data)
      }
    }
  }
  private func loadItem(_ p: NSItemProvider) async throws -> URL {
    let item = try await loadItemCoding(p, UTType.data.identifier)
    if let url = item as? URL { return url }
    throw NSError(domain: "ShareExt", code: 1)
  }

  private func isHttp(_ url: URL) -> Bool {
    ["http", "https"].contains(url.scheme?.lowercased() ?? "")
  }
  static func firstHttpUrl(in text: String) -> String? {
    text.split(whereSeparator: { $0.isWhitespace })
      .first(where: { $0.hasPrefix("http://") || $0.hasPrefix("https://") })
      .map(String.init)
  }
  // MARK: title enrichment (best-effort; nil falls back to today's behavior)

  static func enrichedTitle(for url: URL) async -> String? {
    if isYouTubeHost(url.host), let title = await oembedTitle(for: url) { return title }
    return await htmlTitle(for: url)
  }

  static func isYouTubeHost(_ host: String?) -> Bool {
    guard let h = host?.lowercased() else { return false }
    return h == "youtube.com" || h.hasSuffix(".youtube.com")
      || h == "youtu.be" || h.hasSuffix(".youtu.be")
      || h == "youtube-nocookie.com" || h.hasSuffix(".youtube-nocookie.com")
  }

  static func oembedInfo(for url: URL) async -> (title: String?, author: String?) {
    var parts = URLComponents(string: "https://www.youtube.com/oembed")
    parts?.queryItems = [
      URLQueryItem(name: "url", value: url.absoluteString),
      URLQueryItem(name: "format", value: "json"),
    ]
    guard let endpoint = parts?.url,
          let data = try? await fetchData(from: endpoint),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return (nil, nil) }
    let raw = ((obj["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let authorRaw = ((obj["author_name"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return (raw.isEmpty ? nil : raw, authorRaw.isEmpty ? nil : authorRaw)
  }

  static func oembedTitle(for url: URL) async -> String? {
    await oembedInfo(for: url).title
  }

  static func htmlTitle(for url: URL) async -> String? {
    guard let data = try? await fetchData(from: url) else { return nil }
    let prefix = data.prefix(262144)
    guard let html = String(data: prefix, encoding: .utf8)
        ?? String(data: prefix, encoding: .isoLatin1) else { return nil }
    guard let open = html.range(of: "<title", options: .caseInsensitive),
          let openEnd = html.range(of: ">", range: open.upperBound..<html.endIndex),
          let close = html.range(of: "</title>", options: .caseInsensitive,
                                 range: openEnd.upperBound..<html.endIndex) else { return nil }
    let title = decodeShareEntities(String(html[openEnd.upperBound..<close.lowerBound]))
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return title.isEmpty ? nil : title
  }

  static func decodeShareEntities(_ s: String) -> String {
    s.replacingOccurrences(of: "&amp;", with: "&")
      .replacingOccurrences(of: "&lt;", with: "<")
      .replacingOccurrences(of: "&gt;", with: ">")
      .replacingOccurrences(of: "&quot;", with: "\"")
      .replacingOccurrences(of: "&#39;", with: "'")
  }

  static func fetchData(from url: URL) async throws -> Data {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 4
    config.timeoutIntervalForResource = 6
    let session = URLSession(configuration: config)
    return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
      let task = session.dataTask(with: url) { data, _, error in
        if let e = error { cont.resume(throwing: e); return }
        guard let data = data else {
          cont.resume(throwing: NSError(domain: "ShareExt", code: 3)); return
        }
        cont.resume(returning: data)
      }
      task.resume()
    }
  }

  // MARK: content preview (best-effort; never blocks Save)

  private func loadPreview() async {
    guard let save = saves.first else { return }
    var title = ""
    var body: String?
    var videoId: String?
    var image: UIImage?
    var isIcon = false
    switch save.kind {
    case "url":
      title = save.title
      if let url = URL(string: save.url) {
        previewURLString = save.url
        if Self.isYouTubeHost(url.host) {
          videoId = Self.youtubeVideoId(from: url)
          // Title/author come from oEmbed during ingest; body falls back to
          // the page meta description like any article (no transcript fetch).
          body = await Self.metaDescriptionPreview(for: url)
        } else if let html = await Self.htmlPrefix(for: url) {
          // Real article text when the page has substance, meta-description
          // summary otherwise. No hero image: preview shows only what the
          // note keeps (og:image never makes it into the saved note).
          let text = Self.paragraphText(in: html)
          body = (text ?? "").count > 120 ? text : Self.metaDescription(in: html)
        }
      } else {
        previewURLString = save.url
        body = nil
      }
      if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { title = save.url }
    case "text":
      body = save.text.isEmpty ? save.title : save.text
    case "image", "file":
      // Files land in the App Group container during ingest, so the sheet
      // shows content, not just names: photo / text excerpt / PDF page 1.
      let lines = save.filePaths.map { path -> String in
        let name = (path as NSString).lastPathComponent
        if save.kind == "file", let size = Self.fileSize(at: path) {
          return "\(name) · \(size)"
        }
        return name
      }
      body = lines.isEmpty ? save.title : lines.joined(separator: "\n")
      if save.kind == "image", let first = save.filePaths.first,
         (Self.fileBytes(at: first) ?? .max) < 25_000_000,
         let img = UIImage(contentsOfFile: first) {
        image = img
      } else if save.kind == "file", save.filePaths.count == 1, let first = save.filePaths.first {
        if Self.isPDFFile(first),
           let doc = PDFDocument(url: URL(fileURLWithPath: first)),
           let page = doc.page(at: 0) {
          image = page.thumbnail(of: CGSize(width: 1024, height: 1024), for: .mediaBox)
          if let text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines),
             !text.isEmpty {
            body = String(text.prefix(3000))
          } else {
            body = doc.pageCount == 1 ? "1 page" : "\(doc.pageCount) pages"
          }
        } else if let excerpt = Self.textExcerpt(ofFile: first) {
          body = excerpt
        } else {
          isIcon = true
          image = UIImage(systemName: "doc.fill")
        }
      } else if save.kind == "file" {
        isIcon = true
        image = UIImage(systemName: "doc.fill")
      }
    default:
      body = save.title
    }
    let capped = String((body ?? "").prefix(3000))
    await MainActor.run {
      self.previewTitle = title
      self.previewText = capped
      self.previewVideoId = videoId
      self.previewImage = image
      self.previewIsIcon = isIcon
      self.isPreviewLoading = false
      self.renderPreview()
    }
    // YouTube thumbnail loads async after the text; popping in late is fine.
    // It stays because the note keeps the matching Video node.
    if let vid = videoId,
       let thumbURL = URL(string: "https://i.ytimg.com/vi/\(vid)/hqdefault.jpg"),
       let data = try? await Self.fetchData(from: thumbURL),
       let img = UIImage(data: data) {
      await MainActor.run {
        guard self.previewVideoId == vid else { return }
        self.previewImage = img
        self.renderPreview()
      }
    }
  }

  static func youtubeVideoId(from url: URL) -> String? {
    let absolute = url.absoluteString
    guard let schemeRange = absolute.range(of: "://") else { return nil }
    let afterScheme = String(absolute[schemeRange.upperBound...])
    let hostEnd = afterScheme.firstIndex(where: { "/?#".contains($0) }) ?? afterScheme.endIndex
    let host = String(afterScheme[..<hostEnd]).lowercased()
    let rest = String(afterScheme[hostEnd...])
    if host == "youtu.be" || host.hasSuffix(".youtu.be") {
      let path = rest.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
      let id = path.split(separator: "/").first.map(String.init) ?? ""
      return id.isEmpty ? nil : id
    }
    if host.contains("youtube") {
      for marker in ["/shorts/", "/embed/", "/live/"] {
        if let r = rest.range(of: marker) {
          let tail = String(rest[r.upperBound...])
          let end = tail.firstIndex(where: { "/?#&".contains($0) }) ?? tail.endIndex
          let id = String(tail[..<end]).trimmingCharacters(in: .whitespaces)
          if !id.isEmpty { return id }
        }
      }
      if let qpos = absolute.firstIndex(of: "?") {
        let query = String(absolute[absolute.index(after: qpos)...]).split(separator: "#").first.map(String.init) ?? ""
        for pair in query.split(separator: "&") {
          if pair.hasPrefix("v=") {
            let id = String(pair.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            if !id.isEmpty { return id }
          }
        }
      }
      return nil
    }
    return nil
  }

  static func xmlAttr(_ tag: String, _ name: String) -> String? {
    let needle = name + "=\""
    guard let pos = tag.range(of: needle) else { return nil }
    let start = pos.upperBound
    guard let end = tag.range(of: "\"", range: start..<tag.endIndex) else { return nil }
    return String(tag[start..<end.lowerBound])
  }

  static func singleQuotedAttr(_ tag: String, _ name: String) -> String? {
    let needle = name + "='"
    guard let pos = tag.range(of: needle, options: .caseInsensitive) else { return nil }
    let start = pos.upperBound
    guard let end = tag.range(of: "'", range: start..<tag.endIndex) else { return nil }
    return String(tag[start..<end.lowerBound])
  }

  static func metaDescriptionPreview(for url: URL) async -> String? {
    guard let html = await htmlPrefix(for: url) else { return nil }
    guard let desc = metaDescription(in: html), !desc.isEmpty else { return nil }
    return String(desc.prefix(3000))
  }

  // Single page fetch shared by the preview extractors (meta description,
  // paragraph text, og:image) so one article costs one request, not three.
  static func htmlPrefix(for url: URL) async -> String? {
    guard let data = try? await fetchData(from: url) else { return nil }
    let prefix = data.prefix(262144)
    return String(data: prefix, encoding: .utf8)
      ?? String(data: prefix, encoding: .isoLatin1)
  }

  // Best-effort article body: <p> text with scripts/styles/nav-stubs
  // stripped. No readability scoring — length filter only (>40 chars skips
  // crumbs and button labels). Never throws into the preview path.
  static func paragraphText(in html: String) -> String? {
    var text = html
    for tag in ["script", "style", "noscript"] {
      while let open = text.range(of: "<\(tag)", options: .caseInsensitive),
            let openEnd = text.range(of: ">", range: open.upperBound..<text.endIndex),
            let close = text.range(of: "</\(tag)>", options: .caseInsensitive,
                                   range: openEnd.upperBound..<text.endIndex) {
        text.removeSubrange(open.lowerBound..<close.upperBound)
      }
    }
    var parts: [String] = []
    var rest = text[...]
    while let open = rest.range(of: "<p", options: .caseInsensitive),
          let openEnd = rest.range(of: ">", range: open.upperBound..<rest.endIndex),
          let close = rest.range(of: "</p>", options: .caseInsensitive,
                                 range: openEnd.upperBound..<rest.endIndex) {
      var inner = String(rest[openEnd.upperBound..<close.lowerBound])
      while let t0 = inner.range(of: "<"),
            let t1 = inner.range(of: ">", range: t0.upperBound..<inner.endIndex) {
        inner.removeSubrange(t0.lowerBound..<t1.upperBound)
      }
      let clean = decodeShareEntities(inner)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if clean.count > 40 { parts.append(clean) }
      rest = rest[close.upperBound...]
      if parts.joined(separator: "\n\n").count > 3000 { break }
    }
    guard !parts.isEmpty else { return nil }
    return String(parts.joined(separator: "\n\n").prefix(3000))
  }

  // System-declared types, not an extension list: anything the OS calls PDF.
  static func isPDFFile(_ path: String) -> Bool {
    guard let type = UTType(filenameExtension: (path as NSString).pathExtension) else { return false }
    return type.conforms(to: .pdf)
  }

  // Content-sniffed text excerpt, extension-agnostic: under 1MB, valid
  // UTF-8, no NUL bytes. Covers md/log/extensionless files the system has
  // no declared type for. HTML excluded — markup is not a readable
  // excerpt (the URL pipeline owns .html rendering).
  static func textExcerpt(ofFile path: String) -> String? {
    if let type = UTType(filenameExtension: (path as NSString).pathExtension),
       type.conforms(to: .html) { return nil }
    guard (fileBytes(at: path) ?? .max) < 1_000_000,
          let data = try? Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe),
          !data.contains(0),
          let text = String(data: data, encoding: .utf8) else { return nil }
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else { return nil }
    return String(clean.prefix(3000))
  }

  static func fileBytes(at path: String) -> UInt64? {    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let size = attrs[.size] as? NSNumber else { return nil }
    return size.uint64Value
  }

  static func fileSize(at path: String) -> String? {
    guard let bytes = fileBytes(at: path) else { return nil }
    return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
  }

  static func metaDescription(in html: String) -> String? {
    var offset = html.startIndex
    while let pos = html.range(of: "<meta", options: .caseInsensitive, range: offset..<html.endIndex),
          let tagEnd = html.range(of: ">", range: pos.upperBound..<html.endIndex) {
      offset = tagEnd.upperBound
      let tag = String(html[pos.lowerBound..<tagEnd.upperBound])
      let lower = tag.lowercased()
      guard lower.contains("name=\"description\"") || lower.contains("name='description'") else { continue }
      if let content = xmlAttr(tag, "content") ?? singleQuotedAttr(tag, "content") {
        let text = decodeShareEntities(content).trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { return text }
      }
    }
    return nil
  }

  // Chrome-iOS responder-chain openURL (IMP-cast). See Readest PR #4267 rationale.
  // Instance method: the chain starts at this view controller.
  @discardableResult
  func openViaResponderChain(_ url: URL) -> Bool {
    typealias OpenURLFn = @convention(c) (AnyObject, Selector, URL, NSDictionary?, AnyObject?) -> Void
    let sel = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let r = responder {
      if r.responds(to: sel) {
        let imp = r.method(for: sel)
        let fn = unsafeBitCast(imp, to: OpenURLFn.self)
        fn(r, sel, url, [:], nil)
        return true
      }
      responder = r.next
    }
    return false
  }
}
