package fr.foulee.app

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** The "Charge globale" of a moment, on 20, and what it is made of. */
class GlobalCore(
    val note: Double,
    /** Training load of the last days over the usual one (heart-rate load of every sport, 7 days over 42 days) */
    val trainingRatio: Double,
    /** Running kilometres of the last days over the usual ones, null when there is not enough running behind */
    val volumeRatio: Double?,
    /** The two together, before the recovery */
    val ratio: Double,
    /** 0 (recovering as usual) to 1 (clearly not recovering) */
    val deficit: Double,
    /** The recovery signals that count against him (name, 0 to 2) */
    val unfavorable: List<Pair<String, Double>>,
    /** The night of that day is on the phone */
    val hasNight: Boolean,
    /** The watch gave anything at all that day (a night, a resting heart rate, steps): false only when it was not synced */
    val hasWatch: Boolean,
)

/**
 * The global load: how much he loads against what his body is used to take, and whether he takes it.
 *
 * 1. Two daily loads: w, the heart-rate load (Banister TRIMP) of every sport with a heart rate, and k, the running kilometres.
 * 2. Each one has a short average (7 days) and a long one (42 days), exponentially weighted and on the scale of a week.
 * 3. R = (short w / long w)^0.6 x (short k / long k)^0.4: the heart-rate load sees the intensity, the kilometres the volume that is easy. Under
 *    5 km a week of long average, R is the heart-rate ratio alone.
 * 4. Recovery deficit D, 0 to 1: the means over 7 nights (at least 4) of ln(HRV), resting heart rate and sleep are compared with the same means over
 *    the days 8 to 63 before; only the unfavourable gaps count, beyond half a standard deviation, each capped at 2.
 * 5. Rs = R x (1 + 0.20 x D x s), s = how far R is above 1 (0 at 1.0, 1 at 1.2): the recovery only weighs when he loads above his habit, and a good
 *    recovery never lowers the value under what the load alone says.
 * 6. A fixed scale turns Rs into a note: 0 = 0, 0.60 = 5, 0.85 = 9, 1.05 = 13, 1.40 = 17, 1.80 = 20. Nothing is calibrated on the history: a value of the
 *    past never changes because of what came later.
 *
 * The weights and bounds are orders of magnitude from the literature and from the first runs on his own data, not measured constants.
 */
class GlobalLoadModel(activities: List<ActivityRow>, daily: List<DailyRow>, refs: HrRefs, today: LocalDate) {
    private val byDay = activities.filter { it.id > 0 }.groupBy { it.startLocal.take(10) }
    private val first: LocalDate? = byDay.keys.minOrNull()?.let(LocalDate::parse)
    private val days: Int = first?.let { (ChronoUnit.DAYS.between(it, today) + 1).toInt() } ?: 0
    private val dailyBy = daily.associateBy { it.date }

    // Per day: heart-rate load and running kilometres, then the two averages of each, as running sums (the scale comes at the end)
    private val trimpDay = DoubleArray(days)
    private val kmDay = DoubleArray(days)
    private val shortW = DoubleArray(days)
    private val longW = DoubleArray(days)
    private val shortK = DoubleArray(days)
    private val longK = DoubleArray(days)
    private val trimps = HashMap<Long, Double>()

    init {
        val f = first
        if (f != null) {
            for ((date, list) in byDay) {
                val i = ChronoUnit.DAYS.between(f, LocalDate.parse(date)).toInt()
                if (i !in 0 until days) continue
                for (a in list) {
                    val t = Insights.trimp(a, refs) ?: 0.0
                    trimps[a.id] = t
                    trimpDay[i] += t
                    if (a.isRun) kmDay[i] += (a.distance ?: 0.0) / 1000
                }
            }
            for (i in 0 until days) {
                shortW[i] = trimpDay[i] + (if (i > 0) shortW[i - 1] else 0.0) * F_SHORT
                longW[i] = trimpDay[i] + (if (i > 0) longW[i - 1] else 0.0) * F_LONG
                shortK[i] = kmDay[i] + (if (i > 0) shortK[i - 1] else 0.0) * F_SHORT
                longK[i] = kmDay[i] + (if (i > 0) longK[i - 1] else 0.0) * F_LONG
            }
        }
    }

    private val cache = HashMap<String, GlobalCore?>()

    /** The value of a whole day (all its sessions). */
    fun on(date: String): GlobalCore? = cache.getOrPut(date) { compute(date, null) }

    /** The value right after a session: the sessions of the day up to and including that one. */
    fun after(a: ActivityRow): GlobalCore? = compute(a.startLocal.take(10), a)

