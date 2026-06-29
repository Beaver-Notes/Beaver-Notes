// swift-tools-version:5.3

import PackageDescription

let package = Package(
    name: "tauri-plugin-sharesheet",
    platforms: [
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "tauri-plugin-sharesheet",
            type: .static,
            targets: ["tauri-plugin-sharesheet"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-sharesheet",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
