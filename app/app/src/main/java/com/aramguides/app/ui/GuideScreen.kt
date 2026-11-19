package com.aramguides.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aramguides.app.pack.Champion
import com.aramguides.app.pack.Guide
import com.aramguides.app.pack.LoadedPack
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val TABS = listOf("Покупка", "Умения", "Советы")
private val TIP_TITLES = listOf(
    "early" to "Начало",
    "mid" to "Середина",
    "late" to "Конец",
    "teamfights" to "Командные бои",
    "mistakes" to "Типичные ошибки",
    "versus" to "Против составов",
)
private val BODY = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, color = Palette.body)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuideScreen(pack: LoadedPack, championId: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val champ = pack.championsById[championId] ?: return
    val guide = pack.data.guides[championId] ?: return
    val abilityIcons = remember(champ) { champ.abilities.orEmpty().mapValues { it.value.icon } }
    var sheetItem by rememberSaveable { mutableStateOf<Int?>(null) }

    Column(Modifier.fillMaxSize()) {
        Header(pack, champ, guide, onBack)

        // The памятка scrolls away with the first upward scroll and comes back when a list is pulled at its top.
        var memoHeight by remember { mutableIntStateOf(0) }
        var memoOffset by rememberSaveable { mutableFloatStateOf(0f) }
        val collapse = remember {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (available.y >= 0) return Offset.Zero
                    val next = (memoOffset + available.y).coerceIn(-memoHeight.toFloat(), 0f)
                    val used = next - memoOffset
                    memoOffset = next
                    return Offset(0f, used)
                }

                override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                    if (available.y <= 0) return Offset.Zero
                    val next = (memoOffset + available.y).coerceIn(-memoHeight.toFloat(), 0f)
                    val used = next - memoOffset
                    memoOffset = next
                    return Offset(0f, used)
                }
            }
        }
        Column(
            Modifier
                .fillMaxSize()
                .nestedScroll(collapse),
        ) {
            Box(
                Modifier
                    .clipToBounds()
                    .layout { measurable, constraints ->
                        val p = measurable.measure(constraints.copy(minHeight = 0))
                        memoHeight = p.height
                        val off = memoOffset.roundToInt().coerceIn(-p.height, 0)
                        layout(p.width, p.height + off) { p.place(0, off) }
                    },
            ) {
                Memo(pack, guide, abilityIcons, onItem = { sheetItem = it })
            }

            val pager = rememberPagerState { TABS.size }
            val scope = rememberCoroutineScope()
            TabRow(
                selectedTabIndex = pager.currentPage,
                containerColor = Palette.bg,
                contentColor = Palette.on,
                indicator = { positions ->
                    TabRowDefaults.SecondaryIndicator(
                        Modifier.tabIndicatorOffset(positions[pager.currentPage]),
                        color = Palette.primary,
                    )
                },
            ) {
                TABS.forEachIndexed { i, title ->
                    Tab(
                        selected = pager.currentPage == i,
                        onClick = { scope.launch { pager.scrollToPage(i) } },
                        text = { Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium) },
                        selectedContentColor = Palette.primary,
                        unselectedContentColor = Palette.muted,
                    )
                }
            }
            HorizontalPager(
                state = pager,
                beyondViewportPageCount = 2,
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.Top,
            ) { page ->
                when (page) {
                    0 -> BuyTab(pack, guide, onItem = { sheetItem = it })
                    1 -> AbilitiesTab(pack, champ, guide, abilityIcons)
                    else -> TipsTab(pack, guide, abilityIcons)
                }
            }
        }
    }

    sheetItem?.let { id ->
        val item = pack.data.items[id.toString()]
        ModalBottomSheet(onDismissRequest = { sheetItem = null }, containerColor = Palette.s1) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 32.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PackIcon(pack, item?.icon, Modifier.size(48.dp), RoundedCornerShape(10.dp))
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(item?.name ?: "Предмет $id", color = Palette.on, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        if (item != null) Text("${item.price} золота", color = Palette.change, fontSize = 13.sp)
                    }
                }
                if (item != null) {
                    Spacer(Modifier.height(12.dp))
                    if (item.removed) {
                        Text("Нет в патче ${pack.data.patch} — в магазине не найти", color = Palette.gone, fontSize = 13.sp)
                        Spacer(Modifier.height(8.dp))
                    }
                    Text(item.description, style = BODY)
                }
            }
        }
    }
}

@Composable
private fun Header(pack: LoadedPack, champ: Champion, guide: Guide, onBack: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(64.dp)
            .padding(end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад") }
        PackIcon(pack, champ.icon, Modifier.size(40.dp), CircleShape)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(champ.name, color = Palette.on, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(champ.roles, color = Palette.muted, fontSize = 12.sp, maxLines = 1)
        }
        val stale = guide.patch != pack.data.patch
        Text(
            if (stale) "Гайд для ${guide.patch}" else "Патч ${guide.patch}",
            color = if (stale) Palette.change else Palette.muted,
            fontSize = 12.sp,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(if (stale) Palette.changeBg else Palette.s2)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun Memo(pack: LoadedPack, guide: Guide, abilityIcons: Map<String, String>, onItem: (Int) -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            MemoGroup("Заклинания") {
                guide.spells.forEach { PackIcon(pack, pack.data.spells[it]?.icon, Modifier.size(32.dp), RoundedCornerShape(8.dp)) }
            }
            MemoGroup("Старт") {
                guide.start.forEach { s ->
                    Box(Modifier.clickable { onItem(s.item) }) {
                        PackIcon(pack, pack.data.items[s.item.toString()]?.icon, Modifier.size(32.dp), RoundedCornerShape(8.dp))
                        if (s.count > 1) {
                            Text(
                                "×${s.count}",
                                color = Palette.on,
                                fontSize = 10.sp,
                                lineHeight = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Palette.canvas.copy(alpha = 0.85f))
                                    .padding(horizontal = 3.dp),
                            )
                        }
                    }
                }
            }
            val sk = guide.skills
            if (sk.mode == "max" || sk.mode == "turn") {
                MemoGroup(if (sk.mode == "max") "Макс. прокачка" else "Прокачка по очереди") {
                    sk.order.forEachIndexed { i, key ->
                        if (i > 0) Text("›", color = Palette.faint, fontSize = 16.sp, modifier = Modifier.align(Alignment.CenterVertically))
                        AbilityBadge(pack, abilityIcons[key], key, Modifier.size(32.dp), letter = true)
                    }
                }
            }
        }
        val note = guide.skills.note ?: if (guide.skills.mode == "special") "Прокачка особая" else null
        if (note != null) {
            Spacer(Modifier.height(8.dp))
            RichText(note, pack, abilityIcons, TextStyle(fontSize = 13.sp, lineHeight = 18.sp, color = Palette.muted))
        }
    }
}

