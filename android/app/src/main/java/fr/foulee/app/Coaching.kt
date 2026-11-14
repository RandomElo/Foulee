package fr.foulee.app

import java.time.DayOfWeek
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.roundToInt

/** One band of the global load (on 20): the term of training it stands for. */
class LoadZone(val index: Int, val label: String, val from: Double, val to: Double, val meaning: String)

object LoadZones {
    private val labels = listOf("Sous-entraînement", "Entraînement léger", "Maintien", "Progression", "Surcharge")
    private val meanings = listOf(
        "Charge très basse : si ça dure, tu perds un peu de forme.",
        "Semaine allégée : bonne pour récupérer, peu de progrès.",
        "Tu entretiens ta forme sans la pousser.",
        "Une charge qui fait progresser et que tu absorbes bien.",
        "Tu charges plus que tu ne récupères : surveille ta forme et allège les prochains jours.",
    )

    /** Upper limits of the first four zones; the last one runs to 20. */
    val bounds = listOf(5.0, 9.0, 13.0, 17.0)

    val all: List<LoadZone> = labels.indices.map { i -> LoadZone(i, labels[i], if (i == 0) 0.0 else bounds[i - 1], if (i == bounds.size) 20.0 else bounds[i], meanings[i]) }

    fun of(value: Double): LoadZone = all[bounds.count { value >= it }]
}

/**
 * The short remark that replaces the former mark of an interval session: only what was not great, with its likely cause when the context of the
 * day (sleep, resting heart rate, heat, rest) explains it. Null when there is nothing to say.
 */
object SessionRemark {
    private fun cause(c: Contribution) = when (c.key) {
        "sleep" -> "une nuit courte"
        "sleepScore" -> "une mauvaise nuit"
        "hrv" -> "une VFC basse"
        "restingHr" -> "une FC de repos élevée"
        "bodyBattery" -> "une Body Battery basse"
        "stress" -> "une journée stressante"
        "fatigue" -> "de la fatigue accumulée"
        "rest" -> "peu de récupération depuis la dernière séance dure"
        "heat" -> "la chaleur"
        else -> null
    }

    /** 3:36 /km written "3 min 36 / km", like the rest of his Strava texts. */
    private fun pace(speed: Double): String {
        val s = Math.round(1000 / speed).toInt()
        return "${s / 60} min ${(s % 60).toString().padStart(2, '0')} / km"
    }

    fun of(sa: SessionAnalysis?): String? {
        if (sa == null) return null
        val why = sa.contributions.filter { it.effectPct < 0 }.firstNotNullOfOrNull { c -> cause(c) }
        val sentences = mutableListOf<String>()
        // His fastest and his slowest rep of the main group: they may wander by 6 % of the pace on long reps, 12 % on reps under 2 minutes (GPS and the
        // start of a short rep make a few seconds per km mean nothing)
        val main = sa.reps.filter { it.group == sa.mainGroupIndex }.takeIf { it.size >= 3 }
        val fastest = main?.maxOf { it.speed }
        val slowest = main?.minOf { it.speed }
        val spreadSeconds = if (fastest != null && slowest != null) Math.round(1000 / slowest - 1000 / fastest).toInt() else 0
        val tolerance = if ((sa.mainRepSeconds ?: 0.0) >= 120) 0.06 else 0.12
        val irregular = fastest != null && slowest != null && spreadSeconds >= 10 && spreadSeconds / (1000 / ((fastest + slowest) / 2)) >= tolerance
        val range = if (fastest != null && slowest != null) "de ${pace(fastest)} à ${pace(slowest)}" else ""
        val fade = sa.fadePct
        if (fade != null && fade <= -4) {
            val first = sa.firstThirdSpeed
            val last = sa.lastThirdSpeed
            sentences += "Tu as trop ralenti à la fin" + (if (first != null && last != null) " (${pace(first)} au début, ${pace(last)} sur la fin)" else "") +
                (if (irregular) ", répétitions $range." else ".")
        } else if (irregular) sentences += "Répétitions irrégulières : $range."
        val hr = sa.hrDelta
        if (hr != null && hr >= 5) sentences += "FC plus haute que d'habitude (+${hr.roundToInt()} bpm)" + (why?.let { ", sûrement à cause de $it" } ?: "") + "."
        else if ((sa.paceDeltaSecPerKm ?: 0) >= 3 && sa.verdict in setOf("below", "hard")) {
            sentences += "Allures plus lentes que d'habitude (+${sa.paceDeltaSecPerKm} s/km)" + (why?.let { ", sûrement à cause de $it" } ?: "") + "."
        }
        sa.hrRecovery?.let { if (it.last - it.first <= -6 && sentences.size < 2) sentences += "Ta FC redescendait moins bien pendant les récups en fin de séance." }
        return sentences.takeIf { it.isNotEmpty() }?.joinToString(" ")
    }
}

