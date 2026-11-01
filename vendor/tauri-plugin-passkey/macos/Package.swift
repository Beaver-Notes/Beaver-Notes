// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "WebauthnBridge",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "WebauthnBridge",
            type: .static,
            targets: ["WebauthnBridge"]
        ),
    ],
    targets: [
        .target(
            name: "WebauthnBridge",
            dependencies: []
        ),
        .testTarget(
            name: "WebauthnBridgeTests",
            dependencies: ["WebauthnBridge"]
        ),
    ]
)
