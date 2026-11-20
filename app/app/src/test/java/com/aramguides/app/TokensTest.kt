package com.aramguides.app

import com.aramguides.app.ui.Piece
import com.aramguides.app.ui.Tokens
import com.aramguides.app.ui.boldMarked
import org.junit.Assert.assertEquals
import org.junit.Test

class TokensTest {
    @Test fun mixed() = assertEquals(
        listOf(Piece.AbilityRef("E"), Piece.Text(" → "), Piece.AbilityRef("Q"), Piece.Text(": очарование")),
        Tokens.parse("{E} → {Q}: очарование"),
    )

    @Test fun plain() = assertEquals(listOf(Piece.Text("без токенов")), Tokens.parse("без токенов"))

    @Test fun passive() = assertEquals(listOf(Piece.Text("пассивка "), Piece.AbilityRef("P")), Tokens.parse("пассивка {P}"))

    @Test fun unknownTokenStaysText() = assertEquals(listOf(Piece.Text("{X} и {q}")), Tokens.parse("{X} и {q}"))

    @Test fun empty() = assertEquals(emptyList<Piece>(), Tokens.parse(""))

    @Test fun boldMarkers() {
        val text = boldMarked("60 силы\n\n**Мучения**\nПоджигает.")
        assertEquals("60 силы\n\nМучения\nПоджигает.", text.text)
        assertEquals("Мучения", text.spanStyles.single().let { text.text.substring(it.start, it.end) })
    }
}
