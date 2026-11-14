package fr.foulee.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Colour of a load zone: grey, blue, green, orange, red. */
fun zoneTone(pal: Pal, index: Int): Color = listOf(pal.neutral, pal.accent, pal.good, pal.warn, pal.bad)[index]

/** Fill of a zone in the neo looks (a pastel of its own, never the yellow of the card), its plain colour otherwise. */
fun zoneFill(pal: Pal, index: Int): Color = if (pal.neo) listOf(pal.lilac, pal.sky, pal.mint, pal.orange, pal.pink)[index] else zoneTone(pal, index)

/** The five zones of the global load as one bar with a marker at [value], then the list of the zones with their ranges, and what the current one means. */
@Composable
fun LoadZoneGauge(value: Double, modifier: Modifier = Modifier) {
    val pal = LocalPal.current
    val zone = LoadZones.of(value)
    val frac = (value / 20).toFloat().coerceIn(0f, 1f)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(74.dp)) {
            val bubbleWidth = 56.dp
            val x = (maxWidth * frac - bubbleWidth / 2).coerceIn(0.dp, maxWidth - bubbleWidth)
            val tone = zoneTone(pal, zone.index)
            Box(
                Modifier.offset(x = x).width(bubbleWidth).clip(RoundedCornerShape(if (pal.neo) 10.dp else 50.dp))
                    .background(zoneFill(pal, zone.index)).then(if (pal.neo) Modifier.border(pal.outline, pal.border, RoundedCornerShape(10.dp)) else Modifier)
                    .padding(vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) { Text(Fmt.num(value), color = if (pal.neo) pal.ink else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            Box(Modifier.offset(x = maxWidth * frac - 1.5.dp, y = 28.dp).width(3.dp).height(44.dp).background(pal.text))
            Row(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(20.dp).clip(RoundedCornerShape(if (pal.neo) 8.dp else 10.dp)).then(if (pal.neo) Modifier.border(pal.outline, pal.border, RoundedCornerShape(8.dp)) else Modifier)) {
                LoadZones.all.forEach { z ->
                    val t = zoneTone(pal, z.index)
                    Box(Modifier.weight((z.to - z.from).toFloat()).height(20.dp).background(zoneFill(pal, z.index).copy(alpha = if (z.index == zone.index || pal.neo) 1f else 0.4f)))
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LoadZones.all.forEach { z ->
                val current = z.index == zone.index
                val t = zoneTone(pal, z.index)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(zoneFill(pal, z.index)).border(if (pal.neo) 2.dp else 0.dp, pal.border, CircleShape))
                    Text(z.label, Modifier.padding(start = 10.dp).weight(1f), color = pal.text, fontSize = 14.sp, fontWeight = if (current) FontWeight.Bold else FontWeight.Normal)
                    Text(if (z.index == 0) "moins de ${Fmt.num(z.to, 0)}" else if (z.index == 4) "${Fmt.num(z.from, 0)} et plus" else "${Fmt.num(z.from, 0)} à ${Fmt.num(z.to, 0)}", color = pal.muted, fontSize = 13.sp)
                }
            }
        }
        Text(zone.meaning, color = pal.text, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
    }
}

/** The review of a week: the three figures side by side (same height), then the interval sessions one per line, then the share of hard work. */
@Composable
fun WeekReviewCard(review: WeekReview) {
    val pal = LocalPal.current
    Card(title = "Bilan de la semaine du ${Fmt.dayMonth(review.monday)}") {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WeekFigure("${Fmt.num(review.km, 0)} km", if (review.lastKm > 0) "${Fmt.num(review.lastKm, 0)} km avant" else "semaine", Modifier.weight(1f).fillMaxHeight())
            WeekFigure(Txt.plural(review.sessions, "séance"), "", Modifier.weight(1f).fillMaxHeight())
            WeekFigure(review.load?.let { "${Fmt.num(it)} / 20" } ?: "–", review.zone?.label ?: "charge globale", Modifier.weight(1f).fillMaxHeight(), review.zone?.let { z -> zoneTone(pal, z.index) })
        }
        if (review.intervals.isEmpty()) Muted("Pas de fractionné cette semaine.", Modifier.padding(top = 14.dp), size = 14)
        else {
            Text("Fractionné", Modifier.padding(top = 16.dp), color = pal.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            review.intervals.forEach { s ->
                // Touch a session to read the first sentence of its analysis
                var open by remember { mutableStateOf(false) }
                Column(Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = s.summary != null) { open = !open }) {
                    Row(verticalAlignment = Alignment.Top) {
                        Text(review.dayName(s.day), Modifier.width(86.dp), color = pal.muted, fontSize = 14.sp)
                        Text(s.title, Modifier.weight(1f), color = pal.text, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium)
                        if (s.summary != null) Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, Modifier.size(18.dp), tint = pal.muted)
                    }
                    s.remark?.let { Text(it, Modifier.padding(start = 86.dp, top = 4.dp), color = pal.muted, fontSize = 13.sp, lineHeight = 18.sp) }
                    if (open) s.summary?.let { Text(it, Modifier.padding(start = 86.dp, top = 6.dp), color = pal.text, fontSize = 14.sp, lineHeight = 20.sp) }
                }
            }
        }
        review.intensityLine?.let { Muted(it, Modifier.padding(top = 14.dp), size = 14) }
    }
}

