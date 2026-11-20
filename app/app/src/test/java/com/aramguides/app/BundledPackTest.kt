package com.aramguides.app

import com.aramguides.app.pack.PackStore
import com.aramguides.app.pack.SUPPORTED_SCHEMA
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pipeline (pipeline/pack.ts) and the app (pack/Models.kt) each define the pack format.
 * Decoding the pack this APK ships catches a format change that missed the schema bump.
 */
class BundledPackTest {
    @Test
    fun bundledPackDecodesWithThisSchema() {
        val pack = PackStore.readHeader(File("src/main/assets/pack.zip"))
        assertEquals(SUPPORTED_SCHEMA, pack.schema)
        assertTrue(pack.guides.isNotEmpty())
    }
}
