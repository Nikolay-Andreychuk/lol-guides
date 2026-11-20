package com.aramguides.app.search

data class SearchEntry(val id: String, val name: String, val nameEn: String)

data class SearchResult(val ids: List<String>, val query: String, val swapped: Boolean)

/** Champion search: ru/en names, ё = е, punctuation ignored, initials, wrong keyboard layout. */
object Search {
    private const val EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
    private const val RU = "йцукенгшщзхъфывапролджэячсмитьбюё"

    fun norm(s: String): String = s.lowercase().replace('ё', 'е').filter { it in 'a'..'z' || it in 'а'..'я' || it in '0'..'9' }

    /** «Мисс Фортуна» → «мф», «Miss Fortune» → «mf». Single-word names have no initials. */
    fun initials(e: SearchEntry): List<String> = listOf(e.name, e.nameEn).mapNotNull { name ->
        val words = name.split(Regex("[\\s'’.&-]+")).filter { it.isNotBlank() }
        if (words.size > 1) norm(words.joinToString("") { it.take(1) }).takeIf { it.isNotEmpty() } else null
    }

    private fun match(entries: List<SearchEntry>, n: String): List<String> {
        val byInitials = mutableListOf<String>()
        val prefix = mutableListOf<String>()
        val contains = mutableListOf<String>()
        for (e in entries) {
            val keys = listOf(norm(e.name), norm(e.nameEn))
            when {
                initials(e).contains(n) -> byInitials += e.id
                keys.any { it.startsWith(n) } -> prefix += e.id
                keys.any { it.contains(n) } -> contains += e.id
            }
        }
        return byInitials + prefix + contains
    }

    private fun convert(s: String, from: String, to: String) =
        s.lowercase().map { ch -> from.indexOf(ch).let { if (it < 0) ch else to[it] } }.joinToString("")

    fun find(entries: List<SearchEntry>, query: String): SearchResult {
        val n = norm(query)
        if (n.isEmpty()) return SearchResult(entries.map { it.id }, query, false)
        val direct = match(entries, n)
        if (direct.isNotEmpty()) return SearchResult(direct, query, false)
        for (alt in listOf(convert(query, EN, RU), convert(query, RU, EN))) {
            if (alt == query.lowercase()) continue
            val r = match(entries, norm(alt))
            if (r.isNotEmpty()) return SearchResult(r, alt, true)
        }
        return SearchResult(emptyList(), query, false)
    }
}
