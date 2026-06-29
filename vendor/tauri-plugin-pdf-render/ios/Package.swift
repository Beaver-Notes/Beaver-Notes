// swift-tools-version:5.3

import PackageDescription

let package = Package(
    name: "tauri-plugin-pdf-render",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-pdf-render",
            type: .static,
            targets: ["tauri-plugin-pdf-render"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-pdf-render",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
