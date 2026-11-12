//! iOS launch splash overlay (mobile-only).
//!
//! Covers the main window with a native view painted in the dynamic system
//! background color from setup until the frontend signals its first paint.
//! This hides the black WKWebView gap between the LaunchScreen storyboard and
//! the first rendered web frame, in both light and dark mode. Desktop is
//! untouched; Android uses a windowBackground theme splash instead.

use std::time::Duration;

use tauri::{AppHandle, Listener, Manager};

use crate::shared::MAIN_WINDOW_LABEL;

const SPLASH_TAG: isize = 0xBEA9_0001;

fn with_root_view(app: &AppHandle, f: impl FnOnce(&objc2_ui_kit::UIView)) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let window = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => window,
        None => return,
    };
    let handle = match window.window_handle().ok() {
        Some(handle) => handle,
        None => return,
    };
    let RawWindowHandle::UiKit(handle) = handle.as_raw() else {
        return;
    };
    // Tauri hands us the live root UIView of the main window. Setup and
    // run_on_main_thread closures both run on the main thread while the
    // window is alive, so the pointer stays valid for the duration of f.
    let root = unsafe { &*(handle.ui_view.as_ptr() as *const objc2_ui_kit::UIView) };
    f(root);
}

pub(crate) fn show_splash(app: &AppHandle) {
    use objc2::MainThreadOnly;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::NSString;
    use objc2_ui_kit::{
        UIColor, UIApplication, UIImage, UIImageView, UIView, UIViewAutoresizing,
        UIViewContentMode,
    };

    with_root_view(app, |root| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let overlay: Retained<UIView> = UIView::initWithFrame(UIView::alloc(mtm), root.bounds());
        overlay.setAutoresizingMask(
            UIViewAutoresizing::FlexibleWidth | UIViewAutoresizing::FlexibleHeight,
        );
        overlay.setTag(SPLASH_TAG);
        overlay.setBackgroundColor(Some(&UIColor::systemBackgroundColor()));

        // Brand the overlay with the user's active icon: iOS tracks the
        // current alternate icon itself, so no JS state is needed.
        // Static frames are fine — the overlay only lives until first paint.
        let logo = match UIApplication::sharedApplication(mtm)
            .alternateIconName()
            .map(|name| name.to_string())
            .as_deref()
        {
            Some("AppIcon 1") => "SplashLogo1",
            Some("AppIcon 2") => "SplashLogo2",
            Some("AppIcon 3") => "SplashLogo3",
            Some("AppIcon 4") => "SplashLogo4",
            Some("AppIcon 5") => "SplashLogo5",
            Some("AppIcon 6") => "SplashLogo6",
            Some("AppIcon 7") => "SplashLogo7",
            Some("AppIcon 8") => "SplashLogo8",
            _ => "SplashLogo",
        };
        let bounds = root.bounds();
        let center = |w: f64, h: f64, dy: f64| CGRect {
            origin: CGPoint {
                x: (bounds.size.width - w) / 2.0,
                y: (bounds.size.height - h) / 2.0 + dy,
            },
            size: CGSize {
                width: w,
                height: h,
            },
        };
        let margins = UIViewAutoresizing::FlexibleLeftMargin
            | UIViewAutoresizing::FlexibleRightMargin
            | UIViewAutoresizing::FlexibleTopMargin
            | UIViewAutoresizing::FlexibleBottomMargin;

        if let Some(image) = UIImage::imageNamed(&NSString::from_str(logo)) {
            let side = 112.0;
            let icon: Retained<UIImageView> =
                UIImageView::initWithImage(UIImageView::alloc(mtm), Some(&image));
            icon.setFrame(center(side, side, 0.0));
            icon.setContentMode(UIViewContentMode::ScaleAspectFit);
            icon.setAutoresizingMask(margins);
            // Full-bleed square artwork -> iOS app-icon lozenge.
            let layer = icon.layer();
            layer.setCornerRadius(0.225 * side);
            layer.setMasksToBounds(true);
            overlay.addSubview(&icon);
        }

        root.addSubview(&overlay);
    });
}

pub(crate) fn hide_splash(app: &AppHandle) {
    with_root_view(app, |root| {
        if let Some(overlay) = root.viewWithTag(SPLASH_TAG) {
            overlay.removeFromSuperview();
        }
    });
}

pub(crate) fn watch_first_paint(app: &AppHandle) {
    let handle = app.clone();
    app.listen("splash:first-paint", move |_| {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || hide_splash(&inner));
    });

    // Failsafe: never trap the user behind the overlay if the signal is lost.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(8));
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || hide_splash(&inner));
    });
}
