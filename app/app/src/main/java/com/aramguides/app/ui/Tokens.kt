package com.aramguides.app.ui

sealed interface Piece {
    data class Text(val text: String) : Piece
    data class AbilityRef(val key: String) : Piece
}

/** Splits guide text into plain runs and {P}{Q}{W}{E}{R} ability tokens. */
object Tokens {
    private val TOKEN = Regex("\\{([PQWER])\\}")

    fun parse(s: String): List<Piece> {
        val out = mutableListOf<Piece>()
        var last = 0
        for (m in TOKEN.findAll(s)) {
            if (m.range.first > last) out += Piece.Text(s.substring(last, m.range.first))
            out += Piece.AbilityRef(m.groupValues[1])
            last = m.range.last + 1
        }
        if (last < s.length) out += Piece.Text(s.substring(last))
        return out
    }
}
