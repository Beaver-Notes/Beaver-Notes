#!/bin/bash
set -euo pipefail

cd src-tauri/gen/android/app

perl -i -pe '
  if (/^import java\.util\.Properties/) {
    print "import java.io.FileInputStream\n"
  }
' build.gradle.kts

perl -i -pe '
  if (/^    buildTypes \{/) {
    print qq(
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
                storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

)
  }
  if (/isMinifyEnabled = (true|false)/) {
    print qq(            signingConfig = signingConfigs.findByName("release")\n)
  }
' build.gradle.kts
