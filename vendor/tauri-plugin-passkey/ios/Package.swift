// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "tauri-plugin-passkey",
    platforms: [
        .iOS("17.4"),
    ],
    products: [
        .library(
            name: "tauri-plugin-passkey",
            type: .static,
            targets: ["tauri-plugin-passkey"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-passkey",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
