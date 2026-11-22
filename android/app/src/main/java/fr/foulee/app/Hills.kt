package fr.foulee.app

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Hill repeats, read from the elevation curve when the watch has no laps to say so (a session of "10 hills" recorded as one single lap).
 * Elevation is smoothed over three points, then cut into climbs (a rise of at least [MIN_GAIN] metres between a low and the next high, the high being
 * the top of the first [WINDOW] seconds: a slope that keeps rising gently is not a repeat). A hill session is the longest run of at least [MIN_REPS]
 * consecutive climbs that look alike (gain within 50 % of the median, duration within 50 %, a regular rhythm from one start to the next, no long pause).
 * Only used when the laps give no interval session: laps always win.
 */
object Hills {
    private const val MIN_GAIN = 5.0
    private const val MAX_GAIN = 80.0
    private const val MIN_SECONDS = 12.0
    private const val MAX_SECONDS = 240.0
    private const val WINDOW = 150.0
    private const val MARGIN = 1.5
    private const val LEAD_IN = 60.0
    private const val MIN_REPS = 5
    private const val NBSP = "\u00a0"

    /** [start] and [end] in seconds, [gain] in metres, [meters] the distance run up the hill when the curve has distances */
    class Climb(val start: Double, val end: Double, val gain: Double, val meters: Double? = null) { val seconds get() = end - start }

    private fun median(v: List<Double>): Double {
        val s = v.sorted()
        val m = s.size / 2
        return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2
    }

    private fun smooth(e: List<Double>) = e.indices.map { i -> val w = e.subList(maxOf(0, i - 1), minOf(e.size, i + 2)); w.sum() / w.size }

    /** The successive lows and highs at least [h] metres apart: (index, isHigh) */
    private fun pivots(e: List<Double>, h: Double = MIN_GAIN): List<Pair<Int, Boolean>> {
        val out = mutableListOf<Pair<Int, Boolean>>()
        var dir = 0
        var mn = 0
        var mx = 0
        for (i in 1 until e.size) {
            when (dir) {
                0 -> if (e[i] - e[mn] >= h) { out += mn to false; dir = 1; mx = i }
                else if (e[mx] - e[i] >= h) { out += mx to true; dir = -1; mn = i }
                else { if (e[i] < e[mn]) mn = i; if (e[i] > e[mx]) mx = i }
                1 -> if (e[i] > e[mx]) mx = i else if (e[mx] - e[i] >= h) { out += mx to true; dir = -1; mn = i }
                else -> if (e[i] < e[mn]) mn = i else if (e[i] - e[mn] >= h) { out += mn to false; dir = 1; mx = i }
            }
        }
        if (dir == 1) out += mx to true else if (dir == -1) out += mn to false
        return out
    }

    fun climbs(samples: List<Sample>): List<Climb> {
        val pts = samples.filter { it.t != null && it.ele != null }
        if (pts.size < 30) return emptyList()
        val t = pts.map { it.t!! }
        val d = pts.map { it.d }
        val e = smooth(pts.map { it.ele!! })
        val p = pivots(e)
        val out = mutableListOf<Climb>()
        for (k in 0 until p.size - 1) {
            val (i, aHigh) = p[k]
            val (j, bHigh) = p[k + 1]
            if (!aHigh && bHigh) {
                // After a long flat (more than LEAD_IN seconds) the climb starts at the last point still within MARGIN metres of the low: the flat is not part of it
                var st = i
                for (x in i..j) if (e[x] <= e[i] + MARGIN) st = x
                if (t[st] - t[i] <= LEAD_IN) st = i
                var top = st
                for (x in st..j) if (t[x] - t[st] <= WINDOW && e[x] > e[top]) top = x
                val run = if (d[st] != null && d[top] != null) d[top]!! - d[st]!! else null
                out += Climb(t[st], t[top], e[top] - e[st], run)
            }
        }
        return out
    }

    /** The longest run of climbs that look alike, or empty */
    fun bestRun(climbs: List<Climb>): List<Climb> {
        var best = emptyList<Climb>()
        for (s in climbs.indices) for (f in s + MIN_REPS..climbs.size) {
            val seg = climbs.subList(s, f)
            if (seg.size <= best.size) continue
            val gain = median(seg.map { it.gain })
            val dur = median(seg.map { it.seconds })
            val alike = seg.all { abs(it.gain - gain) <= 0.5 * gain && abs(it.seconds - dur) <= 0.5 * dur && it.gain in MIN_GAIN..MAX_GAIN && it.seconds in MIN_SECONDS..MAX_SECONDS }
            if (!alike) continue
            val gaps = (0 until seg.size - 1).map { seg[it + 1].start - seg[it].start }
            val gap = median(gaps)
            if (gaps.all { abs(it - gap) <= 0.4 * gap } && gap <= 4 * dur + 60) best = seg
        }
        return best
    }

    private fun seconds(s: Int) = if (s < 60) "$s${NBSP}s" else "${s / 60}${NBSP}min" + if (s % 60 != 0) "${NBSP}${(s % 60).toString().padStart(2, '0')}" else ""

    /** A hill's length rounded the way one calls it: to 10 m under 75 m, to 50 m up to 950 m, to 100 m beyond (111 m is "100 m") */
    private fun roundLength(m: Double): Int {
        val step = if (m < 75) 10 else if (m < 950) 50 else 100
        return maxOf(step, (m / step).roundToInt() * step)
    }

    /** "10 × côte de 100 m (39 s, +10 m)", or null when the curve shows no hill repeats. Without distances in the curve: "10 × côte de 10 m (39 s)". */
    fun title(samples: List<Sample>): String? {
        val run = bestRun(climbs(samples))
        if (run.isEmpty()) return null
        val gain = median(run.map { it.gain }).roundToInt()
        val dur = seconds(median(run.map { it.seconds }).roundToInt())
        val lengths = run.mapNotNull { it.meters }
        if (lengths.size * 10 >= run.size * 6) return "${run.size} × côte de ${roundLength(median(lengths))}${NBSP}m ($dur, +$gain${NBSP}m)"
        return "${run.size} × côte de $gain${NBSP}m ($dur)"
    }
}
