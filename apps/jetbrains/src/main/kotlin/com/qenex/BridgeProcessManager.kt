package com.qenex

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.SystemInfo
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
import java.util.LinkedHashSet

/**
 * Spawns the Bun Bridge (apps/bridge) — same contract as Desktop bridge.rs (M9).
 */
@Service(Service.Level.APP)
class BridgeProcessManager {
    private val log = Logger.getInstance(BridgeProcessManager::class.java)

    @Volatile
    private var process: Process? = null

    @Volatile
    private var port: Int? = null

    @Volatile
    private var startFuture: CompletableFuture<String>? = null

    val baseUrl: String?
        get() = port?.let { "http://127.0.0.1:$it" }

    fun start(pageOrigin: String? = null): String {
        port?.takeIf { process?.isAlive == true }?.let { return "http://127.0.0.1:$it" }
        if (port != null && process?.isAlive != true) {
            process = null
            port = null
            startFuture = null
        }

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
                future.completeExceptionally(error)
                throw error
            } finally {
                startFuture = null
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
        }
    }

    private fun doStart(pageOrigin: String?): String {
        val freePort = findFreePort()
        val pathEnv = augmentedPath()
        val bun = findBun(pathEnv)
        val entry = resolveBridgeEntry()
        val bridgeCwd = if (entry.fileName.toString() == "index.js") {
            entry.parent
        } else {
            entry.parent?.parent
        } ?: throw IllegalStateException("Invalid bridge entry: $entry")

        val cors = buildList {
            pageOrigin?.takeIf { it.isNotBlank() }?.let { add(it) }
            add("http://127.0.0.1:$freePort")
            add("http://localhost:$freePort")
            add("null")
        }.distinct().joinToString(",")

        log.info("starting Bun Bridge: bun=$bun entry=$entry port=$freePort")

        val env = HashMap(System.getenv())
        env["PATH"] = pathEnv
        env["QENEX_BRIDGE_HOST"] = "127.0.0.1"
        env["QENEX_BRIDGE_PORT"] = freePort.toString()
        env["QENEX_CORS_ORIGINS"] = cors
        if (System.getenv("HOME").isNullOrBlank() && !System.getenv("USERPROFILE").isNullOrBlank()) {
            env["HOME"] = System.getenv("USERPROFILE")
        }

        val child = ProcessBuilder(bun, entry.toString())
            .directory(bridgeCwd.toFile())
            .redirectErrorStream(true)
            .apply { environment().clear(); environment().putAll(env) }
            .start()

        Thread {
            child.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line -> log.info("[qenex-bridge] $line") }
            }
        }.apply {
            isDaemon = true
            start()
        }

        process = child
        try {
            waitForHealth(freePort, child)
        } catch (error: Exception) {
            if (process === child) process = null
            killProcessTree(child)
            throw error
        }
        port = freePort
        watchProcess(child, freePort)
        return "http://127.0.0.1:$freePort"
    }

    private fun watchProcess(child: Process, childPort: Int) {
        Thread {
            val code = runCatching { child.waitFor() }.getOrNull()
            synchronized(this) {
                if (process === child) {
                    process = null
                    if (port == childPort) port = null
                    startFuture = null
                    log.warn("Qenex Bridge exited unexpectedly${code?.let { " (exit $it)" } ?: ""}")
                }
            }
        }.apply {
            name = "qenex-bridge-watch"
            isDaemon = true
            start()
        }
    }

    private fun findBun(pathEnv: String): String {
        val override = System.getenv("QENEX_BUN_BIN")?.trim().orEmpty()
        if (override.isNotEmpty()) {
            val p = Path.of(override)
            if (Files.isRegularFile(p) || whichInPath(override, pathEnv) != null) {
                return override
            }
            throw IllegalStateException("QENEX_BUN_BIN not found: $override")
        }

        whichInPath("bun", pathEnv)?.let { return it }
        if (SystemInfo.isWindows) {
            whichInPath("bun.exe", pathEnv)?.let { return it }
        }

        val home = System.getProperty("user.home")
        if (!home.isNullOrBlank()) {
            val candidate = Path.of(home, ".bun", "bin", if (SystemInfo.isWindows) "bun.exe" else "bun")
            if (Files.isRegularFile(candidate)) {
                return candidate.toAbsolutePath().toString()
            }
        }

        throw IllegalStateException(
            "Bun not found on PATH. Install Bun (https://bun.sh) or set QENEX_BUN_BIN.",
        )
    }

    private fun whichInPath(name: String, pathEnv: String): String? {
        val sep = if (SystemInfo.isWindows) ';' else ':'
        for (dir in pathEnv.split(sep)) {
            if (dir.isBlank()) continue
            val candidate = Path.of(dir.trim(), name)
            if (Files.isRegularFile(candidate)) {
                return candidate.toAbsolutePath().toString()
            }
        }
        return null
    }

    private fun resolveBridgeEntry(): Path {
        val override = System.getenv("QENEX_BRIDGE_ENTRY")?.trim().orEmpty()
        if (override.isNotEmpty()) {
            val p = Path.of(override)
            if (Files.isRegularFile(p)) return p.toAbsolutePath().normalize()
            throw IllegalStateException("QENEX_BRIDGE_ENTRY not found: $override")
        }

        // Dev first: use monorepo source so local edits are reflected immediately.
        findRepoBridgeEntry()?.let {
            log.info("using repo Bun Bridge entry: $it")
            return it
        }

        ensureBundledBridgeReady()?.let {
            log.info("using bundled Bun Bridge entry: $it")
            return it
        }

        throw IllegalStateException(
            "Bun Bridge entry not found. Set QENEX_BRIDGE_ENTRY or run from the Qenex repo / install a build that bundles qenex/bridge.",
        )
    }

    private fun findRepoBridgeEntry(): Path? {
        val candidates = mutableListOf<Path>()
        val userDir = Path.of(System.getProperty("user.dir", ".")).toAbsolutePath().normalize()
        candidates.add(userDir.resolve("../bridge/src/index.ts"))
        candidates.add(userDir.resolve("apps/bridge/src/index.ts"))
        candidates.add(userDir.resolve("../../apps/bridge/src/index.ts"))

        var walk: Path? = userDir
        repeat(10) {
            val cur = walk ?: return@repeat
            candidates.add(cur.resolve("apps/bridge/src/index.ts"))
            candidates.add(cur.resolve("bridge/src/index.ts"))
            walk = cur.parent
        }

        // Also walk from IDE sandbox / system path parents (runIde cwd can be odd)
        walk = Path.of(PathManager.getSystemPath()).toAbsolutePath().normalize()
        repeat(10) {
            val cur = walk ?: return@repeat
            candidates.add(cur.resolve("apps/bridge/src/index.ts"))
            walk = cur.parent
        }

        for (c in candidates) {
            val normalized = runCatching { c.toAbsolutePath().normalize() }.getOrNull() ?: continue
            if (Files.isRegularFile(normalized)) {
                return normalized
            }
        }
        return null
    }

    /** Packaged plugin: extract the build-time bundled Bridge to a real file. */
    private fun ensureBundledBridgeReady(): Path? {
        val classLoader = BridgeProcessManager::class.java.classLoader
        val indexUrl = classLoader.getResource("qenex/bridge/index.js") ?: return null

        val resourceStamp = runCatching { indexUrl.openConnection().lastModified }
            .getOrDefault(0L)
            .toString(16)
        val destRoot = Path.of(PathManager.getSystemPath(), "qenex", "bundled-bridge-$resourceStamp")
        val destIndex = destRoot.resolve("index.js")

        if (indexUrl.protocol == "file") {
            val filePath = Path.of(indexUrl.toURI()).toAbsolutePath().normalize()
            return filePath
        }

        if (!Files.isRegularFile(destIndex)) {
            if (Files.isDirectory(destRoot)) {
                runCatching {
                    Files.walk(destRoot)
                        .sorted(Comparator.reverseOrder())
                        .forEach { Files.deleteIfExists(it) }
                }
            }
            Files.createDirectories(destRoot)
            copyResourceTree(classLoader, "qenex/bridge", destRoot)
            if (!Files.isRegularFile(destIndex)) {
                log.warn("bundled bridge extract missing index at $destIndex")
                return null
            }
        }

        return destIndex.takeIf { Files.isRegularFile(it) }
    }

    private fun copyResourceTree(classLoader: ClassLoader, resourceRoot: String, destRoot: Path) {
        val manifest = classLoader.getResourceAsStream("$resourceRoot/.qenex-bridge-files")
        if (manifest != null) {
            manifest.bufferedReader().useLines { lines ->
                for (rel in lines) {
                    val trimmed = rel.trim()
                    if (trimmed.isEmpty() || trimmed.startsWith("#")) continue
                    val stream = classLoader.getResourceAsStream("$resourceRoot/$trimmed") ?: continue
                    val dest = destRoot.resolve(trimmed)
                    Files.createDirectories(dest.parent)
                    stream.use { Files.copy(it, dest, StandardCopyOption.REPLACE_EXISTING) }
                }
            }
            return
        }

        for (rel in listOf("index.js", "package.json")) {
            val stream = classLoader.getResourceAsStream("$resourceRoot/$rel") ?: continue
            val dest = destRoot.resolve(rel)
            Files.createDirectories(dest.parent)
            stream.use { Files.copy(it, dest, StandardCopyOption.REPLACE_EXISTING) }
        }
        // Best-effort: copy other src/*.ts if listed individually fails — walk common names via getResource
        // Full src tree is expected in manifest from build scripts.
    }

    private fun augmentedPath(): String {
        val sep = if (SystemInfo.isWindows) ';' else ':'
        val parts = LinkedHashSet<String>()
        fun push(raw: String?) {
            if (raw.isNullOrBlank()) return
            for (p in raw.split(sep)) {
                val t = p.trim()
                if (t.isNotEmpty()) parts.add(t)
            }
        }

        push(loginShellPath())
        push(System.getenv("PATH"))
        val home = System.getProperty("user.home")
        if (!home.isNullOrBlank()) {
            for (rel in listOf(
                ".bun/bin",
                ".local/bin",
                ".cargo/bin",
                ".deno/bin",
                "bin",
                ".nvm/current/bin",
            )) {
                push(Path.of(home, rel).toString())
            }
        }
        if (!SystemInfo.isWindows) {
            for (system in listOf(
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            )) {
                push(system)
            }
        }
        return parts.joinToString(sep.toString())
    }

    private fun loginShellPath(): String? {
        if (SystemInfo.isWindows) return null
        val shell = System.getenv("SHELL") ?: "/bin/zsh"
        return runCatching {
            val proc = ProcessBuilder(shell, "-l", "-c", "printf %s \"\$PATH\"")
                .redirectErrorStream(true)
                .start()
            val out = proc.inputStream.bufferedReader().readText().trim()
            if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                proc.destroyForcibly()
                return null
            }
            out.takeIf { it.isNotEmpty() }
        }.getOrNull()
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
                val code = runCatching { child.exitValue() }.getOrNull()
                throw IllegalStateException(
                    "Bridge exited before becoming healthy" +
                        (code?.let { " (exit $it)" } ?: "") +
                        ". Check idea.log for [qenex-bridge] lines; " +
                        "dev: ensure apps/bridge exists or set QENEX_BRIDGE_ENTRY.",
                )
            }

            val healthy = runCatching {
                val response = client.send(
                    HttpRequest.newBuilder(healthUri).GET().build(),
                    HttpResponse.BodyHandlers.discarding(),
                )
                response.statusCode() in 200..299
            }.getOrDefault(false)

            if (healthy) return
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
        runCatching {
            child.destroy()
            if (!child.waitFor(3, TimeUnit.SECONDS)) {
                child.destroyForcibly().waitFor(2, TimeUnit.SECONDS)
            }
        }
    }

    companion object {
        fun getInstance(): BridgeProcessManager =
            ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
    }
}
