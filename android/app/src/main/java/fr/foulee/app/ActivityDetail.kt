package fr.foulee.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.outlined.Info
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.roundToInt

private class Cell(val key: String, val label: String, val value: String, val clickable: Boolean = true)

/** Percent (for the gauge, null when there is nothing to compare) and a short sentence. */
/** [detail]: why, for this session, in one line. [help]: how the part is calculated, shown behind its "i". */
private class InsightPart(val label: String, val value: String, val fraction: Float, val tone: Int, val detail: String, val help: HelpSpec, val weight: Double? = null, val weightOf: String = "")

/** A scale drawn in a help window: where [marker] (0 to 1) sits between [ticks] (position, label), with its own value in [markerText]. */
private class ScaleSpec(val label: String, val marker: Float, val markerText: String, val ticks: List<Pair<Float, String>>)

/** What the "i" of a part shows: one sentence, the scales with the place of this session on them, and a few short rules. */
private class HelpSpec(val summary: String, val scales: List<ScaleSpec>, val bullets: List<String>)

private class Insight(val percent: Int?, val gaugeLabel: String, val text: String, val parts: List<InsightPart> = emptyList(), val zoneValue: Double? = null)

private fun insight(key: String, a: ActivityRow, snap: Snapshot, session: SessionAnalysis? = null): Insight? {
    val analysis = snap.analysis
    when (key) {
        "pace" -> {
            val speed = a.averageSpeed ?: return null
            val meters = a.distance ?: return null
            val since = LocalDate.now().minusDays(730).toString()
            val similar = snap.activities.filter {
                it.isRun && it.id != a.id && it.startLocal.take(10) >= since && it.averageSpeed != null && it.distance != null && abs(it.distance - meters) <= 0.2 * meters
            }
            val format = "${Fmt.num(meters / 1000, if (meters >= 20_000) 0 else 1)} km"
            if (similar.size < 3) return Insight(null, "", "Pas assez de sorties de $format environ pour comparer (il en faut au moins 3).")
            val pct = similar.count { it.averageSpeed!! < speed } * 100 / similar.size
            val mean = similar.sumOf { it.averageSpeed!! } / similar.size
            return Insight(pct, "plus rapide", "Plus rapide que $pct % de tes ${similar.size} sorties de $format environ sur 2 ans. Ta moyenne sur ce format : ${Fmt.pace(mean)}.")
        }
        "hr" -> {
            val hr = a.averageHr ?: return null
            val pct = (hr / analysis.refs.max * 100).roundToInt().coerceIn(0, 100)
            val zone = when {
                pct < 60 -> "zone 1, récupération"
                pct < 70 -> "zone 2, endurance"
                pct < 80 -> "zone 3, tempo"
                pct < 90 -> "zone 4, seuil"
                else -> "zone 5, effort maximal"
            }
            return Insight(pct, "de ta FC max", "${hr.roundToInt()} bpm de moyenne, soit $pct % de ta FC max estimée (${analysis.refs.max.roundToInt()} bpm) : $zone.")
        }
        "effort" -> {
            val effort = analysis.effortOf(a) ?: return null
            val label = when {
                effort < 3 -> "Séance facile"
                effort < 5 -> "Séance modérée"
                effort < 7 -> "Séance soutenue"
                else -> "Séance très dure"
            }
            val points = analysis.pointsOf(a)
            return Insight((effort * 10).roundToInt(), "d'effort", "$label." + (points?.let { " Elle pèse ${Fmt.num(it)} point${if (it >= 2) "s" else ""} sur les 20 de ta charge hebdomadaire." } ?: ""))
        }
        "week" -> {
            val p = snap.analysis.globalAfter(a) ?: return null
            fun times(v: Double) = "× ${Fmt.num(v, 2)}"
            val parts = buildList {
                add(InsightPart("Charge d'entraînement", times(p.trainingRatio), (p.trainingRatio / 1.8).toFloat().coerceIn(0f, 1f), 0, "tes 7 derniers jours contre tes 6 dernières semaines",
                    HelpSpec("La charge de ton cœur (fréquence cardiaque, tous sports) de ces derniers jours, comparée à ce que tu encaisses d'habitude.",
                        listOf(ScaleSpec("Ta charge, par rapport à ton habitude", (p.trainingRatio / 1.8).toFloat().coerceIn(0f, 1f), times(p.trainingRatio), listOf(0f to "0", (1 / 1.8).toFloat() to "× 1 = ton habitude", 1f to "× 1,8"))),
                        listOf("Les jours récents comptent plus que les anciens", "Un jour de repos baisse la valeur d'environ 11 %", "Comptée avec ta fréquence cardiaque, pas avec la charge de Garmin"))))
                p.volumeRatio?.let { add(InsightPart("Volume couru", times(it), (it / 1.8).toFloat().coerceIn(0f, 1f), 1, "${Math.round(p.weekKm)} km en ${p.weekSessions} séance${if (p.weekSessions > 1) "s" else ""} sur 7 jours",
                    HelpSpec("Les kilomètres de ces derniers jours comparés à tes kilomètres habituels. Ils voient le volume facile, que la fréquence cardiaque compte à peine.",
                        listOf(ScaleSpec("Tes kilomètres, par rapport à ton habitude", (it / 1.8).toFloat().coerceIn(0f, 1f), times(it), listOf(0f to "0", (1 / 1.8).toFloat() to "× 1 = ton habitude", 1f to "× 1,8"))),
                        listOf("Seule la course à pied compte", "Il pèse pour 40 % du rapport, le cœur pour 60 %")))) }
                val recoveryWord = if (!p.hasWatch) "montre non synchronisée" else if (p.deficit < 0.15) "comme d'habitude" else if (p.deficit < 0.5) "en baisse" else "en déficit"
                add(InsightPart("Récupération", recoveryWord, p.deficit.toFloat(), 2, if (p.unfavorable.isEmpty()) "VFC, FC de repos et sommeil sur 7 nuits" else p.unfavorable.joinToString(", ") { it.first } + " en dessous de ton habitude",
                    HelpSpec("Tes 7 dernières nuits (VFC, FC de repos, sommeil) comparées à tes deux mois d'avant.",
                        listOf(ScaleSpec("Ton déficit de récupération", p.deficit.toFloat(), recoveryWord, listOf(0f to "comme d'habitude", 1f to "déficit net"))),
                        listOf("Elle n'alourdit la charge que si tu charges plus que d'habitude et que ta récupération se dégrade", "Une bonne récupération ne fait jamais descendre la charge sous ce que dit l'entraînement seul", "Sans synchro de la montre, elle compte pour rien"))))
            }
            val why = when {
                p.ratio >= 1.05 -> "Tu charges ${Math.round((p.ratio - 1) * 100)} % de plus que d'habitude."
                p.ratio <= 0.95 -> "Tu charges ${Math.round((1 - p.ratio) * 100)} % de moins que d'habitude."
                else -> "Tu charges comme d'habitude."
            } + if (p.deficit >= 0.15 && p.ratio > 1.0) " Ta récupération se dégrade, ce qui alourdit le chiffre." else ""
            return Insight((p.total / 20 * 100).roundToInt(), "de charge globale", why, parts, p.total)
        }
    }
    return null
}


private fun percentile(sorted: List<Double>, p: Double) = sorted[(sorted.size * p).toInt().coerceIn(0, sorted.size - 1)]

