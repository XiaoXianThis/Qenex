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
            // Compile against platformVersion; sinceBuild 253+ for jcef module (needed on 2026.2).
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = providers.gradleProperty("pluginUntilBuild")
        }
    }
    instrumentCode = false
}

tasks {
    processResources {
        // Bun Bridge sources + production node_modules (staged by scripts/build-jetbrains.mjs)
        val bridgeStage = layout.projectDirectory.dir("build/qenex-bridge-stage")
        if (bridgeStage.asFile.exists()) {
            from(bridgeStage) {
                into("qenex/bridge")
            }
        } else {
            // Fallback for compile-only without stage: source tree only
            from("../bridge/src") {
                into("qenex/bridge/src")
            }
            from("../bridge/package.json") {
                into("qenex/bridge")
            }
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
