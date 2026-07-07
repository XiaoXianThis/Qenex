package com.qenex

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.SystemInfo
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.ServerSocket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.io.path.deleteIfExists
import kotlin.io.path.writeText

@Service(Service.Level.APP)
class BridgeProcessManager {
    private val log = Logger.getInstance(BridgeProcessManager::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    @Volatile
    private var process: Process? = null

    @Volatile
    private var port: Int? = null

    @Volatile
    private var configPath: Path? = null

    @Volatile
    private var startFuture: CompletableFuture<String>? = null

    @Volatile
    private var extractedBinary: Path? = null

    val baseUrl: String?
        get() = port?.let { "http://127.0.0.1:$it" }

    fun start(pageOrigin: String? = null): String {
        port?.let { return "http://127.0.0.1:$it" }

        synchronized(this) {
            port?.let { return "http://127.0.0.1:$it" }
            val existing = startFuture
            if (existing != null) {
                return existing.get(60, TimeUnit.SECONDS)
            }

            val future = CompletableFuture<String>()
            startFuture = future
            try {
                val url = doStart(pageOrigin)
                future.complete(url)
                return url
            } catch (error: Exception) {
                startFuture = null
                future.completeExceptionally(error)
                throw error
            }
        }
    }

    fun stop() {
        synchronized(this) {
            val child = process
            process = null
            port = null
            startFuture = null

            child?.let { killProcessTree(it) }

            configPath?.deleteIfExists()
            configPath = null

            extractedBinary?.let { path ->
                runCatching { Files.deleteIfExists(path) }
                runCatching { Files.deleteIfExists(path.parent) }
            }
            extractedBinary = null
        }
    }

    private fun doStart(pageOrigin: String?): String {
        val freePort = findFreePort()
        val storageDir = Path.of(
            System.getProperty("idea.system.path"),
            "qenex",
        )
        Files.createDirectories(storageDir)

        val runtimeConfig = storageDir.resolve("bridge.config.json")
        val template = loadConfigTemplate()
        val corsOrigins = buildList {
            pageOrigin?.let { add(it) }
            add("http://127.0.0.1:$freePort")
            add("http://localhost:$freePort")
            add("null")
        }
        val config = template.copy(
            backendPort = freePort,
            corsOrigins = corsOrigins,
        )
        runtimeConfig.writeText(json.encodeToString(BridgeConfigTemplate.serializer(), config))
        configPath = runtimeConfig

        val binary = resolveBridgeBinary()
        val child = ProcessBuilder(
            binary.toString(),
            "--config",
            runtimeConfig.toString(),
        )
            .directory(binary.parent.toFile())
            .redirectErrorStream(true)
            .start()

        Thread {
            child.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    log.info("[qenex-bridge] $line")
                }
            }
        }.apply {
            isDaemon = true
            start()
        }

        process = child
        waitForHealth(freePort, child)
        port = freePort
        return "http://127.0.0.1:$freePort"
    }

    private fun loadConfigTemplate(): BridgeConfigTemplate {
        val classLoader = BridgeProcessManager::class.java.classLoader
        val resource = classLoader.getResource("bridge.config.json")
            ?: run {
                val fallback = Path.of(System.getProperty("user.dir"), "bridge.config.json")
                if (Files.exists(fallback)) {
                    return json.decodeFromString(
                        BridgeConfigTemplate.serializer(),
                        Files.readString(fallback),
                    )
                }
                throw IllegalStateException(
                    "bridge.config.json not found. Run \"bun run build:jetbrains\" first.",
                )
            }

        val raw = resource.openStream().bufferedReader().use { it.readText() }
        return json.decodeFromString(BridgeConfigTemplate.serializer(), raw)
    }

    private fun resolveBridgeBinary(): Path {
        val binName = if (SystemInfo.isWindows) "acp-to-agui.exe" else "acp-to-agui"
        val resourcePath = "/qenex/bin/$binName"
        val url = BridgeProcessManager::class.java.getResource(resourcePath)
            ?: throw IllegalStateException(
                "Bridge binary not found at $resourcePath. Run \"bun run build:jetbrains\" first.",
            )

        if (url.protocol == "file") {
            return Path.of(url.toURI())
        }

        val tempDir = Files.createTempDirectory("qenex-bridge-")
        val dest = tempDir.resolve(binName)
        BridgeProcessManager::class.java.getResourceAsStream(resourcePath).use { input ->
            requireNotNull(input) { "Failed to open bridge binary stream: $resourcePath" }
            Files.copy(input, dest, StandardCopyOption.REPLACE_EXISTING)
        }
        if (!SystemInfo.isWindows) {
            dest.toFile().setExecutable(true)
        }
        extractedBinary = dest
        return dest
    }

    private fun findFreePort(): Int {
        ServerSocket(0).use { socket ->
            return socket.localPort
        }
    }

    private fun waitForHealth(port: Int, child: Process) {
        val client = HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(2))
            .build()
        val healthUri = URI.create("http://127.0.0.1:$port/health")
        val deadline = System.currentTimeMillis() + 30_000

        while (System.currentTimeMillis() < deadline) {
            if (!child.isAlive) {
                throw IllegalStateException("Bridge exited before becoming healthy")
            }

            val healthy = runCatching {
                val response = client.send(
                    HttpRequest.newBuilder(healthUri).GET().build(),
                    HttpResponse.BodyHandlers.discarding(),
                )
                response.statusCode() in 200..299
            }.getOrDefault(false)

            if (healthy) {
                return
            }

            Thread.sleep(250)
        }

        throw IllegalStateException(
            "Bridge failed to become healthy on port $port within 30000ms",
        )
    }

    private fun killProcessTree(child: Process) {
        if (SystemInfo.isWindows) {
            runCatching {
                ProcessBuilder("taskkill", "/pid", child.pid().toString(), "/T", "/F")
                    .redirectErrorStream(true)
                    .start()
                    .waitFor(5, TimeUnit.SECONDS)
            }
            return
        }

        runCatching { child.destroyForcibly().waitFor(5, TimeUnit.SECONDS) }
    }

    companion object {
        fun getInstance(): BridgeProcessManager =
            ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
    }
}

@Serializable
private data class BridgeConfigTemplate(
    val projectName: String,
    val displayTitle: String,
    val description: String,
    val agentCommand: List<String>,
    val backendPort: Int,
    val corsOrigins: List<String>,
)