/** Moving average over [window] points, ignoring gaps. */
private fun smooth(values: List<Double?>, window: Int): List<Double?> = values.indices.map { i ->
    val part = values.subList(maxOf(0, i - window / 2), minOf(values.size, i + window / 2 + 1)).filterNotNull()
    if (values[i] == null || part.isEmpty()) null else part.average()
}

@Composable
private fun Curves(detail: ActivityDetail, a: ActivityRow, showAltitude: Boolean) {
    val pal = LocalPal.current
    val samples = detail.samples
    // One touched point shared by the three curves: the pace, the heart rate and the altitude of the same moment
    var sel by remember(detail) { mutableStateOf<Int?>(null) }
    if (detail.track.size >= 2) Card(title = "Parcours") { RouteMap(detail.track) }
    if (samples.size < 10) return
    val last = samples.lastOrNull { it.d != null }?.d ?: 0.0
    val labels = listOf(0, samples.size / 2, samples.size - 1).map { i -> i to "${Fmt.num((samples[i].d ?: 0.0) / 1000, if (last >= 20_000) 0 else 1)} km" }

    if (a.isRun) {
        // Standing still or walking (recoveries) counts as the slowest pace instead of leaving a hole in the curve
        val pace = smooth(samples.map { it.speed?.coerceAtLeast(0.5) }, 5).map { s -> s?.let { 1000 / it }?.coerceAtMost(600.0) }
        fun pointText(i: Int): String = listOfNotNull(
            samples[i].d?.let { "${Fmt.num(it / 1000, 2)} km" }, pace.getOrNull(i)?.let { "${Fmt.clock(it)} /km" }, samples[i].hr?.takeIf { it > 30 }?.let { "${it.roundToInt()} bpm" },
        ).joinToString(" · ")
        val valid = pace.filterNotNull().filter { it >= 120 }.sorted()
        if (valid.size >= 10) {
            val fast = percentile(valid, 0.03)
            val slow = percentile(valid, 0.97)
            Card(title = "Allure") {
                // The axis is inverted: faster is higher
                LineChart(listOf(Series(pace.map { it?.let { p -> -p.coerceIn(fast, slow) } }, pal.accent, fill = true)), -slow, -fast, labels, topLabel = if (sel == null) "${Fmt.clock(fast)} à ${Fmt.clock(slow)} /km" else null, selected = sel, readout = sel?.let { pointText(it) }, onSelect = { sel = it })
            }
        }
    }
    val hr = smooth(samples.map { it.hr?.takeIf { v -> v > 30 } }, 5)
    val hrValid = hr.filterNotNull().sorted()
    if (hrValid.size >= 10) {
        val lo = percentile(hrValid, 0.02)
        val hi = percentile(hrValid, 0.99)
        Card(title = "Fréquence cardiaque") {
            LineChart(listOf(Series(hr, pal.bad, fill = true)), lo, hi, labels, topLabel = if (sel == null) "${lo.roundToInt()} à ${hi.roundToInt()} bpm" else null, selected = sel, readout = sel?.let { i -> listOfNotNull(samples[i].d?.let { "${Fmt.num(it / 1000, 2)} km" }, hr.getOrNull(i)?.let { "${it.roundToInt()} bpm" }).joinToString(" · ") }, onSelect = { sel = it })
        }
    }
    val ele = smooth(samples.map { it.ele }, 5)
    val eleValid = ele.filterNotNull()
    if (showAltitude && eleValid.size >= 10 && eleValid.max() - eleValid.min() >= 5) {
        Card(title = "Altitude") {
            LineChart(listOf(Series(ele, pal.good, fill = true)), eleValid.min(), eleValid.max(), labels, topLabel = if (sel == null) "${eleValid.min().roundToInt()} à ${eleValid.max().roundToInt()} m" else null, selected = sel, readout = sel?.let { i -> listOfNotNull(samples[i].d?.let { "${Fmt.num(it / 1000, 2)} km" }, ele.getOrNull(i)?.let { "${it.roundToInt()} m" }).joinToString(" · ") }, onSelect = { sel = it })
        }
    }
}

/** One table row: the first column is the narrowest. */
@Composable
private fun TableRow(cells: List<String>, header: Boolean = false, muted: Boolean = false, emphasize: Int = -1, colors: Map<Int, androidx.compose.ui.graphics.Color> = emptyMap(), weights: List<Float>? = null) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        cells.forEachIndexed { i, text ->
            Text(
                text, Modifier.weight(weights?.getOrNull(i) ?: if (i == 0) 0.7f else 1f), fontSize = 13.sp,
                fontWeight = if (header || i == emphasize) FontWeight.Medium else FontWeight.Normal,
                color = colors[i] ?: if (header || muted) pal.muted else pal.text,
            )
        }
    }
}

@Composable
private fun Divider() = Box(Modifier.fillMaxWidth().height(1.dp).background(LocalPal.current.border))

@Composable
private fun CategoryPicker(state: AppState, a: ActivityRow) {
    val pal = LocalPal.current
    var open by remember { mutableStateOf(false) }
    val manual = a.manualCategory != null
    Row(verticalAlignment = Alignment.CenterVertically) {
        Muted("Type", size = 14)
        Box(Modifier.padding(start = 10.dp)) {
            Row(
                Modifier.clip(RoundedCornerShape(10.dp)).background(pal.card).clickable { open = true }.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (manual) Categories.label(a.category) else "Automatique (${Categories.label(a.category)})", fontWeight = FontWeight.Medium, fontSize = 14.sp, color = pal.text)
                Icon(Icons.Filled.ExpandMore, null, Modifier.padding(start = 4.dp).size(16.dp), tint = pal.muted)
            }
            DropdownMenu(open, { open = false }) {
                DropdownMenuItem({ Text("Automatique") }, { open = false; state.setCategory(a.id, null) })
                Categories.all.forEach { c -> DropdownMenuItem({ Text(Categories.label(c)) }, { open = false; state.setCategory(a.id, c) }) }
            }
        }
        if (manual) Muted("choisi à la main", Modifier.padding(start = 8.dp))
    }
}


