package com.aramguides.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.em
import com.aramguides.app.pack.LoadedPack

/** An icon from the pack; a neutral placeholder when the file is missing (the name next to it stays). */
@Composable
fun PackIcon(
    pack: LoadedPack,
    path: String?,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(8),
    grey: Boolean = false,
) {
    val bmp = remember(pack, path) { path?.let { pack.icon(it) } }
    Box(modifier.clip(shape).background(Palette.s2)) {
        if (bmp != null) {
            Image(
                bitmap = bmp,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                colorFilter = if (grey) GREY else null,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

private val GREY = ColorFilter.colorMatrix(
    ColorMatrix().apply { setToSaturation(0f) }.also { m ->
        // Darken to about half brightness, like the mock's grayscale(1) brightness(.5).
        val v = m.values
        for (i in 0..2) for (j in 0..2) v[i * 5 + j] *= 0.5f
    },
)

/** Guide text with {P}{Q}{W}{E}{R} drawn as the ability letter followed by its small icon. */
@Composable
fun RichText(
    text: String,
    pack: LoadedPack,
    abilityIcons: Map<String, String>,
    style: TextStyle,
    modifier: Modifier = Modifier,
) {
    val pieces = remember(text) { Tokens.parse(text) }
    val annotated = remember(pieces) {
        buildAnnotatedString {
            for (p in pieces) when (p) {
                is Piece.Text -> append(p.text)
                is Piece.AbilityRef -> {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Palette.on)) { append(abilityLetter(p.key)) }
                    append('\u2009')
                    appendInlineContent("ab_${p.key}", "[${p.key}]")
                }
            }
        }
    }
    val inline = remember(abilityIcons) {
        listOf("P", "Q", "W", "E", "R").associate { key ->
            "ab_$key" to InlineTextContent(Placeholder(1.35.em, 1.35.em, PlaceholderVerticalAlign.TextCenter)) {
                AbilityBadge(pack, abilityIcons[key], key, Modifier.fillMaxSize())
            }
        }
    }
    Text(annotated, modifier = modifier, style = style, inlineContent = inline)
}

fun abilityLetter(key: String) = if (key == "P") "П" else key

/** Ability icon; with [letter] it carries a small П/Q/W/E/R badge in the corner. */
@Composable
fun AbilityBadge(pack: LoadedPack, path: String?, key: String, modifier: Modifier = Modifier, letter: Boolean = false) {
    Box(modifier) {
        PackIcon(pack, path, Modifier.fillMaxSize(), RoundedCornerShape(22))
        if (letter) {
            Text(
                abilityLetter(key),
                color = Palette.on,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 10.sp,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .clip(RoundedCornerShape(topStart = 4.dp))
                    .background(Palette.canvas.copy(alpha = 0.85f))
                    .padding(horizontal = 3.dp, vertical = 1.dp),
            )
        }
    }
}
