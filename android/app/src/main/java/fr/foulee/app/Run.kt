package fr.foulee.app

import java.util.Locale

/** A finished run, with the two form values read at the same time. */
data class Run(
    val id: Long,
    val distanceKm: Double,
    val paceSecPerKm: Double?,
    val form: Form,
    /** Global load of the day on 20, with the term of training it falls in */
    val load: Double? = null,
) {
    val title: String get() = "Course terminée : ${format1(distanceKm)} km"

    val summary: String
        get() = listOf(
            "Allure " + (paceSecPerKm?.let { formatPace(it) } ?: "n/d"),
            "Charge globale " + (load?.let { "${format1(it)}/20 (${LoadZones.of(it).label})" } ?: "n/d"),
        ).joinToString(" · ")

    companion object {
        fun from(activity: ActivityRow, form: Form, load: Double? = null): Run {
            val meters = activity.distance ?: 0.0
            val speed = activity.averageSpeed ?: 0.0
            val duration = activity.duration ?: 0.0
            val pace = when {
                speed > 0 -> 1000 / speed
                meters > 0 && duration > 0 -> duration / meters * 1000
                else -> null
            }
            return Run(activity.id, meters / 1000, pace, form, load)
        }

        private fun format1(value: Double) = String.format(Locale.FRANCE, "%.1f", value)

        /** 272.4 s/km -> "4:32 /km" */
        fun formatPace(secPerKm: Double): String {
            val total = Math.round(secPerKm).toInt()
            return String.format(Locale.FRANCE, "%d:%02d /km", total / 60, total % 60)
        }
    }
}