/** The actions on the text of a session, in one compact row: copy (a menu), spé and recoveries (dialogs), send. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TextActions(state: AppState, a: ActivityRow, analysis: IntervalAnalysis?, text: StravaText) {
    val pal = LocalPal.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var copyMenu by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var speOpen by remember { mutableStateOf(false) }
    var recOpen by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            kotlinx.coroutines.delay(1500)
            copied = false
        }
    }
    fun copy(value: String) {
        clipboard.setText(androidx.compose.ui.text.AnnotatedString(value))
        copied = true
    }
    val small = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 4.dp)
    FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box {
            OutlinedButton({ copyMenu = true }, Modifier.height(36.dp), contentPadding = small) { Text(if (copied) "Copié" else "Copier", fontSize = 13.sp) }
            DropdownMenu(copyMenu, { copyMenu = false }) {
                DropdownMenuItem({ Text("Le titre") }, { copyMenu = false; copy(text.name) })
                DropdownMenuItem({ Text("La description") }, { copyMenu = false; copy(text.description) })
                DropdownMenuItem({ Text("Titre et description") }, { copyMenu = false; copy(text.name + "\n\n" + text.description) })
            }
        }
        if (analysis != null) OutlinedButton({ speOpen = true }, Modifier.height(36.dp), contentPadding = small) {
            Text(a.speciality?.takeIf { it != "none" }?.let { "Spé : $it" } ?: "Spé", fontSize = 13.sp)
        }
        if (analysis != null && analysis.groups.any { it.recovery != null }) OutlinedButton({ recOpen = true }, Modifier.height(36.dp), contentPadding = small) { Text("Récups", fontSize = 13.sp) }
        if (a.strava != null && state.stravaConfigured) OutlinedButton({ state.sendText(a) }, Modifier.height(36.dp), contentPadding = small) { Text("Envoyer", fontSize = 13.sp) }
    }
    if (state.stravaConfigured && state.textStatus.isNotEmpty()) Muted(state.textStatus, Modifier.padding(top = 6.dp), size = 12)
    if (analysis != null && speOpen) SpecialityDialog(state, a, StravaTextBuilder.proposedSpeciality(analysis)) { speOpen = false }
    if (analysis != null && recOpen) RecoveryDialog(state, a, analysis) { recOpen = false }
}

/** The race pace of the reps ("Spé 5 km"): proposed from the pace, set only when Eloi taps one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SpecialityDialog(state: AppState, a: ActivityRow, proposed: String?, onClose: () -> Unit) {
    val pal = LocalPal.current
    val current = a.speciality
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose,
        containerColor = pal.card, titleContentColor = pal.text, textContentColor = pal.text,
        confirmButton = { androidx.compose.material3.TextButton(onClose) { Text("Fermer") } },
        title = { Text("Spé", fontWeight = FontWeight.SemiBold) },
        text = {
            Column {
                Muted(
                    if (proposed != null) "Tes répétitions longues sont à l'allure de ta course sur $proposed." else "Aucune allure de course ne correspond à cette séance.",
                    size = 13,
                )
                FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("none" to "Pas de spé", "5 km" to "Spé 5 km", "10 km" to "Spé 10 km", "semi" to "Spé semi", "marathon" to "Spé marathon").forEach { (value, label) ->
                        // Proposed ones carry a mark so the suggestion is visible without being applied
                        val text = if (value == proposed && current != value) "$label (proposé)" else label
                        Chip(text, (current ?: "none") == value) { state.setSpeciality(a.id, value); onClose() }
                    }
                }
            }
        },
    )
}

/** Timed or measured recovery, one choice per type of efforts: the detection is a guess, this corrects it in two taps. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecoveryDialog(state: AppState, a: ActivityRow, analysis: IntervalAnalysis, onClose: () -> Unit) {
    val pal = LocalPal.current
    val groups = analysis.groups.filter { it.recovery != null }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose,
        containerColor = pal.card, titleContentColor = pal.text, textContentColor = pal.text,
        confirmButton = { androidx.compose.material3.TextButton(onClose) { Text("Fermer") } },
        title = { Text("Récups", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Muted("Mesurée au temps ou à la distance ? Le titre change tout de suite.", size = 13)
                groups.forEach { g ->
                    val fixed = a.recoveryModes[g.label]
                    Column(Modifier.padding(top = 14.dp)) {
                        Text("${if (g.reps.size > 1) "${g.reps.size} × " else ""}${g.label} : ${g.recovery!!.label}", color = pal.text, fontSize = 14.sp)
                        FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Chip("Temps", g.recovery.measured == false) { state.setRecoveryMode(a.id, g.label, false) }
                            Chip("Distance", g.recovery.measured == true) { state.setRecoveryMode(a.id, g.label, true) }
                            if (fixed != null) Chip("Auto", false) { state.setRecoveryMode(a.id, g.label, null) }
                        }
                    }
                }
            }
        },
    )
}

/** The name, description and labels Eloi gave the outing on Strava. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StravaCard(s: StravaActivity) {
    val pal = LocalPal.current
    Card(title = "Strava") {
        if (s.name.isNotBlank()) Text(s.name, fontWeight = FontWeight.SemiBold, color = pal.text, fontSize = 15.sp, lineHeight = 21.sp)
        if (s.description.isNotBlank()) Text(s.description, Modifier.padding(top = 6.dp), color = pal.muted, fontSize = 14.sp, lineHeight = 20.sp)
        if (s.labels.isNotEmpty()) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            s.labels.forEach { l -> Text(StravaSync.labelFr(l), Modifier.clip(RoundedCornerShape(50)).background(pal.accent.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 4.dp), color = pal.accent, fontSize = 13.sp, fontWeight = FontWeight.Medium) }
        }
    }
}

@Composable
private fun IntervalCard(analysis: IntervalAnalysis, notes: List<String> = emptyList()) {
    val pal = LocalPal.current
    FoldCard(title = "Splits de la séance" + if (analysis.structured) " (séance programmée)" else "") {
        notes.forEach { Text(it, Modifier.padding(bottom = 12.dp), color = pal.warn, fontSize = 13.sp, lineHeight = 18.sp) }
        analysis.groups.forEachIndexed { gi, g ->
            if (gi > 0) Box(Modifier.padding(vertical = 14.dp)) { Divider() }
            Text(
                "${g.reps.size} × ${g.label}" + (g.recovery?.let { " (r : ${it.label})" } ?: ""),
                fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = pal.text,
            )
            Row(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                Column(Modifier.weight(1f)) { Muted("Allure moyenne"); Text(Fmt.pace(g.avgSpeed), fontWeight = FontWeight.SemiBold, color = pal.text) }
                Column(Modifier.weight(1f)) { Muted("FC moyenne"); Text(g.avgHr?.let { "$it bpm" } ?: "–", fontWeight = FontWeight.SemiBold, color = pal.text) }
            }
            Column(Modifier.padding(top = 12.dp)) {
                TableRow(listOf("Rép.", if (g.timeBased) "Distance" else "Temps", "Allure", "Écart", "FC moy."), header = true)
                Divider()
                g.reps.forEach { r ->
                    val speed = r.lap.distance!! / r.lap.duration!!
                    // Seconds per km versus the group average: negative = faster
                    val delta = (1000 / speed - 1000 / g.avgSpeed).roundToInt()
                    TableRow(
                        listOf(
                            "${r.rep}", if (g.timeBased) Fmt.km(r.lap.distance) else Fmt.clock(r.lap.duration), Fmt.pace(speed),
                            if (delta == 0) "=" else "${if (delta > 0) "+" else "−"}${abs(delta)} s/km", r.lap.averageHr?.roundToInt()?.toString() ?: "–",
                        ),
                        emphasize = 2, colors = mapOf(3 to if (delta < 0) pal.good else if (delta > 0) pal.warn else pal.muted),
                    )
                }
            }
        }
    }
}

/** The effect levels Garmin gives a session, from the gentlest to the hardest. */
private val effectLadder = listOf("RECOVERY", "BASE", "TEMPO", "LACTATE_THRESHOLD", "VO2MAX", "ANAEROBIC_CAPACITY", "SPRINT")

private fun effectLevel(key: String) = when (key.removePrefix("AEROBIC_")) {
    "SPEED" -> effectLadder.indexOf("ANAEROBIC_CAPACITY")
    else -> effectLadder.indexOf(key.removePrefix("AEROBIC_"))
}

/** The ladder: one segment per level, the session's one lit. */
@Composable
private fun EffectLadder(level: Int) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        effectLadder.indices.forEach { i ->
            val lit = i == level
            Box(
                Modifier.weight(1f).height(if (lit) 18.dp else 10.dp).clip(RoundedCornerShape(50))
                    .background(if (i <= level) pal.accent.copy(alpha = if (lit) 1f else 0.55f) else pal.muted.copy(alpha = 0.25f)),
            )
        }
    }
}

