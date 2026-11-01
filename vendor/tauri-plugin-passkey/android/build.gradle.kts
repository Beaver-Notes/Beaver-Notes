plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0"
}

android {
    namespace = "net.kackman.webauthn"
    compileSdk = 36

    defaultConfig {
        minSdk = 28

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    testOptions {
        unitTests {
            // Robolectric needs the Android resources/manifest to build its sandbox.
            isIncludeAndroidResources = true
        }
    }
}

// Upgrade ceiling: a consuming app builds this module with the AGP/Kotlin from the
// Tauri CLI's generated Android project (2.11.4: AGP 8.11.0, Kotlin 1.9.25, Gradle
// 8.14.3, compileSdk 36) — not with the versions android/settings.gradle pins for
// standalone builds here. So these deps must stay within what that toolchain accepts:
//   - androidx.credentials 1.6.0+ ships Kotlin 2.1 metadata; kotlinc 1.9 reads only
//     up to 2.0 and fails with "incompatible version of Kotlin".
//   - androidx.core 1.18.0+ declares "requires AGP 9.1.0 or higher" in AAR metadata,
//     which hard-fails checkAarMetadata for the consumer.
// Re-check these bounds when Tauri's mobile template moves.
dependencies {
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.13.0")
    testImplementation("junit:junit:4.13.2")
    // Robolectric provides a real org.json implementation; the stock android.jar
    // ships org.json as stubs that throw "not mocked" under plain JVM unit tests.
    testImplementation("org.robolectric:robolectric:4.16.1")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    implementation(project(":tauri-android"))
}

ktlint {
    // Must match the ktlint the CLI runs (bundled with @naturalcycles/ktlint in ../package.json — currently 1.8.0).
    version.set("1.8.0")
    android.set(true)
    ignoreFailures.set(false)
}
