plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    kotlin("plugin.serialization")
}

android {
    namespace = "com.aramguides.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.aramguides.app"
        minSdk = 26
        targetSdk = 36
        // app-vN on GitHub releases ships versionCode N; README «Выпуск приложения».
        versionCode = 1
        versionName = "1"
        val prop = { name: String -> (project.findProperty(name) as String?).orEmpty() }
        buildConfigField("String", "CONTENT_BASE_URL", "\"${prop("contentBaseUrl")}\"")
        buildConfigField("String", "RELEASES_URL", "\"${prop("releasesUrl")}\"")
    }
    // The release key and its password live outside the repo, in ~/.gradle/gradle.properties.
    // Without them assembleRelease still builds, but the APK is unsigned and will not install.
    val releaseKey = (findProperty("aramReleaseStoreFile") as String?)?.let(::file)
    signingConfigs {
        if (releaseKey != null) create("release") {
            storeFile = releaseKey
            storePassword = findProperty("aramReleasePassword") as String?
            keyAlias = "aram-guides"
            keyPassword = findProperty("aramReleasePassword") as String?
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
    // The pack is a zip of already-compressed WebP files; storing it uncompressed in the APK avoids double work.
    androidResources { noCompress += "zip" }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

val bundledPack = file("src/main/assets/pack.zip")
tasks.named("preBuild") {
    doFirst {
        if (!bundledPack.exists()) throw GradleException("Нет src/main/assets/pack.zip. Соберите пакет: bun pipeline pack")
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.08.00"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
}