/** Five segments filled up to the score (0 to 5). */
@Composable
private fun Segments(value: Double, color: androidx.compose.ui.graphics.Color) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (i in 0 until 5) {
            val fill = (value - i).coerceIn(0.0, 1.0).toFloat()
            Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(50)).background(pal.muted.copy(alpha = 0.25f))) {
                if (fill > 0f) Box(Modifier.fillMaxWidth(fill).height(10.dp).background(color))
            }
        }
    }
}

/** The effect on screen is a ladder with the session's level lit; the scores, load and zones are behind the "i". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrainingEffectCard(a: ActivityRow) {
    val pal = LocalPal.current
    var open by remember { mutableStateOf(false) }
    val label = a.teLabel?.let { teLabel(it) }
    Card(
        title = "Effet de l'entraînement",
        action = { Icon(Icons.Outlined.Info, "Détail", Modifier.size(22.dp).clip(CircleShape).clickable { open = true }, tint = pal.muted) },
    ) {
        Column(Modifier.clickable { open = true }) {
            Text(label ?: "Voir le détail", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (label != null) pal.text else pal.accent)
            a.teLabel?.let { effectLevel(it).takeIf { l -> l >= 0 } }?.let { Box(Modifier.padding(top = 10.dp)) { EffectLadder(it) } }
        }
    }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        containerColor = pal.card, titleContentColor = pal.text, textContentColor = pal.text,
        confirmButton = { TextButton({ open = false }) { Text("Fermer") } },
        title = { Text(label ?: "Effet de l'entraînement", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                a.teLabel?.let { key ->
                    Text(teExplanation(key), color = pal.text, fontSize = 14.sp, lineHeight = 20.sp)
                    val works = teWorks(key)
                    if (works.isNotEmpty()) Column {
                        Muted("Ce que ça fait travailler", Modifier.padding(bottom = 6.dp), size = 14)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            works.forEach { w -> Text(w, Modifier.clip(RoundedCornerShape(50)).background(pal.accent.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 4.dp), color = pal.accent, fontSize = 13.sp, fontWeight = FontWeight.Medium) }
                        }
                    }
                }
                a.aerobicTe?.let { Column { Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) { Muted("Aérobie", size = 14); Text(Fmt.num(it), fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = pal.text) }; Segments(it, pal.accent) } }
                a.anaerobicTe?.let { Column { Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) { Muted("Anaérobie", size = 14); Text(Fmt.num(it), fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = pal.text) }; Segments(it, pal.violet) } }
            }
        },
    )
}

/** What the effect trains, in a few words each. */
private fun teWorks(key: String): List<String> = when (key.removePrefix("AEROBIC_")) {
    "RECOVERY" -> listOf("Circulation", "Récupération des muscles")
    "BASE" -> listOf("Endurance de fond", "Graisses comme carburant", "Capillaires")
    "TEMPO" -> listOf("Allure soutenue", "Efficacité du cœur", "Endurance musculaire")
    "LACTATE_THRESHOLD" -> listOf("Seuil lactique", "Élimination du lactate", "Endurance à allure rapide")
    "VO2MAX" -> listOf("Cœur (débit max)", "Transport de l'oxygène", "Muscles qui l'utilisent", "Économie de course")
    "ANAEROBIC_CAPACITY" -> listOf("Fibres rapides", "Énergie sans oxygène", "Tolérance à l'acidité")
    "SPEED" -> listOf("Fibres rapides", "Foulée", "Coordination")
    "SPRINT" -> listOf("Puissance", "Fibres rapides", "Foulée")
    else -> emptyList()
}

private fun teExplanation(key: String) = when (key.removePrefix("AEROBIC_")) {
    "NO_BENEFIT", "UNKNOWN" -> "Trop court ou trop léger pour avoir un effet."
    "RECOVERY" -> "Séance très facile : elle aide à récupérer."
    "BASE" -> "Endurance facile : elle construit la base."
    "TEMPO" -> "Allure soutenue mais tenable longtemps."
    "LACTATE_THRESHOLD" -> "Travail au seuil : repousse l'allure que tu tiens longtemps."
    "VO2MAX" -> "Proche de ton maximum : relève ton VO2 max, l'oxygène que ton corps sait utiliser."
    "ANAEROBIC_CAPACITY" -> "Efforts courts et très intenses."
    "SPEED" -> "Vitesse pure, efforts courts et rapides."
    "SPRINT" -> "Efforts maximaux très courts."
    else -> "Effet principal de la séance selon Garmin."
}

/** Garmin's label ("AEROBIC_BASE" and "AEROBIC_TEMPO" come with a prefix), as the web app showed it. */
private fun teLabel(key: String) = when (key.removePrefix("AEROBIC_")) {
    "NO_BENEFIT", "UNKNOWN" -> "Aucun bénéfice"
    "RECOVERY" -> "Récupération"
    "BASE" -> "Endurance de base"
    "TEMPO" -> "Tempo"
    "LACTATE_THRESHOLD" -> "Seuil lactique"
    "VO2MAX" -> "VO2 max"
    "ANAEROBIC_CAPACITY" -> "Capacité anaérobie"
    "SPEED" -> "Vitesse"
    "SPRINT" -> "Sprint"
    else -> key.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}

@Composable
private fun SplitsCard(splits: List<Split>, running: Boolean) {
    FoldCard(title = "Temps intermédiaires (par km)") {
        TableRow(listOf("Km", "Temps", if (running) "Allure" else "Vitesse", "FC moy.", "D+"), header = true)
        Divider()
        splits.forEach { s ->
            val speed = if (s.duration > 0) s.distance / s.duration else null
            TableRow(
                listOf(
                    if (s.distance < 999) Fmt.num(s.km - 1 + s.distance / 1000, 2) else s.km.toString(), Fmt.clock(s.duration), if (running) Fmt.pace(speed) else Fmt.speed(speed),
                    s.averageHr?.toString() ?: "–", "${s.elevationGain.roundToInt()} m",
                ),
                emphasize = 2,
            )
        }
    }
}

