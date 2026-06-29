// swift-tools-version:5.3

import PackageDescription

let package = Package(
    name: "tauri-plugin-spotsearch",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-spotsearch",
            type: .static,
            targets: ["tauri-plugin-spotsearch"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-spotsearch",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
