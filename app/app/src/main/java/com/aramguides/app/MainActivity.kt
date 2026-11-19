package com.aramguides.app

import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aramguides.app.ui.AramTheme
import com.aramguides.app.ui.GuideScreen
import com.aramguides.app.ui.Palette
import com.aramguides.app.ui.SearchScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dark UI on any system theme: light status and navigation bar icons.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        setContent { AramTheme { CompositionLocalProvider(LocalContentColor provides Palette.on) { App(vm) } } }
    }

    override fun onResume() {
        super.onResume()
        vm.checkUpdates()
    }
}

@Composable
fun App(vm: AppViewModel) {
    // Keeps each champion's situation, tab and scroll positions while the app lives and across process death.
    val holder = rememberSaveableStateHolder()
    Box(
        Modifier
            .fillMaxSize()
            .background(Palette.bg)
            .safeDrawingPadding(),
    ) {
        val pack = vm.pack
        val error = vm.loadError
        val champion = vm.openChampion
        val guidePack = vm.guidePack
        when {
            error != null -> Text(
                "Не удалось открыть гайды: $error",
                color = Palette.muted,
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
            )
            pack == null -> Unit
            champion != null && guidePack != null -> holder.SaveableStateProvider("guide:$champion") {
                GuideScreen(guidePack, champion, onBack = vm::closeGuide)
            }
            else -> holder.SaveableStateProvider("search") {
                LaunchedEffect(Unit) { vm.selectQueryOnReturn = false }
                SearchScreen(
                    pack = pack,
                    query = vm.query,
                    onQueryChange = vm::onQueryChange,
                    recent = vm.recent,
                    appUpdateNeeded = vm.appUpdateNeeded,
                    onOpen = vm::openGuide,
                )
            }
        }
    }
}