/** An interval session of the week: its day, its title without the recoveries, the remark on it and the first sentence of its analysis. */
class WeekInterval(val day: LocalDate, val title: String, val remark: String?, val summary: String?)

/** What a week looked like: the figures, then a small focus on the hard work. [lines] is the text of the Strava description. */
class WeekReview(
    val monday: LocalDate, val km: Double, val sessions: Int, val runs: Int, val lastKm: Double, val load: Double?, val zone: LoadZone?,
    /** The interval sessions of the week */
    val intervals: List<WeekInterval>, val intensePct: Int?,
) {
    fun dayName(d: LocalDate): String = d.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.FRANCE).replaceFirstChar { it.uppercase() }

    val intensityLine: String? get() = intensePct?.let { "$it % du temps en zone 4 ou 5." }

    val lines: List<String>
        get() = buildList {
            add("Bilan de la semaine : ${Fmt.num(km, 0)} km en ${Txt.plural(sessions, "séance")}" + if (lastKm > 0) " (${Fmt.num(lastKm, 0)} km la semaine d'avant)." else ".")
            if (load != null && zone != null) add("Charge globale : ${Fmt.num(load)}/20 (${zone.label}).")
            add("")
            if (intervals.isEmpty()) add("Pas de fractionné cette semaine.")
            else {
                add("Fractionné :")
                intervals.forEachIndexed { i, s ->
                    if (i > 0) add("")
                    add("${dayName(s.day)} : ${StravaTextBuilder.plain(s.title)}")
                    s.remark?.let { add(it) }
                }
            }
            intensityLine?.let { add(""); add(it) }
        }
}

/** "6 × 1000 m (r : 200 m)" becomes "6 × 1000 m": the review shows the efforts, not the recoveries. */
fun withoutRecoveries(title: String) = title.replace(Regex("\\s*\\(r[\\s\u00a0]*:[^)]*\\)"), "")

/** The sessions of a day: a footing right before or after a hard session is its warm-up or cool-down, not a session of its own. */
object SessionCount {
    private const val NEAR_MINUTES = 45
    private const val MAX_MINUTES = 45

    private fun start(a: ActivityRow) = java.time.LocalDateTime.parse(a.startLocal.replace(' ', 'T'))
    private fun end(a: ActivityRow) = start(a).plusSeconds((a.duration ?: 0.0).toLong())

    fun ofDay(runs: List<ActivityRow>): Int {
        val sorted = runs.sortedBy { it.startLocal }
        val absorbed = BooleanArray(sorted.size)
        fun hard(a: ActivityRow) = a.category == "interval" || a.category == "race"
        sorted.forEachIndexed { i, a ->
            if (!hard(a)) return@forEachIndexed
            fun takes(j: Int, gapMinutes: Long) {
                val other = sorted.getOrNull(j) ?: return
                if (!hard(other) && !absorbed[j] && (other.duration ?: 0.0) <= MAX_MINUTES * 60 && gapMinutes <= NEAR_MINUTES) absorbed[j] = true
            }
            if (i > 0) takes(i - 1, java.time.Duration.between(end(sorted[i - 1]), start(a)).toMinutes())
            if (i < sorted.lastIndex) takes(i + 1, java.time.Duration.between(end(a), start(sorted[i + 1])).toMinutes())
        }
        return absorbed.count { !it }
    }

    /** Sessions among [runs] of any days. */
    fun count(runs: List<ActivityRow>): Int = runs.groupBy { it.startLocal.take(10) }.values.sumOf { ofDay(it) }
}

