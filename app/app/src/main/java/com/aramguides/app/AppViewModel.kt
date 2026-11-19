package com.aramguides.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.aramguides.app.pack.LoadedPack
import com.aramguides.app.pack.PackStore
import com.aramguides.app.pack.UpdateResult
import com.aramguides.app.pack.Updater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AppViewModel(app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {
    private val store = PackStore(app)
    private val updater = Updater(app, store)
    private val updateLock = Mutex()
    private val prefs = app.getSharedPreferences("app", Application.MODE_PRIVATE)

    /** The newest pack; search uses it. */
    var pack by mutableStateOf<LoadedPack?>(null)
        private set

    /** The pack the open guide was opened with: an update never changes a guide while it is read. */
    var guidePack by mutableStateOf<LoadedPack?>(null)
        private set

    var loadError by mutableStateOf<String?>(null)
        private set
    var appUpdateNeeded by mutableStateOf(false)
        private set

    var openChampion by mutableStateOf(saved.get<String>("champion"))
        private set

    var query by mutableStateOf(TextFieldValue(saved.get<String>("query").orEmpty()))
        private set

    /** Set when returning from a guide: the search field selects the old query so typing replaces it. */
    var selectQueryOnReturn by mutableStateOf(false)

    var recent by mutableStateOf(prefs.getString("recent", "").orEmpty().split(",").filter { it.isNotBlank() })
        private set

    init {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                store.installBundledIfNewer()
                store.cleanup()
                val p = store.open()
                withContext(Dispatchers.Main) {
                    pack = p
                    if (openChampion != null) guidePack = p
                    appUpdateNeeded = updater.appUpdateNeeded
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { loadError = e.message ?: e.toString() }
                return@launch
            }
            checkUpdates()
        }
    }

    fun checkUpdates() {
        if (pack == null) return
        viewModelScope.launch(Dispatchers.IO) {
            updateLock.withLock {
                when (updater.check()) {
                    is UpdateResult.NewPack -> {
                        val p = runCatching { store.open() }.getOrNull() ?: return@withLock
                        withContext(Dispatchers.Main) { pack = p }
                    }
                    UpdateResult.AppUpdateNeeded -> withContext(Dispatchers.Main) { appUpdateNeeded = true }
                    UpdateResult.Nothing -> Unit
                }
            }
        }
    }

    fun onQueryChange(v: TextFieldValue) {
        query = v
        saved["query"] = v.text
    }

    fun openGuide(id: String) {
        val p = pack ?: return
        openChampion = id
        saved["champion"] = id
        guidePack = p
        recent = (listOf(id) + recent.filter { it != id }).take(12)
        prefs.edit().putString("recent", recent.joinToString(",")).apply()
    }

    fun closeGuide() {
        openChampion = null
        saved["champion"] = null
        guidePack = null
        if (query.text.isNotEmpty()) query = query.copy(selection = TextRange(0, query.text.length))
        selectQueryOnReturn = true
    }
}
