package com.aramguides.app.pack

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File
import java.util.zip.ZipFile

/**
 * Content packs live in filesDir/packs as pack-<version>.zip. The file `active` names the
 * pack in use; it is replaced atomically, so a crash mid-update never leaves a broken pointer.
 */
class PackStore(private val context: Context) {
    val dir = File(context.filesDir, "packs").apply { mkdirs() }
    private val pointer = File(dir, "active")
    private val prefs = context.getSharedPreferences("packs", Context.MODE_PRIVATE)

    fun activeFile(): File? = pointer.takeIf { it.exists() }?.readText()?.trim()?.let { File(dir, it) }?.takeIf { it.exists() }

    fun activate(file: File) {
        val tmp = File(dir, "active.tmp")
        tmp.writeText(file.name)
        if (!tmp.renameTo(pointer)) error("Не удалось переключить пакет")
    }

    /** Copies the APK's pack into filesDir when the APK is new and its pack is newer than the active one. */
    fun installBundledIfNewer() {
        val installed = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        if (prefs.getLong("bundledFor", -1) == installed && activeFile() != null) return
        val tmp = File(dir, "bundled.tmp")
        context.assets.open("pack.zip").use { input -> tmp.outputStream().use { input.copyTo(it) } }
        val bundled = readHeader(tmp)
        val active = activeFile()?.let { runCatching { readHeader(it) }.getOrNull() }
        if (active == null || bundled.version > active.version) {
            val dest = File(dir, "pack-${bundled.version}.zip")
            if (!tmp.renameTo(dest)) error("Не удалось сохранить пакет")
            activate(dest)
        } else {
            tmp.delete()
        }
        prefs.edit().putLong("bundledFor", installed).apply()
    }

    /** Old packs are removed at the next launch, never while a screen may still read them. */
    fun cleanup() {
        val active = activeFile()?.name
        dir.listFiles()?.forEach { f ->
            if (f.name != active && f.name != "active" && (f.name.startsWith("pack-") || f.name.endsWith(".tmp"))) f.delete()
        }
    }

    /** Both writers name the file from a header this build decoded, so the name carries the version. */
    fun activeVersion(): Long? = activeFile()?.name?.removePrefix("pack-")?.removeSuffix(".zip")?.toLongOrNull()

    fun open(): LoadedPack {
        val file = activeFile() ?: error("Нет активного пакета")
        return LoadedPack(file)
    }

    companion object {
        fun readHeader(file: File): Pack = ZipFile(file).use { zip ->
            val entry = zip.getEntry("pack.json") ?: error("В пакете нет pack.json")
            packJson.decodeFromString(Pack.serializer(), zip.getInputStream(entry).bufferedReader().readText())
        }
    }
}

/** One opened pack: its data and lazy icon access straight from the zip. Kept open for the app's lifetime. */
class LoadedPack(val file: File) {
    private val zip = ZipFile(file)
    val data: Pack = zip.getInputStream(zip.getEntry("pack.json")).bufferedReader().use {
        packJson.decodeFromString(Pack.serializer(), it.readText())
    }
    val championsById: Map<String, Champion> = data.champions.associateBy { it.id }

    fun icon(path: String): ImageBitmap? {
        val key = "${file.name}/$path"
        icons.get(key)?.let { return it }
        val entry = zip.getEntry("icons/$path") ?: return null
        val bmp = runCatching { zip.getInputStream(entry).use { BitmapFactory.decodeStream(it) } }.getOrNull() ?: return null
        return bmp.asImageBitmap().also { icons.put(key, it) }
    }

    companion object {
        private val icons = object : LruCache<String, ImageBitmap>(24 * 1024 * 1024) {
            override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
        }
    }
}
