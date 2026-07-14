package com.qenex

import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.awt.Color
import javax.swing.UIManager

/**
 * 从当前 LaF / UIManager 采集表面色，映射为 webview HostThemeSnapshot。
 */
object HostThemeCollector {
    /** Tool Window / 面板主背景，用于 Swing 与 CEF 默认底色。 */
    fun panelBackground(): Color =
        firstColor("ToolWindow.background", "Panel.background")
            ?: UIUtil.getPanelBackground()

    fun panelBackgroundCss(): String = toCss(panelBackground())

    fun snapshotJson(): JsonObject {
        val kind = if (JBColor.isBright()) "light" else "dark"
        val panelBg = panelBackground()
        val colors = buildJsonObject {
            putColor("background", panelBg)
            putColor("foreground", firstColor("Label.foreground", "TextField.foreground") ?: UIUtil.getLabelForeground())
            putColor("muted", firstColor("ToolWindow.background", "List.background", "EditorPane.background"))
            putColor("mutedForeground", firstColor("Label.infoForeground", "TextField.inactiveForeground", "Label.disabledForeground"))
            putColor("border", firstColor("Component.borderColor", "Borders.color", "Separator.separatorColor", "Separator.foreground"))
            putColor("input", firstColor("TextField.background", "Component.borderColor"))
            putColor("card", firstColor("PopupMenu.background", "EditorPane.background", "TextArea.background"))
            putColor("popover", firstColor("PopupMenu.background", "Menu.background"))
            putColor(
                "primary",
                firstColor(
                    "Button.defaultButtonColor",
                    "Button.default.startBackground",
                    "Link.activeForeground",
                    "Focus.color",
                ),
            )
            val primaryBg = firstColor("Button.defaultButtonColor", "Button.default.startBackground")
            putColor(
                "primaryForeground",
                firstColor("Button.default.foreground", "Button.foreground") ?: contrastForeground(primaryBg),
            )
            putColor("accent", firstColor("List.selectionBackground", "List.hoverBackground", "Tree.selectionBackground"))
            putColor(
                "accentForeground",
                firstColor("List.selectionForeground", "Tree.selectionForeground") ?: UIUtil.getListForeground(),
            )
            putColor("secondary", firstColor("Button.background", "TextField.background"))
            putColor("secondaryForeground", firstColor("Button.foreground", "TextField.foreground"))
            putColor(
                "destructive",
                firstColor(
                    "Label.errorForeground",
                    "Notification.Error.foreground",
                    "ValidationTooltip.errorBorderColor",
                ),
            )
        }
        return buildJsonObject {
            put("kind", kind)
            put("colors", colors)
        }
    }

    private fun firstColor(vararg keys: String): Color? {
        for (key in keys) {
            val color = UIManager.getColor(key) ?: continue
            return color
        }
        return null
    }

    private fun JsonObjectBuilder.putColor(key: String, color: Color?) {
        if (color == null) return
        put(key, toCss(color))
    }

    fun toCss(color: Color): String {
        return if (color.alpha < 255) {
            "rgba(${color.red}, ${color.green}, ${color.blue}, ${"%.3f".format(color.alpha / 255.0)})"
        } else {
            String.format("#%02x%02x%02x", color.red, color.green, color.blue)
        }
    }

    private fun contrastForeground(background: Color?): Color? {
        if (background == null) return null
        val luminance =
            (0.299 * background.red + 0.587 * background.green + 0.114 * background.blue) / 255.0
        return if (luminance > 0.55) Color.BLACK else Color.WHITE
    }
}
