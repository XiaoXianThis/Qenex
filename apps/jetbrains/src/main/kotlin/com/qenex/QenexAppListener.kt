package com.qenex

import com.intellij.ide.AppLifecycleListener

class QenexAppListener : AppLifecycleListener {
    override fun appClosing() {
        BridgeProcessManager.getInstance().stop()
        WebviewHttpServer.stop()
    }
}
