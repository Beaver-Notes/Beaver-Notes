import SwiftRs
import Tauri
import UIKit
import WebKit
import os

let logger = Logger(subsystem: "com.plugin.safe.area.insets.css", category: "InsetPlugin")

class SetScribbleEnabledArgs: Decodable {
  let enabled: Bool
}

class InsetPlugin: Plugin, UIScribbleInteractionDelegate {
  private weak var trackedWebView: WKWebView?
  private var baselineContentInset = UIEdgeInsets.zero
  private var baselineIndicatorInset = UIEdgeInsets.zero
  private var didCaptureBaselineInsets = false
  private var scribbleInteraction: UIScribbleInteraction?
  private var scribbleEnabled = true

  // MARK: - Chargement du plugin
  override func load(webview: WKWebView) {
    trackedWebView = webview
    captureBaselineInsetsIfNeeded(for: webview)
    applyBackgroundColors(for: webview)
    configureScribbleInteraction(for: webview)

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillChangeFrame),
      name: UIResponder.keyboardWillChangeFrameNotification,
      object: nil
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillShow),
      name: UIResponder.keyboardWillShowNotification,
      object: nil
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillHide),
      name: UIResponder.keyboardWillHideNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: - Gestion clavier
  @objc func keyboardWillChangeFrame(notification: Notification) {
    applyKeyboardLayout(notification: notification, forceHidden: false)
  }

  @objc func keyboardWillShow(notification: Notification) {
    applyKeyboardLayout(notification: notification, forceHidden: false)
    trigger("keyboard_shown", data: [:])
  }

  @objc func keyboardWillHide(notification: Notification) {
    applyKeyboardLayout(notification: notification, forceHidden: true)
    trigger("keyboard_hidden", data: [:])
  }

  @objc public func setScribbleEnabled(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetScribbleEnabledArgs.self)
    scribbleEnabled = args.enabled
    invoke.resolve()
  }

  // MARK: - Commande: obtenir le top inset (status bar / notch)
  @objc public func getTopInset(_ invoke: Invoke) throws {
    let window = UIApplication.shared.windows.first
    let topInset = window?.safeAreaInsets.top ?? 0
    let topInsetDIP = toDIPFromPixel(topInset)
    logger.info("Top inset: \(topInsetDIP)")

    invoke.resolve(["inset": topInset])
  }

  // MARK: - Commande: obtenir le bottom inset (home indicator / nav bar)
  @objc public func getBottomInset(_ invoke: Invoke) throws {
    let window = UIApplication.shared.windows.first
    let bottomInset = window?.safeAreaInsets.bottom ?? 0
    let bottomInsetDIP = toDIPFromPixel(bottomInset)
    logger.info("Bottom inset: \(bottomInsetDIP)")
    invoke.resolve(["inset": bottomInset])
  }

  // MARK: - Conversion PX -> DIP
  private func toDIPFromPixel(_ pixels: CGFloat) -> Double {
    let scale = UIScreen.main.scale
    return Double(pixels / scale)
  }

  private func captureBaselineInsetsIfNeeded(for webview: WKWebView) {
    guard !didCaptureBaselineInsets else { return }
    baselineContentInset = webview.scrollView.contentInset
    baselineIndicatorInset = webview.scrollView.scrollIndicatorInsets
    didCaptureBaselineInsets = true
  }

  private func configureScribbleInteraction(for webview: WKWebView) {
    guard #available(iOS 14.0, *) else { return }
    guard scribbleInteraction == nil else { return }

    let interaction = UIScribbleInteraction(delegate: self)
    webview.addInteraction(interaction)
    scribbleInteraction = interaction
  }

  private func surfaceBackgroundColor(isDark: Bool) -> UIColor {
    if isDark {
      return UIColor(red: 23.0 / 255.0, green: 23.0 / 255.0, blue: 23.0 / 255.0, alpha: 1)
    }

    return .white
  }

  private func applyResolvedBackgroundColor(_ backgroundColor: UIColor, for webview: WKWebView) {
    webview.isOpaque = false
    webview.backgroundColor = .clear
    webview.scrollView.backgroundColor = backgroundColor
    webview.superview?.backgroundColor = backgroundColor
    webview.window?.backgroundColor = backgroundColor
  }

  private func color(from cssColor: String) -> UIColor? {
    let trimmed = cssColor.trimmingCharacters(in: .whitespacesAndNewlines)
    let pattern = #"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)"#

    guard
      let regex = try? NSRegularExpression(pattern: pattern),
      let match = regex.firstMatch(
        in: trimmed,
        range: NSRange(trimmed.startIndex..., in: trimmed)
      )
    else {
      return nil
    }

    func component(at index: Int, fallback: CGFloat) -> CGFloat {
      guard
        let range = Range(match.range(at: index), in: trimmed),
        let value = Double(trimmed[range])
      else {
        return fallback
      }

      return CGFloat(value)
    }

    return UIColor(
      red: component(at: 1, fallback: 255) / 255,
      green: component(at: 2, fallback: 255) / 255,
      blue: component(at: 3, fallback: 255) / 255,
      alpha: component(at: 4, fallback: 1)
    )
  }

  private func applyBackgroundColors(for webview: WKWebView) {
    let fallbackColor = surfaceBackgroundColor(
      isDark: webview.traitCollection.userInterfaceStyle == .dark
    )
    applyResolvedBackgroundColor(fallbackColor, for: webview)

    webview.evaluateJavaScript(
      "window.getComputedStyle(document.body).backgroundColor"
    ) { result, _ in
      if let cssColor = result as? String, let resolvedColor = self.color(from: cssColor) {
        DispatchQueue.main.async {
          self.applyResolvedBackgroundColor(resolvedColor, for: webview)
        }
        return
      }

      webview.evaluateJavaScript("document.documentElement.classList.contains('dark')") { darkResult, _ in
        guard let isDark = darkResult as? Bool else { return }

        DispatchQueue.main.async {
          self.applyResolvedBackgroundColor(self.surfaceBackgroundColor(isDark: isDark), for: webview)
        }
      }
    }
  }

  private func keyboardOverlap(
    for notification: Notification,
    in webview: WKWebView,
    forceHidden: Bool
  ) -> CGFloat {
    guard
      !forceHidden,
      let parent = webview.superview,
      let window = webview.window,
      let userInfo = notification.userInfo,
      let keyboardValue = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue
    else {
      return 0
    }

    let keyboardFrameInWindow = window.convert(keyboardValue.cgRectValue, from: nil)
    let parentFrameInWindow = parent.convert(parent.bounds, to: window)
    return max(0, parentFrameInWindow.maxY - keyboardFrameInWindow.minY)
  }

  private func animationOptions(for notification: Notification) -> UIView.AnimationOptions {
    let curveRaw = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
    return UIView.AnimationOptions(rawValue: curveRaw << 16).union(.beginFromCurrentState)
  }

  private func animationDuration(for notification: Notification) -> TimeInterval {
    notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? TimeInterval ?? 0.25
  }

  private func applyKeyboardLayout(notification: Notification, forceHidden: Bool) {
    guard let webview = trackedWebView, let parent = webview.superview else { return }

    captureBaselineInsetsIfNeeded(for: webview)
    applyBackgroundColors(for: webview)

    let overlap = keyboardOverlap(for: notification, in: webview, forceHidden: forceHidden)
    var resizedFrame = parent.bounds
    resizedFrame.size.height = max(0, parent.bounds.height - overlap)

    UIView.animate(
      withDuration: animationDuration(for: notification),
      delay: 0,
      options: animationOptions(for: notification)
    ) {
      webview.frame = resizedFrame
      webview.scrollView.contentInset = self.baselineContentInset
      webview.scrollView.scrollIndicatorInsets = self.baselineIndicatorInset
      webview.scrollView.verticalScrollIndicatorInsets = self.baselineIndicatorInset
    }
  }

  @available(iOS 14.0, *)
  func scribbleInteraction(
    _ interaction: UIScribbleInteraction,
    shouldBeginAt location: CGPoint
  ) -> Bool {
    return scribbleEnabled
  }
}

// MARK: - Initialisation plugin Tauri
@_cdecl("init_plugin_safe_area_insets_css")
func initPlugin() -> Plugin {
  return InsetPlugin()
}
