#!/bin/bash
set -euo pipefail

cd src-tauri/gen/android

# Bump Kotlin to 2.1.0: tauri-plugin-biometry 0.2.8 and kotlin-stdlib 2.1.0 on the
# classpath are compiled with Kotlin 2.1 metadata, which the Tauri-generated
# 1.9.x compiler cannot read.
perl -i -pe 's/org\.jetbrains\.kotlin:kotlin-gradle-plugin:\d+\.\d+\.\d+/org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0/' build.gradle.kts

cd app

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