/** Nothing selected: every lap. Otherwise only the selected effort types and recovery types, nothing around them. */
private fun lapVisible(laps: List<LapInfo>, i: Int, groups: Set<Int>, kinds: Set<Int>): Boolean {
    if (groups.isEmpty() && kinds.isEmpty()) return true
    val info = laps[i]
    return when (info.role) {
        LapRole.WORK -> info.group?.let { it in groups } == true
        LapRole.RECOVERY -> info.kind?.let { it in kinds } == true
        else -> false
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LapsCard(laps: List<LapInfo>, analysis: IntervalAnalysis?, running: Boolean) {
    val pal = LocalPal.current
    var groups by remember(analysis) { mutableStateOf(emptySet<Int>()) }
    var kinds by remember(analysis) { mutableStateOf(emptySet<Int>()) }
    fun toggle(set: Set<Int>, i: Int) = if (i in set) set - i else set + i
    val shown = laps.indices.filter { lapVisible(laps, it, groups, kinds) }
    FoldCard(title = "Tours (montre)") {
        if (analysis != null && (analysis.groups.size > 1 || analysis.recoveryKinds.size > 1)) {
            if (analysis.groups.size > 1) {
                Muted("Efforts")
                FlowRow(Modifier.padding(top = 4.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    analysis.groups.forEachIndexed { gi, g -> Chip("${g.reps.size} × ${g.label}", gi in groups) { groups = toggle(groups, gi) } }
                }
            }
            if (analysis.recoveryKinds.size > 1) {
                Muted("Récups")
                FlowRow(Modifier.padding(top = 4.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    analysis.recoveryKinds.forEachIndexed { ki, k -> Chip("${k.label} (${k.laps.size})", ki in kinds) { kinds = toggle(kinds, ki) } }
                }
            }
            val efforts = shown.map { laps[it] }.filter { it.role == LapRole.WORK }.map { it.lap }
            if ((groups.isNotEmpty() || kinds.isNotEmpty()) && efforts.isNotEmpty()) {
                val speed = efforts.sumOf { it.distance ?: 0.0 } / efforts.sumOf { it.duration ?: 0.0 }
                val hrs = efforts.mapNotNull { it.averageHr }
                Muted(
                    "${efforts.size} effort${if (efforts.size > 1) "s" else ""} : allure moyenne ${if (running) Fmt.pace(speed) else Fmt.speed(speed)}" +
                        (if (hrs.isNotEmpty()) ", FC ${hrs.average().roundToInt()} bpm" else ""),
                    Modifier.padding(bottom = 6.dp), size = 13,
                )
            }
        }
        val weights = if (analysis != null) listOf(0.4f, 1.75f, 0.85f, 0.8f, 1.2f, 0.6f) else null
        TableRow(listOfNotNull("N°", if (analysis != null) "Type" else null, "Dist.", "Temps", if (running) "Allure" else "Vitesse", "FC"), header = true, weights = weights)
        Divider()
        shown.forEach { i ->
            val info = laps[i]
            val l = info.lap
            val role = if (analysis != null) {
                if (info.role == LapRole.WORK && info.group != null) "${analysis.groups[info.group!!].label} n°${info.rep}"
                else if (info.role == LapRole.RECOVERY && info.kind != null) "Récup ${analysis.recoveryKinds[info.kind!!].label}"
                else info.role.label
            } else null
            TableRow(
                listOfNotNull(
                    "${i + 1}", role, Fmt.km(l.distance), Fmt.clock(l.duration), if (running) Fmt.pace(l.averageSpeed) else Fmt.speed(l.averageSpeed), l.averageHr?.roundToInt()?.toString() ?: "–",
                ),
                muted = analysis != null && info.role != LapRole.WORK, emphasize = if (analysis != null) 4 else 3,
                colors = if (analysis != null && info.role == LapRole.WORK) mapOf(1 to pal.accent) else emptyMap(), weights = weights,
            )
        }
    }
}

/** What the phone keeps about one activity, with the curves and the GPS track when they are stored (or loaded on demand). */
/** An outing only Strava knows: what the server gave (name, description, labels) and the few numbers, without analysis, curves or load. */
@Composable
private fun StravaOnlyDetail(a: ActivityRow, onBack: () -> Unit) {
    val pal = LocalPal.current
    val s = a.strava ?: return
    Page {
        Row(Modifier.clickable(onClick = onBack), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, null, Modifier.size(18.dp), tint = pal.accent)
            Text("Activités", Modifier.padding(start = 6.dp), color = pal.accent, fontWeight = FontWeight.Medium)
        }
        Column {
            Text("${Fmt.typeLabel(a.type)} · Strava seulement", color = pal.accent, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(a.title, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = pal.text, lineHeight = 30.sp)
            Muted("${Fmt.longDate(LocalDate.parse(a.startLocal.take(10))).lowercase()} à ${a.startLocal.drop(11).take(5)}", Modifier.padding(top = 4.dp), size = 14)
        }
        Card {
            val cells = listOfNotNull(
                (a.distance?.takeIf { it > 0 })?.let { "Distance" to Fmt.km(it) },
                a.duration?.let { "Durée" to Fmt.clock(it) },
                (a.averageSpeed?.takeIf { a.isRun })?.let { "Allure" to Fmt.pace(it) },
                (a.elevation?.takeIf { it >= 50 })?.let { "Dénivelé" to "${it.roundToInt()} m" },
            )
            cells.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { (label, value) ->
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Muted(label)
                            Text(value, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = pal.text)
                        }
                    }
                    if (pair.size == 1) Box(Modifier.weight(1f)) {}
                }
            }
            Muted("Cette sortie n'est pas sur Garmin : pas d'analyse ni de charge.", Modifier.padding(top = 6.dp, start = 10.dp))
        }
        StravaCard(s)
    }
}

@Composable
fun ActivityDetailScreen(state: AppState, snap: Snapshot, opened: ActivityRow, onBack: () -> Unit) {
    // The row handed over can be older than the data: a choice made here (type, recovery) shows at once
    val a = snap.activities.firstOrNull { it.id == opened.id } ?: opened
    if (a.id < 0) {
        StravaOnlyDetail(a, onBack)
        return
    }
    val pal = LocalPal.current
    val scope = rememberCoroutineScope()
    var detail by remember(a.id) { mutableStateOf<ActivityDetail?>(null) }
    var checked by remember(a.id) { mutableStateOf(false) }
    var loading by remember(a.id) { mutableStateOf(false) }
    var error by remember(a.id) { mutableStateOf<String?>(null) }
    var metric by remember(a.id) { mutableStateOf<String?>(null) }
    LaunchedEffect(a.id) {
        detail = withContext(Dispatchers.IO) { state.db.detail(a.id) }
        checked = true
    }

    val analysis = snap.analysis
    val intervals = remember(detail, a.recoveryModes) { detail?.laps?.let { Intervals.analyze(it, a.recoveryModes) } }
    // Analysis of an interval session: only needs the laps, the curve adds the heart-rate recovery
    val sessionAnalysis by produceState<SessionAnalysis?>(null, a.id, detail, snap) {
        value = withContext(Dispatchers.IO) {
            val laps = detail?.laps ?: state.db.lapsOf(listOf(a.id))[a.id]
            if (laps == null || a.intervalTitle == null) null else snap.history.analyze(a.id, detail?.samples ?: emptyList(), laps)
        }
    }
    val remark = remember(sessionAnalysis) { SessionRemark.of(sessionAnalysis) }
    // On a Sunday run: the review of the week, also written in the Strava description
    val weekReview = remember(a.id, snap) { LocalDate.parse(a.startLocal.take(10)).takeIf { a.isRun && WeekReviews.isReviewDay(it) }?.let { WeekReviews.of(it, snap.activities, analysis, snap.history) } }
    val weekPoint = analysis.load.firstOrNull { it.date == a.startLocal.take(10) }
    val cells = listOfNotNull(
        Cell("distance", "Distance", Fmt.km(a.distance), false),
        Cell("duration", "Durée", Fmt.clock(a.duration), false),
        Cell("pace", if (a.isRun) "Allure" else "Vitesse", if (a.isRun) Fmt.pace(a.averageSpeed) else Fmt.speed(a.averageSpeed)).takeIf { a.isRun },
        Cell("speed", "Vitesse", Fmt.speed(a.averageSpeed), false).takeIf { !a.isRun },
        a.averageHr?.let { Cell("hr", "FC moyenne", "${it.roundToInt()} bpm") },
        analysis.globalLoadOn(a)?.let { Cell("week", "Charge globale", "${Fmt.num(it)} / 20") },
        // Elevation only matters when there is some
        a.elevation?.takeIf { it >= 100 }?.let { Cell("elevation", "Dénivelé", "${it.roundToInt()} m", false) },
    )

    // The altitude curve only when this outing climbs much more than usual, or when the whole week does
    val showAltitude = remember(a.id, snap) { hilly(a, snap.activities) }
    var infoOpen by remember(a.id) { mutableStateOf(false) }
    val accordion = remember(a.id) { androidx.compose.runtime.mutableStateOf<String?>(null) }
    if (infoOpen) InfoDialog(state, a, detail, intervals, textOf = { buildText(a, intervals, analysis, remark, weekReview) }) { infoOpen = false }

    androidx.compose.runtime.CompositionLocalProvider(LocalAccordion provides accordion) {
    Page {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.clip(RoundedCornerShape(10.dp)).then(if (pal.neo) Modifier.background(pal.yellow).border(pal.outline, pal.border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 6.dp) else Modifier).clickable(onClick = onBack),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, null, Modifier.size(18.dp), tint = if (pal.neo) pal.ink else pal.accent)
                Text(if (pal.neo) "ACTIVITÉS" else "Activités", Modifier.padding(start = 6.dp), color = if (pal.neo) pal.ink else pal.accent, fontWeight = if (pal.neo) FontWeight.Black else FontWeight.Medium)
            }
            val iShape = if (pal.neo) RoundedCornerShape(10.dp) else androidx.compose.foundation.shape.CircleShape
            Box(
                Modifier.size(if (pal.neo) 38.dp else 34.dp).clip(iShape).then(if (pal.neo) Modifier.background(pal.sky).border(pal.outline, pal.border, iShape) else Modifier.background(pal.accent.copy(alpha = 0.14f))).clickable { infoOpen = true },
                contentAlignment = Alignment.Center,
            ) { Text("i", color = if (pal.neo) pal.ink else pal.accent, fontSize = 16.sp, fontWeight = if (pal.neo) FontWeight.Black else FontWeight.Bold, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic) }
        }
        Column {
            if (pal.neo) Text(Categories.label(a.category).uppercase(), Modifier.clip(RoundedCornerShape(50)).background(categoryColor(pal, a.category)).border(2.dp, pal.border, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 3.dp), color = pal.ink, fontSize = 12.sp, fontWeight = FontWeight.Black)
            else Text(Fmt.typeLabel(a.type), color = pal.accent, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(a.title, Modifier.padding(top = if (pal.neo) 6.dp else 0.dp), fontSize = if (pal.neo) 26.sp else 24.sp, fontWeight = if (pal.neo) FontWeight.Black else FontWeight.SemiBold, color = pal.text, lineHeight = 30.sp)
            Muted("${Fmt.longDate(LocalDate.parse(a.startLocal.take(10))).lowercase()} à ${a.startLocal.drop(11).take(5)}", Modifier.padding(top = 4.dp), size = 14)
            Box(Modifier.padding(top = 10.dp)) { CategoryPicker(state, a) }
            remark?.let { SessionRemarkLine(it, Modifier.padding(top = 12.dp)) }
        }

        Card {
            cells.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { c ->
                        val selected = metric == c.key
                        Column(
                            Modifier.weight(1f).clip(RoundedCornerShape(12.dp))
                                .background(if (selected) pal.accent.copy(alpha = 0.1f) else androidx.compose.ui.graphics.Color.Transparent)
                                .then(if (c.clickable) Modifier.clickable { metric = if (selected) null else c.key } else Modifier)
                                .padding(horizontal = 10.dp, vertical = 10.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Muted(c.label)
                                if (c.clickable) Icon(Icons.Filled.ExpandMore, null, Modifier.padding(start = 2.dp).size(14.dp), tint = if (selected) pal.accent else pal.neutral)
                            }
                            Text(c.value, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = if (selected) pal.accent else pal.text)
                        }
                    }
                    if (pair.size == 1) Box(Modifier.weight(1f)) {}
                }
            }
            weekPoint?.let { Muted("Semaine qui finit ce jour-là : ${Math.round(it.weekKm)} km et ${it.weekSessions} séance${if (it.weekSessions > 1) "s" else ""}.", Modifier.padding(top = 8.dp, start = 10.dp)) }
        }

        metric?.let { key ->
            insight(key, a, snap, sessionAnalysis)?.let { i ->
                Card(highlight = true) {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (i.percent != null) Gauge(i.percent, i.gaugeLabel, 150.dp)
                        Text(i.text, Modifier.padding(top = if (i.percent != null) 8.dp else 0.dp), color = pal.text, textAlign = TextAlign.Start, lineHeight = 21.sp, fontSize = 14.sp)
                        i.zoneValue?.let { LoadZoneGauge(it, Modifier.padding(top = 16.dp)) }
                        if (i.parts.isNotEmpty()) InsightParts(i.parts)
                    }
                }
            }
        }

        // Nothing else shows for a moment while the curves and the analysis load from the base
        if (!checked || (a.intervalTitle != null && sessionAnalysis == null)) Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Muted("Chargement…", Modifier.padding(start = 10.dp), size = 14)
        }
        sessionAnalysis?.let { SessionAnalysisCard(it) }
        weekReview?.let { WeekReviewCard(it) }
        intervals?.let { iv -> IntervalCard(iv, remember(detail) { detail?.let { Intervals.notes(it.laps, it.samples) } ?: emptyList() }) }
        detail?.let { Curves(it, a, showAltitude) }
        if (a.teLabel != null || a.aerobicTe != null) TrainingEffectCard(a)
        // Kilometer splits mean little on an interval session: the reps table replaces them
        detail?.let { d ->
            val splits = remember(d) { Splits.compute(d.samples) }
            if (splits.isNotEmpty() && intervals == null) SplitsCard(splits, a.isRun)
            val lapRows = intervals?.laps ?: d.laps.map { LapInfo(it, LapRole.OTHER) }
            // What the app would write on Strava for this session, folded, just before the watch laps
            buildText(a, intervals, analysis, remark, weekReview)?.let { text ->
                FoldCard(title = "Texte pour Strava") {
                    androidx.compose.foundation.text.selection.SelectionContainer {
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(pal.track).padding(12.dp)) {
                            Text(text.name, color = pal.text, fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold)
                            Text(text.description, Modifier.padding(top = 8.dp), color = pal.muted, fontSize = 12.sp, lineHeight = 17.sp)
                        }
                    }
                    TextActions(state, a, if (text.interval) intervals else null, text)
                }
            }
            if (lapRows.size > 1) LapsCard(lapRows, intervals, a.isRun)
        }

        if (checked && detail == null && (a.distance ?: 0.0) >= 1000) {
            Card {
                Muted("La courbe, le tracé GPS et les tours de cette activité ne sont pas encore sur le téléphone.", size = 14)
                Button(
                    {
                        loading = true
                        error = null
                        scope.launch {
                            try {
                                detail = withContext(Dispatchers.IO) { Sync.detail(state.auth, state.db, a.id) }
                                state.reload()
                            } catch (e: Exception) {
                                error = e.message ?: e.javaClass.simpleName
                            } finally {
                                loading = false
                            }
                        }
                    },
                    Modifier.fillMaxWidth().padding(top = 12.dp), enabled = !loading,
                ) {
                    if (loading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = pal.card)
                    Text(if (loading) "Chargement…" else "Charger la courbe, le tracé et les tours", Modifier.padding(start = if (loading) 8.dp else 0.dp))
                }
                error?.let { Text(it, Modifier.padding(top = 8.dp), color = pal.bad, fontSize = 14.sp) }
            }
        }
    }
    }
}