@Composable
private fun WeekFigure(value: String, caption: String, modifier: Modifier, tone: Color? = null) {
    val pal = LocalPal.current
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(pal.track).padding(horizontal = 10.dp, vertical = 10.dp), verticalArrangement = Arrangement.SpaceBetween) {
        Text(value, color = tone?.takeIf { !pal.neo } ?: pal.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        if (caption.isNotEmpty()) Muted(caption, Modifier.padding(top = 2.dp), size = 12)
    }
}

/** The one-sentence remark on a session, under its title. */
@Composable
fun SessionRemarkLine(text: String, modifier: Modifier = Modifier) {
    val pal = LocalPal.current
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (pal.neo) pal.yellow else pal.accent.copy(alpha = 0.1f)).then(if (pal.neo) Modifier.border(pal.outline, pal.border, RoundedCornerShape(12.dp)) else Modifier).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(text, color = if (pal.neo) pal.ink else pal.text, fontSize = 14.sp, lineHeight = 20.sp)
    }
}

/** Bars day by day, each in the colour of its zone; a touch or a drag selects a day (shared by the charts of the card). */
@Composable
private fun ZoneBars(values: List<Double?>, night: List<Boolean>, selected: Int?, onSelect: (Int) -> Unit) {
    val pal = LocalPal.current
    Canvas(
        Modifier.fillMaxWidth().height(110.dp)
            .pointerInput(values.size) { detectTapGestures { o -> onSelect((o.x / size.width * values.size).toInt().coerceIn(0, values.lastIndex)) } }
            .pointerInput(values.size) { detectHorizontalDragGestures { change, _ -> onSelect((change.position.x / size.width * values.size).toInt().coerceIn(0, values.lastIndex)) } },
    ) {
        val slot = size.width / values.size
        val bar = slot * 0.78f
        LoadZones.bounds.forEach { b -> val y = size.height * (1 - (b / 20).toFloat()); drawLine(pal.muted.copy(alpha = 0.35f), Offset(0f, y), Offset(size.width, y), 1.dp.toPx()) }
        values.forEachIndexed { i, v ->
            if (v == null) return@forEachIndexed
            val h = size.height * (v / 20).toFloat().coerceIn(0.02f, 1f)
            // The watch gave nothing that day (it was not synced): the bar is grey. A night without the watch worn is not a reason for it.
            val c = if (night.getOrNull(i) == false) pal.text.copy(alpha = 0.15f) else zoneFill(pal, LoadZones.of(v).index)
            drawRoundRect(c.copy(alpha = c.alpha * (if (selected == null || selected == i) 1f else 0.55f)), Offset(i * slot + (slot - bar) / 2, size.height - h), Size(bar, h), CornerRadius(bar / 3))
        }
        selected?.let { s -> drawLine(pal.text, Offset(s * slot + slot / 2, 0f), Offset(s * slot + slot / 2, size.height), 1.5.dp.toPx()) }
    }
}

