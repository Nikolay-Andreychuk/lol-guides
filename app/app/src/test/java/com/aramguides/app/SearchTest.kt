package com.aramguides.app

import com.aramguides.app.search.Search
import com.aramguides.app.search.SearchEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchTest {
    private val entries = listOf(
        SearchEntry("Ahri", "Ари", "Ahri"),
        SearchEntry("Akali", "Акали", "Akali"),
        SearchEntry("MissFortune", "Мисс Фортуна", "Miss Fortune"),
        SearchEntry("TwistedFate", "Твистед Фэйт", "Twisted Fate"),
        SearchEntry("KogMaw", "Ког'Мао", "Kog'Maw"),
        SearchEntry("Seraphine", "Серафина", "Seraphine"),
        SearchEntry("Test", "Тёмный", "Dark One"),
        SearchEntry("Karthus", "Картус", "Karthus"),
    )

    private fun ids(q: String) = Search.find(entries, q).ids

    @Test fun ruPrefix() = assertEquals("Ahri", ids("ари").first())
    @Test fun enPrefix() = assertEquals("Ahri", ids("ah").first())
    @Test fun initialsRu() = assertEquals("MissFortune", ids("мф").first())
    @Test fun initialsEn() = assertEquals("MissFortune", ids("mf").first())
    @Test fun initialsTf() = assertEquals("TwistedFate", ids("тф").first())
    @Test fun apostropheIgnored() = assertEquals(listOf("KogMaw"), ids("когмао"))
    @Test fun spacesIgnored() = assertEquals("MissFortune", ids("мисс фор").first())
    @Test fun yoEqualsYe() = assertEquals(listOf("Test"), ids("темн"))
    @Test fun yoInQuery() = assertEquals(listOf("Test"), ids("тёмн"))

    @Test fun wrongLayout() {
        val r = Search.find(entries, "fhb")
        assertTrue(r.swapped)
        assertEquals("ари", r.query)
        assertEquals("Ahri", r.ids.first())
    }

    @Test fun prefixBeforeSubstring() {
        // «ка»: Картус and Акали... Картус starts with it, Акали only contains it.
        val r = ids("ка")
        assertTrue(r.indexOf("Karthus") < r.indexOf("Akali"))
    }

    @Test fun emptyQueryShowsAll() = assertEquals(entries.size, ids("").size)

    @Test fun nothingFound() {
        val r = Search.find(entries, "zzzz")
        assertTrue(r.ids.isEmpty())
        assertFalse(r.swapped)
    }
}
