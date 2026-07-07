package com.qenex

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import javax.swing.SwingConstants

class QenexPanel(private val project: Project?) : JBPanel<QenexPanel>(BorderLayout()) {
    private val log = Logger.getInstance(QenexPanel::class.java)
    private val json = Json { ignoreUnknownKeys = true }
    private var bridgeReadySent = false

    private val browser: JBCefBrowserBase? = if (JBCefApp.isSupported()) {
        createBrowser()
    } else {
        null
    }

    private val jsQuery: JBCefJSQuery? = browser?.let { JBCefJSQuery.create(it as JBCefBrowser) }

    init {
        border = JBUI.Borders.empty()
        if (browser == null || jsQuery == null) {
            showMessage("JCEF is not supported in this IDE runtime.")
        } else {
            try {
                setupBrowser(browser as JBCefBrowser, jsQuery)
            } catch (error: Exception) {
                log.error("Failed to initialize Qenex webview", error)
                showMessage("Qenex failed to load: ${error.message ?: error}")
            }
        }
    }

    fun disposePanel() {
        WebviewHttpServer.stop()
        browser?.dispose()
    }

    private fun showMessage(message: String) {
        removeAll()
        add(
            JBLabel("<html><center>$message</center></html>", SwingConstants.CENTER),
            BorderLayout.CENTER,
        )
        revalidate()
        repaint()
    }

    private fun createBrowser(): JBCefBrowser {
        val builder = JBCefBrowser.createBuilder()
        // Windowed rendering improves IME (Chinese/Japanese) and avoids JBCefInputMethodAdapter NPEs.
        if (!SystemInfo.isLinux) {
            builder.setOffScreenRendering(false)
        }
        return builder.build()
    }

    private fun setupBrowser(browser: JBCefBrowser, jsQuery: JBCefJSQuery) {
        jsQuery.addHandler { request ->
            ApplicationManager.getApplication().executeOnPooledThread {
                handleMessage(request)
            }
            JBCefJSQuery.Response(null)
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (!frame.isMain) {
                    return
                }
                log.info("Qenex webview loaded: ${frame.url} ($httpStatusCode)")
                injectBridge(frame)
            }
        }, browser.cefBrowser)

        removeAll()
        add(browser.component, BorderLayout.CENTER)
        revalidate()
        repaint()

        val webviewDir = WebviewResourceLoader.getWebviewDir(javaClass.classLoader)
        val indexUrl = WebviewHttpServer.start(webviewDir)
        log.info("Loading Qenex webview from $indexUrl")
        browser.loadURL(indexUrl)
    }

    private fun injectBridge(frame: CefFrame) {
        val query = jsQuery ?: return
        val script = """
            window.__qenexBridge = {
                postMessage: function(msg) {
                    ${query.inject("JSON.stringify(msg)")}
                }
            };
            window.dispatchEvent(new Event('qenex-bridge-injected'));
        """.trimIndent()
        frame.executeJavaScript(script, frame.url, 0)
    }

    private fun handleMessage(raw: String) {
        val element = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        val type = element["type"]?.jsonPrimitive?.content ?: return

        when (type) {
            "ready" -> sendBridgeReady()
            "storage-get" -> {
                val requestId = element.requestId() ?: return
                val key = element["key"]?.jsonPrimitive?.content ?: return
                val value = QenexStorage.get(key)
                postToWebview(
                    buildJsonObject {
                        put("type", "storage-result")
                        put("requestId", requestId)
                        if (value != null) {
                            put("value", value)
                        }
                    },
                )
            }
            "storage-set" -> {
                val requestId = element.requestId() ?: return
                val key = element["key"]?.jsonPrimitive?.content ?: return
                val value = element["value"]?.jsonPrimitive?.content ?: return
                QenexStorage.set(key, value)
                postToWebview(
                    buildJsonObject {
                        put("type", "storage-result")
                        put("requestId", requestId)
                    },
                )
            }
            "storage-remove" -> {
                val requestId = element.requestId() ?: return
                val key = element["key"]?.jsonPrimitive?.content ?: return
                QenexStorage.remove(key)
                postToWebview(
                    buildJsonObject {
                        put("type", "storage-result")
                        put("requestId", requestId)
                    },
                )
            }
            "pick-workspace" -> {
                val requestId = element.requestId() ?: return
                ApplicationManager.getApplication().invokeLater({
                    val descriptor = FileChooserDescriptorFactory.createSingleFolderDescriptor()
                        .withTitle("选择工作目录")
                    val initialDir = project?.basePath?.let { basePath ->
                        LocalFileSystem.getInstance().findFileByPath(basePath)
                    }
                    val file = FileChooser.chooseFile(descriptor, project, initialDir)
                    val path = file?.path
                    postToWebview(
                        buildJsonObject {
                            put("type", "pick-workspace-result")
                            put("requestId", requestId)
                            put("path", path?.let { JsonPrimitive(it) } ?: JsonNull)
                        },
                    )
                }, ModalityState.defaultModalityState())
            }
            "get-default-workspace" -> {
                val requestId = element.requestId() ?: return
                val workspace = project?.basePath
                postToWebview(
                    buildJsonObject {
                        put("type", "get-default-workspace-result")
                        put("requestId", requestId)
                        put("path", workspace?.let { JsonPrimitive(it) } ?: JsonNull)
                    },
                )
            }
        }
    }

    private fun sendBridgeReady() {
        if (bridgeReadySent) {
            return
        }
        bridgeReadySent = true

        try {
            val pageOrigin = browser?.cefBrowser?.url?.let(::originOf)
            val bridgeUrl = BridgeProcessManager.getInstance().start(pageOrigin)
            val defaultWorkspace = project?.basePath
            log.info("Qenex bridge ready for project: ${defaultWorkspace ?: "<none>"}")

            postToWebview(
                buildJsonObject {
                    put("type", "bridge-ready")
                    put("url", bridgeUrl)
                    if (defaultWorkspace != null) {
                        put("defaultWorkspace", defaultWorkspace)
                    } else {
                        put("defaultWorkspace", JsonNull)
                    }
                },
            )
        } catch (error: Exception) {
            log.error("Failed to start Qenex bridge", error)
            postToWebview(
                buildJsonObject {
                    put("type", "bridge-error")
                    put("message", error.message ?: error.toString())
                },
            )
        }
    }

    private fun postToWebview(payload: JsonObject) {
        val browser = browser ?: return
        val jsonText = json.encodeToString(JsonObject.serializer(), payload)
        UIUtil.invokeLaterIfNeeded {
            browser.cefBrowser.executeJavaScript(
                "window.postMessage($jsonText, '*');",
                browser.cefBrowser.url,
                0,
            )
        }
    }

    private fun JsonObject.requestId(): Int? =
        this["requestId"]?.jsonPrimitive?.int

    private fun originOf(url: String): String? {
        return runCatching { java.net.URI(url) }.getOrNull()?.let { uri ->
            when {
                uri.scheme == null -> null
                uri.host == null -> "${uri.scheme}:"
                uri.port > 0 -> "${uri.scheme}://${uri.host}:${uri.port}"
                else -> "${uri.scheme}://${uri.host}"
            }
        }
    }
}