/** The title and description the app would put on Strava for this session, or null when it has none. */
private fun buildText(a: ActivityRow, intervals: IntervalAnalysis?, analysis: Analysis, remark: String?, week: WeekReview?): StravaText? = when {
    a.intervalTitle != null -> intervals?.let { StravaTextBuilder.build(it, analysis.globalLoadOn(a), remark, a.speciality, week, RecoveryCheck.line(StravaTexts.readinessOf(a, analysis))) }
    a.isRun && a.category in setOf("easy", "long") -> StravaTextBuilder.buildEasy(a, analysis.globalLoadOn(a), week, RecoveryCheck.line(StravaTexts.readinessOf(a, analysis)))
    else -> null
}

/** True when this outing climbs much more than the usual ones, or when the 7 days ending with it climb much more than the usual week. */
private fun hilly(a: ActivityRow, all: List<ActivityRow>): Boolean {
    val runs = all.filter { it.isRun && it.id > 0 }
    val usual = runs.mapNotNull { it.elevation }.sorted().let { if (it.isEmpty()) 0.0 else it[it.size / 2] }
    val own = a.elevation ?: 0.0
    if (own >= 60 && own >= 2.5 * usual) return true
    val day = LocalDate.parse(a.startLocal.take(10))
    fun weekEnding(d: LocalDate) = runs.filter { val x = LocalDate.parse(it.startLocal.take(10)); !x.isAfter(d) && x.isAfter(d.minusDays(7)) }.sumOf { it.elevation ?: 0.0 }
    val before = (1..8).map { weekEnding(day.minusDays(7L * it)) }
    val usualWeek = before.average()
    val week = weekEnding(day)
    return week >= 300 && week >= 1.5 * usualWeek
}

