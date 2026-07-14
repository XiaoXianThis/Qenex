import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.2.1"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    intellijPlatform {
        // Optional: -PlocalIdePath=/path/to/IDE.app (or .../Contents) when CDN download fails
        val localIdePath = providers.gradleProperty("localIdePath")
        if (localIdePath.isPresent) {
            local(localIdePath.get())
        } else {
            val platformVersion = providers.gradleProperty("platformVersion").get()
            create(IntelliJPlatformType.IntellijIdeaCommunity, platformVersion)
        }
    }
}

intellijPlatform {
    pluginConfiguration {
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            // Compile against 2024.2 (242); allow install on current IDEs (261 = 2026.1).
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = providers.gradleProperty("pluginUntilBuild")
        }
    }
    instrumentCode = false
}

tasks {
    processResources {
        from("bin") {
            into("qenex/bin")
        }
        from("bridge.config.json")
    }

    buildSearchableOptions {
        enabled = false
    }

    runIde {
        // Required for setOffScreenRendering(false); improves IME and avoids JBCefInputMethodAdapter NPE.
        jvmArgs("-Djcef.remote.enabled=false")
    }
}
