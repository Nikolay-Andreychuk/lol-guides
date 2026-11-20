package com.aramguides.app.pack

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Declares only the pack fields the app reads (pipeline/pack.ts writes more). Bump SUPPORTED_SCHEMA
// together with PACK_SCHEMA there when a field declared here is removed or changes type.
const val SUPPORTED_SCHEMA = 1

val packJson = Json { ignoreUnknownKeys = true }

@Serializable
data class Pack(
    val schema: Int,
    val version: Long,
    val patch: String,
    val champions: List<Champion>,
    val items: Map<String, Item>,
    val spells: Map<String, Spell>,
    val guides: Map<String, Guide>,
)

@Serializable
data class Champion(
    val id: String,
    val name: String,
    val nameEn: String,
    val roles: String,
    val icon: String,
    val abilities: Map<String, Ability>? = null,
)

@Serializable
data class Ability(val name: String, val icon: String)

@Serializable
data class Item(val name: String, val price: Int, val description: String, val icon: String, val removed: Boolean = false)

@Serializable
data class Spell(val icon: String)

@Serializable
data class Guide(
    val patch: String,
    val spells: List<String>,
    val start: List<StartItem>,
    val builds: List<Build>,
    val skills: Skills,
    val combo: List<String>,
    val abilities: Map<String, String>,
    val tips: Map<String, TipSection>,
)

@Serializable
data class TipSection(val intro: String? = null, val points: List<String>)

@Serializable
data class StartItem(val item: Int, val count: Int)

@Serializable
data class Build(val key: String, val name: String, val `when`: String, val items: List<Slot>)

@Serializable
data class Slot(val item: Int, val replaced: Int? = null, val usually: Int? = null)

@Serializable
data class Skills(val mode: String, val order: List<String>, val note: String? = null)

/** latest-<mode>-<lang>.json on the content release. */
@Serializable
data class Latest(val schema: Int, val version: Long, val file: String, val size: Long, val sha256: String)
