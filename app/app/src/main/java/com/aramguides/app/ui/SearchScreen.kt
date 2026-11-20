package com.aramguides.app.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aramguides.app.BuildConfig
import java.text.Collator
import java.util.Locale
import com.aramguides.app.pack.Champion
import com.aramguides.app.pack.LoadedPack
import com.aramguides.app.search.Search
import com.aramguides.app.search.SearchEntry

private const val RIOT_NOTICE =
    "ARAM гайды isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone " +
        "officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties " +
        "are trademarks or registered trademarks of Riot Games, Inc."

@Composable
fun SearchScreen(
    pack: LoadedPack,
    query: TextFieldValue,
    onQueryChange: (TextFieldValue) -> Unit,
    recent: List<String>,
    appUpdateNeeded: Boolean,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val sorted = remember(pack) {
        val ru = Collator.getInstance(Locale.forLanguageTag("ru"))
        pack.data.champions.sortedWith { a, b -> ru.compare(a.name, b.name) }
    }
    val entries = remember(sorted) { sorted.map { SearchEntry(it.id, it.name, it.nameEn) } }
    val result = remember(entries, query.text) { Search.find(entries, query.text) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val gridState = rememberLazyGridState()
    LaunchedEffect(Unit) {
        focus.requestFocus()
        keyboard?.show()
    }
    LaunchedEffect(query.text) { gridState.scrollToItem(0) }

    fun open(id: String) {
        if (pack.data.guides.containsKey(id)) onOpen(id)
        else Toast.makeText(context, "Гайда ещё нет", Toast.LENGTH_SHORT).show()
    }

    Column(modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            placeholder = { Text("Имя чемпиона") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Palette.muted) },
            trailingIcon = {
                if (query.text.isNotEmpty()) {
                    IconButton(onClick = { onQueryChange(TextFieldValue("")) }) {
                        Icon(Icons.Filled.Close, contentDescription = "Очистить")
                    }
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { if (query.text.isNotBlank()) result.ids.firstOrNull()?.let(::open) }),
            shape = RoundedCornerShape(28.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Palette.s1,
                unfocusedContainerColor = Palette.s1,
                focusedBorderColor = Palette.primary,
                unfocusedBorderColor = Palette.line,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 4.dp)
                .focusRequester(focus),
        )

        val byId = pack.championsById
        LazyVerticalGrid(
            state = gridState,
            columns = GridCells.Adaptive(TILE_MIN),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (query.text.isBlank()) {
                val recentChamps = recent.mapNotNull { byId[it] }
                if (recentChamps.isNotEmpty()) {
                    label("Недавние")
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        // One row of the columns GridCells.Adaptive picks, so the tiles sit over the grid. A scrolling row
                        // of exactly fitting tiles gave no hint that more recents were hidden past the edge.
                        BoxWithConstraints {
                            val columns = (maxWidth / TILE_MIN).toInt().coerceAtLeast(1)
                            val cell = maxWidth / columns
                            Row {
                                recentChamps.take(columns).forEach { c ->
                                    Tile(pack, c, "", first = false, Modifier.width(cell)) { open(c.id) }
                                }
                            }
                        }
                    }
                    label("Все чемпионы")
                }
                items(sorted, key = { it.id }) { c -> Tile(pack, c, "", first = false) { open(c.id) } }
            } else {
                if (result.swapped) note("Показаны результаты для «${result.query}»")
                if (result.ids.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Чемпион не найден", fontSize = 16.sp, color = Palette.on)
                            Spacer(Modifier.height(6.dp))
                            Text("Проверьте имя и раскладку клавиатуры", fontSize = 13.sp, color = Palette.muted)
                        }
                    }
                }
                val highlight = Search.norm(result.query)
                items(result.ids.mapNotNull { byId[it] }, key = { it.id }) { c ->
                    Tile(pack, c, highlight, first = c.id == result.ids.first()) { open(c.id) }
                }
            }
            if (appUpdateNeeded) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "Есть новая версия приложения",
                        color = Palette.primary,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = BuildConfig.RELEASES_URL.isNotBlank()) {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.RELEASES_URL)))
                            }
                            .padding(12.dp),
                    )
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(RIOT_NOTICE, color = Palette.faint, fontSize = 10.sp, lineHeight = 13.sp, modifier = Modifier.padding(12.dp))
            }
        }
    }
}

private val TILE_MIN = 78.dp

private fun LazyGridScope.label(text: String) = item(span = { GridItemSpan(maxLineSpan) }) {
    Text(text, color = Palette.muted, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp, top = 4.dp))
}

private fun LazyGridScope.note(text: String) = item(span = { GridItemSpan(maxLineSpan) }) {
    Text(text, color = Palette.muted, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp))
}

@Composable
private fun Tile(pack: LoadedPack, c: Champion, highlight: String, first: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val hasGuide = pack.data.guides.containsKey(c.id)
    Column(
        modifier
            .clickable(onClick = onClick)
            .padding(vertical = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val shape = RoundedCornerShape(14.dp)
        val ring = if (first) Modifier.border(2.dp, Palette.primary, RoundedCornerShape(17.dp)).padding(4.dp) else Modifier.padding(4.dp)
        PackIcon(pack, c.icon, ring.size(64.dp), shape, grey = !hasGuide)
        // A one-word name shrinks to fit its line instead of breaking mid-word («Хеймердинг / ер»).
        // The 7 sp floor is reached only with large fonts: at scale 1.3 a 411 dp phone's five columns need about 8 sp.
        BasicText(
            highlighted(c.name, highlight),
            style = TextStyle(color = if (hasGuide) Palette.on else Palette.faint, lineHeight = 15.sp, textAlign = TextAlign.Center),
            maxLines = if (' ' in c.name) 2 else 1,
            overflow = TextOverflow.Ellipsis,
            autoSize = TextAutoSize.StepBased(minFontSize = 7.sp, maxFontSize = 12.sp, stepSize = 0.5.sp),
            modifier = Modifier.padding(horizontal = 2.dp),
        )
    }
}

private fun highlighted(name: String, q: String) = buildAnnotatedString {
    val low = name.lowercase().replace('ё', 'е')
    val i = if (q.isEmpty()) -1 else low.indexOf(q)
    if (i < 0) {
        append(name)
    } else {
        append(name.substring(0, i))
        withStyle(SpanStyle(color = Palette.primary, fontWeight = FontWeight.Bold)) { append(name.substring(i, i + q.length)) }
        append(name.substring(i + q.length))
    }
}
