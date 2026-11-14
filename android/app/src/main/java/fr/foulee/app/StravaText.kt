package fr.foulee.app

import kotlin.math.abs
import kotlin.math.pow

/** The name and the description the app would put on a Strava interval session. */
class StravaText(val name: String, val description: String, val interval: Boolean = true)

object StravaTextBuilder {
    private const val SPE_TOLERANCE = 0.025
    private const val SPE_MIN_REP_METERS = 800.0
    private const val SPE_MIN_REP_SECONDS = 150.0
    const val SIGNATURE = "🤖 Généré par Foulée"

    /** The proposal shown to Eloi, never applied alone: "5 km", "10 km", "semi" or "marathon" when the main reps run at that race pace (short reps never do). */
    fun proposedSpeciality(analysis: IntervalAnalysis): String? {
        val main = analysis.groups
            .filter { it.avgDistance >= SPE_MIN_REP_METERS || it.avgDuration >= SPE_MIN_REP_SECONDS }
            .maxByOrNull { it.reps.size * it.avgDistance } ?: return null
        if (main.avgSpeed <= 0) return null
        val pace = 1000 / main.avgSpeed
        val (label, ref) = UserRefs.racePaces().minByOrNull { abs(it.second - pace) } ?: return null
        return label.takeIf { abs(pace - ref) / ref <= SPE_TOLERANCE }
    }

    /** 3:21 /km written "3 min 21 / km", like the rest of his Strava texts. */
    private fun pace(speed: Double): String {
        val s = Math.round(1000 / speed).toInt()
        return "${s / 60} min ${(s % 60).toString().padStart(2, '0')} / km"
    }

    private fun repsOf(g: RepGroup) = "${if (g.reps.size > 1) "${g.reps.size} × " else ""}${g.label}"

    /** Eloi's way of writing it on Strava: plain spaces, "x", "sec". */
    fun plain(text: String) = text.replace('\u00a0', ' ').replace('×', 'x').replace(Regex("(\\d) s\\b"), "$1 sec")

    /**
     * "Spé 5 km - 2000 m + 1000 m + 5 x 200 m ( r : 2 min 30 + 3 min + 100 m )" as the name. The description is one line per type of effort with its
     * average pace ("1000 m : 3 min 21 / km", never the number of reps: it is in the name), the remark on the session when there is one, "Charge 14,9/20 (Progression)", the review of the week on a Sunday, then the signature.
     * A figure that is unknown is left out.
     */
    fun build(analysis: IntervalAnalysis, load: Double?, remark: String?, speciality: String?, week: WeekReview? = null, recovery: String? = null): StravaText {
        val spe = speciality?.takeIf { it != "none" }
        // "Spé 5 km - 2000 m + 1000 m + 5 x 200 m ( r : 2 min 30 + 3 min + 100 m )": the recoveries once at the end, one per type of effort. With four or more
        // of them the title would be a wall: they go in the description instead.
        val layout = Intervals.layout(analysis)
        val inName = layout.entries.size < Intervals.MAX_RECOVERIES_IN_TITLE
        val recoveries = layout.entries.map { it.second }.let { all -> if (all.distinct().size == 1) all.distinct() else all }
        val name = plain((if (spe != null) "Spé $spe - " else "Fractionné - ") + layout.efforts +
            if (inName && recoveries.isNotEmpty()) " ( r : ${recoveries.joinToString(" + ")} )" else "")
        val lines = analysis.groups.map { g -> "${plain(g.label)} : ${pace(g.avgSpeed)}" } +
            (if (!inName) listOf(plain("Récups : " + layout.entries.joinToString(" · ") { (element, rec) -> "$element : $rec" })) else emptyList())
        return StravaText(name, describe(lines, load, remark, week, recovery))
    }

    /** "Charge 14,9/20 (Progression)": the figure with the term of training it falls in. */
    fun figures(load: Double?): String? = load?.let { "Charge ${Fmt.num(it)}/20 (${LoadZones.of(it).label})" }

    private fun describe(lines: List<String>, load: Double?, remark: String?, week: WeekReview?, recovery: String?): String =
        (lines + listOfNotNull(remark, recovery, figures(load)) + (week?.let { listOf("") + it.lines + "" } ?: emptyList()) + SIGNATURE).joinToString("\n")

    /** A footing or a long run: just "Footing" (or "Sortie longue") as the name, and the training load as the only figure of the description. */
    fun buildEasy(a: ActivityRow, load: Double?, week: WeekReview? = null, recovery: String? = null): StravaText? {
        if ((a.distance ?: 0.0) <= 0 || (a.duration ?: 0.0) <= 0) return null
        val kind = if (a.category == "long") "Sortie longue" else "Footing"
        return StravaText(kind, describe(emptyList(), load, null, week, recovery), interval = false)
    }
}
