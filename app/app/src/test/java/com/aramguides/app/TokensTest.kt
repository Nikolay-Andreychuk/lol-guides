package com.aramguides.app

import com.aramguides.app.ui.Piece
import com.aramguides.app.ui.Tokens
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
}