private class InfoLine(val text: String, val tone: String = "info")

private fun toneColor(pal: Pal, tone: String) = when (tone) {
    "ok" -> pal.good
    "warn" -> pal.warn
    "bad" -> pal.bad
    else -> pal.accent
}

/** A small rounded status label, tinted by its tone (a flat color with a dark text in the neo looks). */
@Composable
private fun InfoPill(text: String, tone: String) {
    val pal = LocalPal.current
    val color = toneColor(pal, tone)
    val shape = RoundedCornerShape(if (pal.neo) pal.radius else 50.dp)
    Text(
        text, Modifier.clip(shape).background(if (pal.neo) neoFill(pal, color) else color.copy(alpha = 0.15f)).then(if (pal.neo) Modifier.border(2.dp, pal.border, shape) else Modifier).padding(horizontal = 10.dp, vertical = 4.dp),
        color = if (pal.neo) pal.ink else color, fontSize = 12.sp, fontWeight = if (pal.neo) FontWeight.Black else FontWeight.Medium,
    )
}

/**
 * The "i" of a session: a status pill per subject at the top (Strava, Garmin, corrections), then one card per subject with its lines, each with
 * a colored dot, and the lines of the journal that mention the session.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InfoDialog(state: AppState, a: ActivityRow, detail: ActivityDetail?, intervals: IntervalAnalysis?, textOf: () -> StravaText?, onClose: () -> Unit) {
    val pal = LocalPal.current
    val journal by produceState(emptyList<Db.LogRow>(), a.id) { value = withContext(Dispatchers.IO) { state.db.logsMatching(a.id.toString()) } }
    val sent = remember(a.id) { state.db.stravaSent()["t${a.id}"]?.first }
    val text = remember(a.id, intervals) { textOf() }
    val hash = text?.let { (it.name + "\n" + it.description).hashCode().toString(16) }
    val strava = a.strava
    val waiting = a.id in state.stravaWaitingIds
    val identical = strava != null && text != null && strava.description.replace("\r\n", "\n").trim() == text.description.trim() && strava.name.trim() == text.name.trim()

    val stravaLines = buildList {
        if (!state.stravaConfigured) add(InfoLine("Pas de serveur Strava configuré.", "info"))
        else if (strava == null) add(if (waiting) InfoLine("En attente : la sortie n'est pas encore sur Strava, l'appli regarde chaque minute.", "warn") else InfoLine("Pas encore reliée à une sortie Strava.", "warn"))
        else {
            add(InfoLine("Reliée à « ${strava.name} ».", "ok"))
            add(if (strava.labels.isEmpty()) InfoLine("Aucun label sur Strava.", "info") else InfoLine("Label : ${strava.labels.joinToString(", ") { l -> StravaSync.labelFr(l) }}.", "info"))
            if (text != null) add(when {
                identical -> InfoLine("Texte relu sur le serveur : identique à celui de l'appli.", "ok")
                sent == hash -> InfoLine("Texte envoyé, pas encore relu à jour sur ce téléphone.", "warn")
                else -> InfoLine("Texte pas encore envoyé (ou modifié depuis l'envoi).", "warn")
            })
        }
    }
    val garminLines = buildList {
        add(if (detail != null) InfoLine("Courbe, tracé et ${detail.laps.size} tours sont sur le téléphone.", "ok") else InfoLine("La courbe et les tours ne sont pas encore chargés.", "warn"))
        if (state.lastSyncAt > 0) add(InfoLine("Dernière synchro réussie : ${Fmt.relative(state.lastSyncAt)}.", "info"))
    }
    val fixLines = buildList {
        (detail?.let { Intervals.notes(it.laps, it.samples) } ?: emptyList()).forEach { add(InfoLine(it, "warn")) }
        a.manualCategory?.let { add(InfoLine("Type choisi à la main : ${Categories.label(it)}.", "info")) }
        a.recoveryModes.takeIf { it.isNotEmpty() }?.let { add(InfoLine("Récupérations choisies à la main : ${it.entries.joinToString(", ") { (k, v) -> "$k ${if (v) "en distance" else "au temps"}" }}.", "info")) }
        a.speciality?.takeIf { it != "none" }?.let { add(InfoLine("Spé choisie : $it.", "info")) }
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f, fill = false).verticalScroll(androidx.compose.foundation.rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Card(highlight = pal.neo) {
                    Text(if (pal.neo) "CETTE SÉANCE" else "Cette séance", fontSize = 20.sp, fontWeight = if (pal.neo) FontWeight.Black else FontWeight.SemiBold, color = LocalPal.current.text)
                    Muted(a.title, Modifier.padding(top = 2.dp), size = 13)
                    androidx.compose.foundation.layout.FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        InfoPill(if (!state.stravaConfigured) "Strava · désactivé" else if (strava == null) (if (waiting) "Strava · en attente" else "Strava · non reliée") else if (identical || text == null) "Strava · à jour" else "Strava · à envoyer", if (!state.stravaConfigured) "info" else if (strava == null) "warn" else if (identical || text == null) "ok" else "warn")
                        InfoPill(if (detail != null) "Garmin · complet" else "Garmin · incomplet", if (detail != null) "ok" else "warn")
                        InfoPill(if (fixLines.isEmpty()) "Aucune correction" else "${fixLines.size} correction${if (fixLines.size > 1) "s" else ""}", if (fixLines.isEmpty()) "info" else "warn")
                    }
                }
                listOf("Strava" to stravaLines, "Garmin" to garminLines, "Corrigé par l'appli ou par toi" to fixLines.ifEmpty { listOf(InfoLine("Rien à signaler.", "ok")) }).forEach { (title, lines) ->
                    Card(title = title) {
                        lines.forEachIndexed { i, l ->
                            Row(Modifier.fillMaxWidth().padding(top = if (i > 0) 8.dp else 0.dp), verticalAlignment = Alignment.Top) {
                                Box(Modifier.padding(top = 6.dp).size(10.dp).clip(androidx.compose.foundation.shape.CircleShape).background(toneColor(LocalPal.current, l.tone)))
                                Text(l.text, Modifier.padding(start = 10.dp), color = LocalPal.current.text, fontSize = 14.sp, lineHeight = 20.sp)
                            }
                        }
                    }
                }
                Card(title = "Journal") {
                    if (journal.isEmpty()) Muted("Aucune ligne pour cette séance.", size = 13)
                    else Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(LocalPal.current.track).padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        journal.forEach {
                            Text("${Fmt.dateTime(it.at)}  ${it.tag}  ${it.msg}", color = if (it.level == "E") LocalPal.current.bad else if (it.level == "W") LocalPal.current.warn else LocalPal.current.muted, fontSize = 11.sp, lineHeight = 15.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                        }
                    }
                }
            }
            Button(onClose, Modifier.fillMaxWidth()) { Text(if (pal.neo) "FERMER" else "Fermer", fontWeight = if (pal.neo) FontWeight.Black else FontWeight.Medium) }
        }
    }
}

/**
 * The pieces of a figure, drawn: a stacked bar of what each piece brings to the total (when the pieces have weights), then one gauge row per
 * piece with its weight in quotes (« 40 % de la note »), its value, an "i" that explains how it is calculated, and one line of why for this session.
 */
