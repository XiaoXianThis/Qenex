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
        // Self-contained Bun Bridge bundle (staged by scripts/build-jetbrains.mjs)
        val bridgeStage = layout.projectDirectory.dir("build/qenex-bridge-stage")
        doFirst {
            if (!bridgeStage.file("index.js").asFile.isFile) {
                throw GradleException(
                    "Missing build/qenex-bridge-stage/index.js; run `bun run build:jetbrains` first",
                )
            }
        }
        from(bridgeStage) {
            into("qenex/bridge")
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
