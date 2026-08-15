// swift-tools-version:5.7

import PackageDescription

let package = Package(
    name: "tauri-plugin-live-activity",
    platforms: [
        .iOS(.v16),
    ],
    products: [
        .library(
            name: "tauri-plugin-live-activity",
            type: .static,
            targets: ["tauri-plugin-live-activity"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-live-activity",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources",
            exclude: [
                // Widget-only files — compiled into the app's widget-extension
                // target (Xcode), never linked into the app (they carry @main).
                "RecordingActivityViews.swift",
                "RecordingActivityWidgetBundle.swift",
            ])
    ]
)