@Composable
private fun InsightParts(parts: List<InsightPart>) {
    val pal = LocalPal.current
    val colors = listOf(pal.accent, pal.violet, pal.warn, pal.good)
    var help by remember { mutableStateOf<InsightPart?>(null) }
    help?.let { h -> HelpDialog(h) { help = null } }
    Column(Modifier.fillMaxWidth().padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val weighted = parts.filter { it.weight != null }
        if (weighted.size > 1) {
            val total = weighted.sumOf { it.weight!! * it.fraction }
            if (total > 0) {
                Column {
                    Muted("Ce que chaque part apporte au total", size = 12)
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp).height(18.dp).clip(RoundedCornerShape(if (pal.neo) 5.dp else 9.dp)).then(if (pal.neo) Modifier.border(2.dp, pal.border, RoundedCornerShape(5.dp)) else Modifier)) {
                        weighted.forEach { p -> Box(Modifier.weight((p.weight!! * p.fraction / total).toFloat().coerceAtLeast(0.001f)).fillMaxHeight().background(if (pal.neo) neoFill(pal, colors[p.tone % 4]) else colors[p.tone % 4])) }
                    }
                }
            }
        }
        parts.forEach { p ->
            Column {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(androidx.compose.foundation.shape.CircleShape).background(colors[p.tone % 4]))
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(p.label, color = pal.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            p.weight?.let { Muted("« ${Math.round(it * 100)} % ${p.weightOf} »", size = 11) }
                        }
                    }
                    Text(p.value, color = pal.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Box(Modifier.padding(start = 10.dp)) { SmallInfoButton { help = p } }
                }
                ProgressBar(p.fraction, colors[p.tone % 4], Modifier.fillMaxWidth().padding(top = 6.dp))
                Muted(p.detail, Modifier.padding(top = 4.dp), size = 12)
            }
        }
    }
}

/** The small "i" next to a figure: a round tinted button (a bordered square in the neo looks) that opens its explanation. */
@Composable
fun SmallInfoButton(onClick: () -> Unit) {
    val pal = LocalPal.current
    val shape = if (pal.neo) RoundedCornerShape(8.dp) else androidx.compose.foundation.shape.CircleShape
    Box(
        Modifier.size(26.dp).clip(shape).then(if (pal.neo) Modifier.background(pal.sky).border(2.dp, pal.border, shape) else Modifier.background(pal.accent.copy(alpha = 0.14f))).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text("i", color = if (pal.neo) pal.ink else pal.accent, fontSize = 13.sp, fontWeight = FontWeight.Black, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic) }
}

/** The window of an "i": roomy, one sentence, then each scale with the place of this session on it, then the rules, one per line. */
@Composable
private fun HelpDialog(part: InsightPart, onClose: () -> Unit) {
    val pal = LocalPal.current
    val colors = listOf(pal.accent, pal.violet, pal.warn, pal.good)
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp)) {
            Card(title = part.label) {
                Column(Modifier.padding(horizontal = 4.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(26.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        part.weight?.let { InfoPill("« ${Math.round(it * 100)} % ${part.weightOf} »", "info") }
                        Text(part.help.summary, color = LocalPal.current.text, fontSize = 17.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium)
                    }
                    part.help.scales.forEach { HelpScale(it, colors[part.tone % 4]) }
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        part.help.bullets.forEach { b ->
                            Row(verticalAlignment = Alignment.Top) {
                                Box(Modifier.padding(top = 7.dp).size(10.dp).clip(androidx.compose.foundation.shape.CircleShape).background(colors[part.tone % 4]))
                                Text(b, Modifier.padding(start = 14.dp), color = LocalPal.current.text, fontSize = 15.sp, lineHeight = 22.sp)
                            }
                        }
                    }
                    Button(onClose, Modifier.fillMaxWidth().height(48.dp)) { Text(if (LocalPal.current.neo) "OK" else "Fermer", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

/** A bar from weak to strong with the ticks of the scale under it and a bubble, a stem and a knob where this session sits. */
@Composable
private fun HelpScale(scale: ScaleSpec, tone: androidx.compose.ui.graphics.Color) {
    val pal = LocalPal.current
    Column {
        Muted(scale.label, size = 13)
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            val width = maxWidth
            val bubble = 74.dp
            val bubbleX = (width * scale.marker - bubble / 2).coerceIn(0.dp, width - bubble)
            Column {
                Box(Modifier.offset(x = bubbleX).width(bubble)) {
                    Text(scale.markerText, Modifier.fillMaxWidth().clip(RoundedCornerShape(if (pal.neo) pal.radius else 8.dp)).background(if (pal.neo) neoFill(pal, tone) else tone).then(if (pal.neo) Modifier.border(2.dp, pal.border, RoundedCornerShape(pal.radius)) else Modifier).padding(vertical = 5.dp), color = if (pal.neo) pal.ink else androidx.compose.ui.graphics.Color.White, fontSize = 13.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
                }
                Box(Modifier.padding(top = 8.dp).fillMaxWidth().height(22.dp)) {
                    Row(Modifier.fillMaxSize().clip(RoundedCornerShape(11.dp)).then(if (pal.neo) Modifier.border(2.dp, pal.border, RoundedCornerShape(11.dp)) else Modifier)) {
                        Box(Modifier.weight(1f).fillMaxSize().background(pal.bad.copy(alpha = 0.35f)))
                        Box(Modifier.weight(1f).fillMaxSize().background(pal.warn.copy(alpha = 0.35f)))
                        Box(Modifier.weight(1f).fillMaxSize().background(pal.good.copy(alpha = 0.35f)))
                    }
                    Box(Modifier.offset(x = width * scale.marker - 3.dp).width(6.dp).fillMaxHeight().background(pal.text))
                }
                Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(34.dp)) {
                    scale.ticks.forEach { (f, label) ->
                        val w = 92.dp
                        val x = (width * f - w / 2).coerceIn(0.dp, width - w)
                        Text(label, Modifier.offset(x = x).width(w), color = pal.muted, fontSize = 11.sp, lineHeight = 14.sp, textAlign = if (f <= 0f) TextAlign.Start else if (f >= 1f) TextAlign.End else TextAlign.Center)
                    }
                }
            }
        }
    }
}
