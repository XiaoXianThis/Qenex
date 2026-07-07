package com.qenex

import com.intellij.ide.util.PropertiesComponent

object QenexStorage {
    private const val PREFIX = "qenex:"

    fun get(key: String): String? =
        PropertiesComponent.getInstance().getValue(prefixed(key))

    fun set(key: String, value: String) {
        PropertiesComponent.getInstance().setValue(prefixed(key), value)
    }

    fun remove(key: String) {
        PropertiesComponent.getInstance().unsetValue(prefixed(key))
    }

    private fun prefixed(key: String): String = "$PREFIX$key"
}