object WeekReviews {
    /** The week (Monday to [date]) of the runs in [activities], or null when there was no run. */
    fun of(date: LocalDate, activities: List<ActivityRow>, analysis: Analysis, history: SessionHistory?): WeekReview? {
        val monday = date.with(DayOfWeek.MONDAY)
        fun day(a: ActivityRow) = LocalDate.parse(a.startLocal.take(10))
        val runs = activities.filter { it.id > 0 && it.isRun && !day(it).isBefore(monday) && !day(it).isAfter(date) }
        if (runs.isEmpty()) return null
        val before = activities.filter { it.id > 0 && it.isRun && !day(it).isBefore(monday.minusDays(7)) && day(it).isBefore(monday) }
        val zones = runs.mapNotNull { it.hrZones?.takeIf { z -> z.size >= 5 } }
        val total = zones.sumOf { it.sum() }
        val hard = zones.sumOf { it[3] + it[4] }
        val load = analysis.globalOn(date.toString())
        return WeekReview(
            monday, runs.sumOf { it.distance ?: 0.0 } / 1000, SessionCount.count(runs), runs.size, before.sumOf { it.distance ?: 0.0 } / 1000, load, load?.let { LoadZones.of(it) },
            runs.filter { it.category == "interval" }.sortedBy { it.startLocal }.mapNotNull { a ->
                a.intervalTitle?.let { title -> val note = history?.noteOf(a.id); WeekInterval(day(a), withoutRecoveries(title), note?.remark, note?.summary) }
            },
            if (total > 0) (100 * hard / total).roundToInt() else null,
        )
    }

    /** True on a Sunday: the day the review goes on Strava and shows on the home page. */
    fun isReviewDay(date: LocalDate) = date.dayOfWeek == DayOfWeek.SUNDAY

    /** The review to show on the home page: the week in progress on Sunday, the week that just ended on Monday. */
    fun forHome(today: LocalDate, activities: List<ActivityRow>, analysis: Analysis, history: SessionHistory?): WeekReview? = when (today.dayOfWeek) {
        DayOfWeek.SUNDAY -> of(today, activities, analysis, history)
        DayOfWeek.MONDAY -> of(today.minusDays(1), activities, analysis, history)
        else -> null
    }
}

/** A bad recovery of the day: the form of the morning is under the "correct" band. */
class RecoveryAlert(val score: Int, val label: String, val causes: List<String>, val tips: List<String>)

object RecoveryCheck {
    /** Under this form (of 100) the recovery is called bad: "Fatigué" and "À ménager". */
    const val LIMIT = 52

    private fun cause(f: Factor): Pair<String, String>? = when (f.key) {
        "sleep" -> "Nuit courte : ${f.display}, ${f.note}" to "Dors plus ce soir : vise ta durée habituelle ou un peu plus."
        "sleepScore" -> "Sommeil de mauvaise qualité : ${f.display}" to "Soigne ta soirée : écrans, repas lourd et alcool abîment le sommeil."
        "hrv" -> "VFC basse : ${f.display}, ${f.note}" to "Une VFC basse dit que ton corps est sous tension : évite l'intensité aujourd'hui."
        "restingHr" -> "FC au repos élevée : ${f.display}, ${f.note}" to "Une FC de repos qui monte, c'est de la fatigue, du stress ou un début de maladie."
        "bodyBattery" -> "Body Battery basse au réveil : ${f.display}" to "Ta Body Battery ne s'est pas rechargée : repose-toi avant de forcer."
        "stress" -> "Journée stressante : ${f.display}" to "Le stress freine la récupération : garde du temps pour souffler."
        "fatigue" -> "Charge élevée ces derniers jours : ${f.display}" to "Allège les prochains jours : footings faciles, pas de fractionné."
        else -> null
    }

    fun alert(analysis: Analysis, activities: List<ActivityRow>, today: LocalDate = LocalDate.now()): RecoveryAlert? {
        val r = analysis.readinessToday ?: return null
        if (r.score >= LIMIT) return null
        val found = r.factors.filter { it.status == "low" }.sortedBy { it.z }.mapNotNull { cause(it) }.toMutableList()
        // The session of the last two days is a cause in itself
        val hard = activities.filter { it.isRun && (it.category == "interval" || it.category == "race") && it.startLocal.take(10) >= today.minusDays(2).toString() }
        if (hard.isNotEmpty()) found += "Séance dure récente : ${hard.maxByOrNull { it.startLocal }?.intervalTitle?.let { withoutRecoveries(it) } ?: "course"}" to "Laisse 48 h entre deux séances dures."
        if (found.isEmpty()) found += "Pas de cause nette dans tes données" to "Une récupération moyenne se règle souvent avec un jour facile."
        return RecoveryAlert(r.score, r.label, found.map { it.first }, found.map { it.second }.distinct() + "Aujourd'hui : repos ou footing très facile.")
    }

    /** The one line of the Strava description: only when the recovery of that morning was bad. */
    fun line(score: Int?): String? = score?.takeIf { it < LIMIT }?.let { "Récupération faible ce matin (forme $it/100)." }
}
