package com.aramguides.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Palette {
    val canvas = Color(0xFF0A0B0D)
    val bg = Color(0xFF111316)
    val s1 = Color(0xFF171A1E)
    val s2 = Color(0xFF1F2328)
    val s3 = Color(0xFF292E35)
    val line = Color(0xFF30363E)
    val on = Color(0xFFE8EAED)
    val body = Color(0xFFCFD4D9)
    val muted = Color(0xFF9BA4AE)
    val faint = Color(0xFF6C747D)
    val primary = Color(0xFF8EC3FF)
    val onPrimary = Color(0xFF0B2A4A)
    val pcont = Color(0xFF1C3A5E)
    val onPcont = Color(0xFFD6E8FF)
    val change = Color(0xFFF2B84B)
    val changeBg = Color(0x1AF2B84B)
    val gone = Color(0xFFFF8A80)
}

@Composable
fun AramTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.primary,
            onPrimary = Palette.onPrimary,
            primaryContainer = Palette.pcont,
            onPrimaryContainer = Palette.onPcont,
            background = Palette.bg,
            onBackground = Palette.on,
            surface = Palette.bg,
            onSurface = Palette.on,
            surfaceVariant = Palette.s2,
            onSurfaceVariant = Palette.muted,
            surfaceContainer = Palette.s1,
            surfaceContainerLow = Palette.s1,
            surfaceContainerHigh = Palette.s2,
            surfaceContainerHighest = Palette.s3,
            outline = Palette.line,
            outlineVariant = Palette.line,
        ),
        content = content,
    )
}
