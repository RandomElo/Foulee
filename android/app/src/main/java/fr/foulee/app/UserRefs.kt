package fr.foulee.app

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * What the runner says about himself: VMA, personal records, and the heart rates he wants to use instead of the measured ones (0 = measured).
 * A VMA or a record left at 0 is unknown: what depends on it (race paces of the "Spé" texts) is simply not computed.
 */
object UserRefs {
    var vma by mutableStateOf(0.0)
    /** Records in seconds */
    var rec5 by mutableStateOf(0.0)
    var rec10 by mutableStateOf(0.0)
    var recHalf by mutableStateOf(0.0)
    var hrMax by mutableStateOf(0)
    var hrRest by mutableStateOf(0)

    fun load(p: SharedPreferences) {
        vma = p.getFloat("ref_vma", 0f).toDouble()
        rec5 = p.getFloat("ref_5k", 0f).toDouble()
        rec10 = p.getFloat("ref_10k", 0f).toDouble()
        recHalf = p.getFloat("ref_half", 0f).toDouble()
        hrMax = p.getInt("ref_hrmax", 0)
        hrRest = p.getInt("ref_hrrest", 0)
    }

    /** Race paces in seconds per km, the marathon from the half with Riegel's formula. */
    fun racePaces(): List<Pair<String, Double>> = buildList {
        if (rec5 > 0) add("5 km" to rec5 / 5)
        if (rec10 > 0) add("10 km" to rec10 / 10)
        if (recHalf > 0) {
            add("semi" to recHalf / 21.0975)
            add("marathon" to recHalf * 2.0.pow(1.06) / 42.195)
        }
    }

    /** "16:48" or "1:23:48" as seconds, null when it does not read as a time. */
    fun parseTime(text: String): Double? {
        val parts = text.trim().replace('h', ':').replace('.', ':').split(':').map { it.trim().toIntOrNull() ?: return null }
        return when (parts.size) {
            2 -> parts[0] * 60.0 + parts[1]
            3 -> parts[0] * 3600.0 + parts[1] * 60 + parts[2]
            else -> null
        }
    }

    /** An empty field, or "0", means unknown (0 seconds). */
    fun parseTimeOrUnknown(text: String): Double? = if (text.isBlank()) 0.0 else parseTime(text)

    fun formatTime(seconds: Double): String {
        if (seconds <= 0) return ""
        val s = Math.round(seconds).toInt()
        return if (s >= 3600) "${s / 3600}:${(s % 3600 / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}" else "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }
}

class HrZone(val number: Int, val name: String, val from: Int, val to: Int)

/** Heart-rate zones by reserve (Karvonen): 50-60, 60-70, 70-80, 80-90 and 90-100 % of the gap between the resting and the maximum heart rate. */
object Zones {
    private val names = listOf("Récupération", "Endurance (EF)", "Tempo", "Seuil", "VMA")

    fun of(refs: HrRefs): List<HrZone> {
        val rest = refs.rest
        val reserve = max(refs.max - rest, 1.0)
        return (0 until 5).map { i -> HrZone(i + 1, names[i], Math.round(rest + reserve * (0.5 + 0.1 * i)).toInt(), Math.round(rest + reserve * (0.6 + 0.1 * i)).toInt()) }
    }

    /** Pace of the footings actually run in zone 2 over the last weeks: duration-weighted speed (m/s), average heart rate, number of runs. */
    fun efPace(activities: List<ActivityRow>, refs: HrRefs, today: java.time.LocalDate = java.time.LocalDate.now()): Triple<Double, Double, Int>? {
        val zone = of(refs)[1]
        val since = today.minusDays(60).toString()
        val runs = activities.filter {
            it.id > 0 && it.isRun && it.category == "easy" && it.startLocal.take(10) >= since && (it.duration ?: 0.0) >= 1200 && (it.averageSpeed ?: 0.0) > 0 &&
                (it.averageHr ?: 0.0) in (zone.from - 2.0)..(zone.to + 2.0)
        }
        if (runs.isEmpty()) return null
        val seconds = runs.sumOf { it.duration!! }
        val speed = runs.sumOf { it.averageSpeed!! * it.duration!! } / seconds
        val hr = runs.sumOf { it.averageHr!! * it.duration!! } / seconds
        return Triple(speed, hr, runs.size)
    }
}
