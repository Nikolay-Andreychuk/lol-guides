package com.aramguides.app.pack

import android.content.Context
import com.aramguides.app.BuildConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

sealed interface UpdateResult {
    data object Nothing : UpdateResult
    data class NewPack(val version: Long) : UpdateResult
    data object AppUpdateNeeded : UpdateResult
}

/**
 * Checks the content release for a newer pack. Network errors are silent: the app keeps
 * working with what it has and tries again later.
 */
class Updater(context: Context, private val store: PackStore, private val baseUrl: String = BuildConfig.CONTENT_BASE_URL) {
    private val prefs = context.getSharedPreferences("updater", Context.MODE_PRIVATE)

    val appUpdateNeeded: Boolean get() = prefs.getBoolean("appUpdateNeeded", false)

    fun check(now: Long = System.currentTimeMillis()): UpdateResult {
        if (baseUrl.isBlank()) return UpdateResult.Nothing
        if (now - prefs.getLong("lastCheck", 0) < CHECK_INTERVAL_MS) return UpdateResult.Nothing
        return runCatching { checkNow(now) }.getOrDefault(UpdateResult.Nothing)
    }

    private fun checkNow(now: Long): UpdateResult {
        val conn = (URL("${baseUrl.trimEnd('/')}/$LATEST").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            prefs.getString("etag", null)?.let { setRequestProperty("If-None-Match", it) }
        }
        try {
            if (conn.responseCode == HttpURLConnection.HTTP_NOT_MODIFIED) {
                prefs.edit().putLong("lastCheck", now).apply()
                return UpdateResult.Nothing
            }
            if (conn.responseCode != 200) return UpdateResult.Nothing
            val latest = packJson.decodeFromString(Latest.serializer(), conn.inputStream.bufferedReader().readText())
            if (latest.schema > SUPPORTED_SCHEMA) {
                prefs.edit().putBoolean("appUpdateNeeded", true).putLong("lastCheck", now).apply()
                return UpdateResult.AppUpdateNeeded
            }
            prefs.edit().putBoolean("appUpdateNeeded", false).apply()
            val result = if (latest.version > (store.activeVersion() ?: 0)) download(latest) else UpdateResult.Nothing
            // The ETag is remembered only after the pack it announces is in place.
            prefs.edit().putLong("lastCheck", now).putString("etag", conn.getHeaderField("ETag")).apply()
            return result
        } finally {
            conn.disconnect()
        }
    }

    private fun download(latest: Latest): UpdateResult {
        // The file name comes from the network; it must stay a plain name inside our directory.
        require(SAFE_NAME.matches(latest.file)) { "bad file name" }
        require(latest.size in 1..MAX_PACK_BYTES) { "bad size" }
        val tmp = File(store.dir, "download.tmp")
        val conn = (URL("${baseUrl.trimEnd('/')}/${latest.file}").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 30_000
        }
        try {
            if (conn.responseCode != 200) error("HTTP ${conn.responseCode}")
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > latest.size) error("too large")
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            if (total != latest.size || !sha.equals(latest.sha256, ignoreCase = true)) error("checksum mismatch")
            val header = PackStore.readHeader(tmp)
            if (header.schema != SUPPORTED_SCHEMA || header.version != latest.version) error("pack header mismatch")
            val dest = File(store.dir, "pack-${header.version}.zip")
            if (!tmp.renameTo(dest)) error("rename failed")
            store.activate(dest)
            return UpdateResult.NewPack(header.version)
        } finally {
            conn.disconnect()
            tmp.delete()
        }
    }

    companion object {
        const val LATEST = "latest-aram-ru.json"
        const val CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000L
        const val MAX_PACK_BYTES = 64L * 1024 * 1024
        private val SAFE_NAME = Regex("^[A-Za-z0-9._-]+\\.zip$")
    }
}
