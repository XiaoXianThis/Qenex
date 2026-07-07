package com.qenex

import com.intellij.openapi.diagnostic.Logger
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.net.JarURLConnection
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.jar.JarFile
import kotlin.io.path.createDirectories

object WebviewResourceLoader {
    private val log = Logger.getInstance(WebviewResourceLoader::class.java)

    @Volatile
    private var cachedWebviewDir: Path? = null

    fun getWebviewDir(classLoader: ClassLoader): Path {
        cachedWebviewDir?.let { return it }

        synchronized(this) {
            cachedWebviewDir?.let { return it }

            val indexResource = classLoader.getResource("webview/index.html")
                ?: throw IllegalStateException(
                    "webview/index.html not found. Run \"bun run build:jetbrains\" first.",
                )

            val webviewDir = when (indexResource.protocol) {
                "file" -> copyLooseWebview(indexResource.toURI())
                "jar" -> extractFromJar(indexResource)
                else -> throw IllegalStateException(
                    "Unsupported webview resource protocol: ${indexResource.protocol}",
                )
            }

            cachedWebviewDir = webviewDir
            log.info("Qenex webview extracted to $webviewDir")
            return webviewDir
        }
    }

    private fun copyLooseWebview(indexUri: URI): Path {
        val indexPath = Path.of(indexUri)
        val sourceDir = indexPath.parent
            ?: throw IllegalStateException("Invalid webview index path: $indexUri")

        val tempDir = Files.createTempDirectory("qenex-webview-")
        Files.walk(sourceDir).use { stream ->
            stream.filter { Files.isRegularFile(it) }.forEach { file ->
                val relative = sourceDir.relativize(file)
                val dest = tempDir.resolve(relative)
                dest.parent?.createDirectories()
                Files.copy(file, dest, StandardCopyOption.REPLACE_EXISTING)
            }
        }
        return tempDir
    }

    private fun extractFromJar(indexResource: java.net.URL): Path {
        val tempDir = Files.createTempDirectory("qenex-webview-")
        val connection = indexResource.openConnection()
        if (connection is JarURLConnection) {
            connection.jarFile.use { jar ->
                extractJarPrefix(jar, "webview/", tempDir)
            }
            return tempDir
        }

        val jarPath = indexResource.path.substringBefore("!")
        val normalizedJarPath = if (jarPath.startsWith("file:")) {
            URI(jarPath).path
        } else {
            jarPath.removePrefix("/")
        }

        JarFile(File(normalizedJarPath)).use { jar ->
            extractJarPrefix(jar, "webview/", tempDir)
        }
        return tempDir
    }

    private fun extractJarPrefix(jar: JarFile, prefix: String, destRoot: Path) {
        jar.entries().asSequence()
            .filter { !it.isDirectory && it.name.startsWith(prefix) }
            .forEach { entry ->
                val relative = entry.name.removePrefix(prefix)
                val dest = destRoot.resolve(relative)
                dest.parent?.createDirectories()
                jar.getInputStream(entry).use { input ->
                    Files.copy(input, dest, StandardCopyOption.REPLACE_EXISTING)
                }
            }

        if (!Files.exists(destRoot.resolve("index.html"))) {
            throw IllegalStateException("Failed to extract webview assets from plugin JAR")
        }
    }
}

object WebviewHttpServer {
    private val log = Logger.getInstance(WebviewHttpServer::class.java)

    @Volatile
    private var server: HttpServer? = null

    @Volatile
    private var baseUrl: String? = null

    fun start(webviewDir: Path): String {
        baseUrl?.let { return "$it/index.html" }

        synchronized(this) {
            baseUrl?.let { return "$it/index.html" }

            val httpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
            httpServer.createContext("/") { exchange ->
                try {
                    val rawPath = exchange.requestURI.path.removePrefix("/")
                    val relative = rawPath.ifEmpty { "index.html" }
                    val file = webviewDir.resolve(relative).normalize()
                    if (!file.startsWith(webviewDir)) {
                        exchange.sendResponseHeaders(403, -1)
                        return@createContext
                    }
                    if (!Files.exists(file) || !Files.isRegularFile(file)) {
                        exchange.sendResponseHeaders(404, -1)
                        return@createContext
                    }

                    val bytes = Files.readAllBytes(file)
                    exchange.responseHeaders.set("Content-Type", contentTypeFor(file))
                    exchange.responseHeaders.set("Cache-Control", "no-cache")
                    exchange.sendResponseHeaders(200, bytes.size.toLong())
                    exchange.responseBody.use { it.write(bytes) }
                } catch (error: Exception) {
                    log.warn("Failed to serve webview asset: ${exchange.requestURI}", error)
                    exchange.sendResponseHeaders(500, -1)
                } finally {
                    exchange.close()
                }
            }
            httpServer.executor = null
            httpServer.start()

            val port = httpServer.address.port
            val url = "http://127.0.0.1:$port"
            server = httpServer
            baseUrl = url
            log.info("Qenex webview server started at $url")
            return "$url/index.html"
        }
    }

    fun stop() {
        synchronized(this) {
            server?.stop(0)
            server = null
            baseUrl = null
        }
    }

    private fun contentTypeFor(file: Path): String {
        return when (file.fileName.toString().substringAfterLast('.', "")) {
            "html" -> "text/html; charset=utf-8"
            "js" -> "application/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "svg" -> "image/svg+xml"
            "json" -> "application/json; charset=utf-8"
            else -> "application/octet-stream"
        }
    }
}