    private fun compute(date: String, upTo: ActivityRow?): GlobalCore? {
        val f = first ?: return null
        val d = LocalDate.parse(date)
        val i = ChronoUnit.DAYS.between(f, d).toInt()
        // Not enough history for a long average of 6 weeks
        if (i < MIN_DAYS || i >= days) return null
        var sw = shortW[i]; var lw = longW[i]; var sk = shortK[i]; var lk = longK[i]
        if (upTo != null) {
            val sameDay = byDay[date].orEmpty().filter { it.startLocal <= upTo.startLocal }
            val w = sameDay.sumOf { trimps[it.id] ?: 0.0 }
            val k = sameDay.filter { it.isRun }.sumOf { (it.distance ?: 0.0) / 1000 }
            sw = w + shortW[i - 1] * F_SHORT; lw = w + longW[i - 1] * F_LONG
            sk = k + shortK[i - 1] * F_SHORT; lk = k + longK[i - 1] * F_LONG
        }
        val a = sw * SCALE_SHORT; val c = lw * SCALE_LONG
        val ak = sk * SCALE_SHORT; val ck = lk * SCALE_LONG
        if (c <= 0) return null
        val training = a / c
        val volume = if (ck >= MIN_LONG_KM && ak > 0) ak / ck else null
        val ratio = if (volume != null) training.pow(0.6) * volume.pow(0.4) else training

        val dv = unfavourable(d, 1.0, 0.04) { it.hrvNight?.takeIf { v -> v > 0 }?.let { v -> ln(v) } }
        val df = unfavourable(d, -1.0, 0.8) { it.restingHr }
        val ds = unfavourable(d, 1.0, 0.25) { it.sleepSeconds?.let { s -> s / 3600 } }
        val deficit = ((0.40 * dv + 0.35 * df + 0.25 * ds) / 1.5).coerceIn(0.0, 1.0)
        val rs = ratio * (1 + 0.20 * deficit * ((ratio - 1) / 0.2).coerceIn(0.0, 1.0))
        val row = dailyBy[date]
        val night = row?.let { it.sleepSeconds != null || it.hrvNight != null } == true
        val watch = row?.let { it.sleepSeconds != null || it.hrvNight != null || it.restingHr != null || it.steps != null || it.avgStress != null } == true
        return GlobalCore(
            round1(scale(rs)), training, volume, ratio, deficit,
            listOf("VFC" to dv, "FC de repos" to df, "Sommeil" to ds).filter { it.second > 0 }, night, watch,
        )
    }

    /**
     * How unfavourable the last 7 nights are against the days 8 to 63 before them, in standard deviations beyond half of one, 0 to 2 (0 without enough
     * nights, or without enough history). [sign]: +1 when lower is worse (HRV, sleep), -1 when higher is worse (resting heart rate).
     */
    private fun unfavourable(date: LocalDate, sign: Double, floor: Double, signal: (DailyRow) -> Double?): Double {
        fun rolling(end: LocalDate): Double? {
            val values = (0..6).mapNotNull { dailyBy[end.minusDays(it.toLong()).toString()]?.let(signal) }
            return if (values.size >= 4) values.average() else null
        }
        val now = rolling(date) ?: return 0.0
        val base = (8..63).mapNotNull { rolling(date.minusDays(it.toLong())) }
        if (base.size < 20) return 0.0
        val mean = base.average()
        val sd = max(sqrt(base.sumOf { (it - mean) * (it - mean) } / base.size), floor)
        return (sign * (mean - now) / sd - 0.5).coerceIn(0.0, 2.0)
    }

    companion object {
        private val F_SHORT = exp(-1.0 / 7)
        private val F_LONG = exp(-1.0 / 42)
        private val SCALE_SHORT = 7 * (1 - F_SHORT)
        private val SCALE_LONG = 7 * (1 - F_LONG)
        private const val MIN_DAYS = 28
        private const val MIN_LONG_KM = 5.0
        private val POINTS = listOf(0.0 to 0.0, 0.60 to 5.0, 0.85 to 9.0, 1.05 to 13.0, 1.40 to 17.0, 1.80 to 20.0)

        /** The fixed scale: linear between the points, 20 at the top. */
        fun scale(rs: Double): Double {
            if (rs <= 0) return 0.0
            for ((p, q) in POINTS.zipWithNext()) if (rs <= q.first) return p.second + (q.second - p.second) * (rs - p.first) / (q.first - p.first)
            return 20.0
        }

        private fun round1(v: Double) = (v * 10).roundToInt() / 10.0
    }
}
