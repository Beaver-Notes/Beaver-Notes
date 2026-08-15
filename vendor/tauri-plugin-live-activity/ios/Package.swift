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
        .library(
            name: "RecordingActivityShared",
            type: .static,
            targets: ["RecordingActivityShared"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        // The ActivityAttributes type shared by the app and the widget
        // extension. Both link this product so the type identity matches.
        .target(
            name: "RecordingActivityShared",
            path: "Shared"),
        // The app-side Tauri plugin: starts/updates/ends the activity.
        .target(
            name: "tauri-plugin-live-activity",
            dependencies: [
                .byName(name: "Tauri"),
                .target(name: "RecordingActivityShared"),
            ],
            path: "Sources"),
    ]
)