@Composable
private fun MemoGroup(label: String, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Column {
        Text(label, color = Palette.muted, fontSize = 11.sp, maxLines = 1)
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), content = content)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BuyTab(pack: LoadedPack, guide: Guide, onItem: (Int) -> Unit) {
    var sel by rememberSaveable { mutableStateOf(guide.builds.first().key) }
    val build = guide.builds.firstOrNull { it.key == sel } ?: guide.builds.first()
    LazyColumn(Modifier.fillMaxSize(), rememberLazyListState(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            FlowRow(
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                guide.builds.forEach { b ->
                    val on = b.key == build.key
                    FilterChip(
                        selected = on,
                        onClick = { sel = b.key },
                        label = { Text(b.name) },
                        leadingIcon = if (on) {
                            { Icon(Icons.Filled.Check, contentDescription = null, Modifier.size(18.dp)) }
                        } else null,
                        shape = RoundedCornerShape(8.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = Palette.bg,
                            labelColor = Palette.body,
                            selectedContainerColor = Palette.pcont,
                            selectedLabelColor = Palette.onPcont,
                            selectedLeadingIconColor = Palette.onPcont,
                        ),
                    )
                }
            }
        }
        item {
            Text(build.`when`, color = Palette.muted, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        item {
            Text("СБОРКА", color = Palette.faint, fontSize = 11.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
        }
        itemsIndexed(build.items) { i, slot ->
            val item = pack.data.items[slot.item.toString()]
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onItem(slot.item) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${i + 1}", color = Palette.faint, fontSize = 14.sp, modifier = Modifier.width(20.dp))
                PackIcon(pack, item?.icon, Modifier.size(44.dp), RoundedCornerShape(10.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(item?.name ?: "Предмет ${slot.item}", color = Palette.on, fontSize = 15.sp)
                    SlotMark(pack, slot.replaced, slot.usually, i + 1, item?.removed == true)
                }
            }
        }
    }
}

@Composable
private fun SlotMark(pack: LoadedPack, replaced: Int?, usually: Int?, position: Int, removed: Boolean) {
    val style = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
    when {
        removed -> Text("нет в патче ${pack.data.patch} — в магазине не найти", style = style, color = Palette.gone)
        replaced != null -> {
            val was = pack.data.items[replaced.toString()]
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("вместо ", style = style, color = Palette.change)
                PackIcon(pack, was?.icon, Modifier.size(16.dp), RoundedCornerShape(4.dp))
                Text(" ${was?.name ?: replaced}", style = style, color = Palette.change)
            }
        }
        usually != null && usually != position -> Text(
            if (position < usually) "↑ раньше, обычно $usually-й" else "↓ позже, обычно $usually-й",
            style = style,
            color = Palette.change,
        )
    }
}

@Composable
private fun AbilitiesTab(pack: LoadedPack, champ: Champion, guide: Guide, abilityIcons: Map<String, String>) {
    LazyColumn(Modifier.fillMaxSize(), rememberLazyListState(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (guide.combo.isNotEmpty()) {
            item {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Palette.s1)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Комбо и главное", color = Palette.on, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    guide.combo.forEach { RichText(it, pack, abilityIcons, BODY) }
                }
            }
        }
        listOf("P", "Q", "W", "E", "R").forEach { key ->
            val text = guide.abilities[key] ?: return@forEach
            item(key = key) {
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    AbilityBadge(pack, abilityIcons[key], key, Modifier.size(44.dp), letter = true)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(champ.abilities?.get(key)?.name ?: abilityLetter(key), color = Palette.on, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(2.dp))
                        RichText(text, pack, abilityIcons, BODY)
                    }
                }
            }
        }
    }
}

@Composable
private fun TipsTab(pack: LoadedPack, guide: Guide, abilityIcons: Map<String, String>) {
    LazyColumn(Modifier.fillMaxSize(), rememberLazyListState(), contentPadding = PaddingValues(16.dp)) {
        tipSections(pack, guide, abilityIcons)
    }
}

private fun LazyListScope.tipSections(pack: LoadedPack, guide: Guide, abilityIcons: Map<String, String>) {
    TIP_TITLES.forEach { (key, title) ->
        val text = guide.tips[key]?.takeIf { it.isNotBlank() } ?: return@forEach
        item(key = key) {
            Column(Modifier.padding(bottom = 16.dp)) {
                Text(title, color = Palette.on, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                RichText(text, pack, abilityIcons, BODY)
            }
        }
    }
}