/**
 * The global load day by day, each bar in the colour of its zone, with the number of days in each zone.
 */
@Composable
fun ProgressionCard(snap: Snapshot) {
    val pal = LocalPal.current
    var days by rememberSaveable { mutableStateOf(90) }
    val values by produceState<List<Triple<LocalDate, Double?, Boolean>>>(emptyList(), snap, days) {
        value = withContext(Dispatchers.Default) {
            val today = LocalDate.now()
            (days - 1 downTo 0).map { k ->
                val d = today.minusDays(k.toLong())
                val p = snap.analysis.globalPartsOn(d.toString())
                Triple(d, p?.total, p?.hasWatch ?: false)
            }
        }
    }
    var selected by remember(days) { mutableStateOf<Int?>(null) }
    Card(title = "Ma progression") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(30 to "1 mois", 90 to "3 mois", 180 to "6 mois").forEach { (n, label) -> Chip(label, days == n) { days = n } }
        }
        if (values.none { it.second != null }) {
            Muted("Pas encore assez de données pour retracer ta forme.", Modifier.padding(top = 12.dp), size = 14)
            return@Card
        }
        val index = selected ?: values.indexOfLast { it.second != null }
        val shown = values.getOrNull(index)
        Text(shown?.let { Fmt.date(it.first.toString()) } ?: " ", Modifier.padding(top = 14.dp), color = pal.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)

        Text(
            shown?.second?.let { "${Fmt.num(it)} / 20 · ${LoadZones.of(it).label}" + if (!shown.third) " · montre non synchronisée" else "" } ?: "pas de donnée",
            Modifier.padding(top = 4.dp), color = pal.text, fontSize = 14.sp,
        )
        ZoneBars(values.map { it.second }, values.map { it.third }, selected) { selected = it }

        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Muted(Fmt.date(values.first().first.toString()), size = 12)
            Muted(Fmt.date(values.last().first.toString()), size = 12)
        }
        val known = values.mapNotNull { it.second }
        Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LoadZones.all.reversed().forEach { z ->
                val n = known.count { LoadZones.of(it).index == z.index }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(zoneFill(pal, z.index)).border(if (pal.neo) 2.dp else 0.dp, pal.border, CircleShape))
                    Text(z.label, Modifier.padding(start = 10.dp).weight(1f), color = pal.text, fontSize = 14.sp)
                    Text(Txt.plural(n, "jour"), color = pal.muted, fontSize = 13.sp)
                }
            }
        }
    }
}

/** The pop-up of a bad recovery: the form of the morning, what weighs on it, and what to do. */
@Composable
fun RecoveryDialog(alert: RecoveryAlert, onClose: () -> Unit) {
    val pal = LocalPal.current
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose,
        containerColor = pal.card, titleContentColor = pal.text, textContentColor = pal.text,
        confirmButton = { androidx.compose.material3.TextButton(onClose) { Text("Compris") } },
        title = { Text("Tu récupères mal en ce moment", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(Modifier.clip(RoundedCornerShape(if (pal.neo) 10.dp else 50.dp)).background(if (pal.neo) pal.orange else pal.warn.copy(alpha = 0.15f)).then(if (pal.neo) Modifier.border(pal.outline, pal.border, RoundedCornerShape(10.dp)) else Modifier).padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Text("Forme du jour ${alert.score} / 100 · ${alert.label}", color = if (pal.neo) pal.ink else pal.warn, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
                Text("Ce qui pèse", color = pal.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                alert.causes.forEach { Bullet(it, pal.warn) }
                Text("Pistes", Modifier.padding(top = 4.dp), color = pal.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                alert.tips.forEach { Bullet(it, pal.good) }
            }
        },
    )
}

@Composable
private fun Bullet(text: String, tone: Color) {
    val pal = LocalPal.current
    Row(verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 7.dp).size(9.dp).clip(CircleShape).background(if (pal.neo) neoFill(pal, tone) else tone).border(if (pal.neo) 2.dp else 0.dp, pal.border, CircleShape))
        Text(text, Modifier.padding(start = 12.dp), color = pal.text, fontSize = 14.sp, lineHeight = 20.sp)
    }
}
