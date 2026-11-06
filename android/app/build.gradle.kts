import java.util.Properties

plugins {
    id("com.android.application")
}

// Khoá ký app nằm ngoài Git, cần sao lưu để các bản sau cập nhật đè được
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "vn.tmark.nhantinzalo"
    compileSdk = 34

    defaultConfig {
        applicationId = "vn.tmark.nhantinzalo"
        minSdk = 24
        targetSdk = 34
        versionCode = 10102
        versionName = "1.1.2"
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = rootProject.file("keystore/" + keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystoreProps.isNotEmpty()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Dùng chung giao diện trong thư mục ui
    sourceSets {
        getByName("main") {
            assets.srcDirs("../../ui")
        }
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
}
