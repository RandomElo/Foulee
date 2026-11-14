package fr.foulee.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The look of the app: two styles (Foulée and Néo) and a mode (auto, light, dark); only Foulée has a dark mode. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StyleCard(state: AppState) {
    val pal = LocalPal.current
    val context = androidx.compose.ui.platform.LocalContext.current
    var askReload by remember { mutableStateOf(false) }
    Card(title = "Style de l'application") {
        Muted("Style", size = 13)
        androidx.compose.foundation.layout.FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("Foulée", AppStyle.family == "revue") { if (AppStyle.family != "revue") { state.chooseStyle("revue"); askReload = true } }
            Chip("Néo", AppStyle.family == "neo") { if (AppStyle.family != "neo") { state.chooseStyle("neo"); askReload = true } }
        }
        // Only the reviewed style has a dark mode: the neo ones are always light
        if (AppStyle.family == "revue") {
            Muted("Mode", Modifier.padding(top = 12.dp), size = 13)
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Auto", AppStyle.mode == "auto") { if (AppStyle.mode != "auto") { state.chooseMode("auto"); askReload = true } }
                Chip("Clair", AppStyle.mode == "light") { if (AppStyle.mode != "light") { state.chooseMode("light"); askReload = true } }
                Chip("Sombre", AppStyle.mode == "dark") { if (AppStyle.mode != "dark") { state.chooseMode("dark"); askReload = true } }
            }
        }
        Muted(
            when (AppStyle.family) {
                "neo" -> "Fond crème, contours fins, ombres pleines courtes et couleurs douces."
                else -> "Le style sobre de l'appli."
            } + (if (AppStyle.family == "revue") " Auto : suit le mode clair ou sombre du téléphone." else " Toujours en clair."),
            Modifier.padding(top = 10.dp), size = 13,
        )
    }
    if (askReload) androidx.compose.material3.AlertDialog(
        onDismissRequest = { askReload = false },
        containerColor = pal.card, titleContentColor = pal.text, textContentColor = pal.text,
        title = { Text("Recharger l'application maintenant ?") },
        text = { Text("Le nouveau style s'applique tout de suite, mais certains éléments graphiques (l'icône de l'appli, les barres du téléphone) ne se mettent à jour qu'à la prochaine fermeture. Recharger maintenant les met tous à jour, l'appli se relance en une seconde.") },
        confirmButton = { androidx.compose.material3.TextButton({ askReload = false; AppIcon.restart(context, AppStyle.family) }) { Text("Oui, recharger") } },
        dismissButton = { androidx.compose.material3.TextButton({ askReload = false }) { Text("Plus tard") } },
    )
}

/** His own references: VMA, records and heart rates. Everything computed from them (zones, race paces of the "Spé" texts) follows. */
@Composable
fun RefsCard(state: AppState) {
    val pal = LocalPal.current
    var vma by remember { mutableStateOf(if (UserRefs.vma > 0) Insights.dec(UserRefs.vma, 1) else "") }
    var r5 by remember { mutableStateOf(UserRefs.formatTime(UserRefs.rec5)) }
    var r10 by remember { mutableStateOf(UserRefs.formatTime(UserRefs.rec10)) }
    var rHalf by remember { mutableStateOf(UserRefs.formatTime(UserRefs.recHalf)) }
    var hrMax by remember { mutableStateOf(UserRefs.hrMax.takeIf { it > 0 }?.toString() ?: "") }
    var hrRest by remember { mutableStateOf(UserRefs.hrRest.takeIf { it > 0 }?.toString() ?: "") }
    var message by remember { mutableStateOf("") }
    val used = remember(UserRefs.hrMax, UserRefs.hrRest) { Insights.refs(state.db) }
    FoldCard(title = "Mes références") {
        val keys = KeyboardOptions(keyboardType = KeyboardType.Text)
        OutlinedTextField(vma, { vma = it }, Modifier.fillMaxWidth(), label = { Text("VMA (km/h)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(r5, { r5 = it }, Modifier.weight(1f), label = { Text("5 km") }, singleLine = true, keyboardOptions = keys)
            OutlinedTextField(r10, { r10 = it }, Modifier.weight(1f), label = { Text("10 km") }, singleLine = true, keyboardOptions = keys)
            OutlinedTextField(rHalf, { rHalf = it }, Modifier.weight(1f), label = { Text("Semi") }, singleLine = true, keyboardOptions = keys)
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(hrMax, { hrMax = it.filter(Char::isDigit) }, Modifier.weight(1f), label = { Text("FC max") }, placeholder = { Text("auto") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            OutlinedTextField(hrRest, { hrRest = it.filter(Char::isDigit) }, Modifier.weight(1f), label = { Text("FC repos") }, placeholder = { Text("auto") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        Muted("FC max et FC repos vides : l'appli les mesure sur tes données (aujourd'hui ${Math.round(used.max)} et ${Math.round(used.rest)} bpm). Les records sont écrits « 16:48 » ou « 1:23:48 » ; laisse vide ce que tu ne connais pas.", Modifier.padding(top = 8.dp), size = 13)
        Button({
            val v = if (vma.isBlank()) 0.0 else vma.replace(',', '.').toDoubleOrNull()
            val a = UserRefs.parseTimeOrUnknown(r5)
            val b = UserRefs.parseTimeOrUnknown(r10)
            val c = UserRefs.parseTimeOrUnknown(rHalf)
            if (v == null || a == null || b == null || c == null) message = "Un des champs n'est pas lisible."
            else {
                state.saveRefs(v, a, b, c, hrMax.toIntOrNull() ?: 0, hrRest.toIntOrNull() ?: 0)
                message = "Enregistré."
            }
        }, Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Enregistrer") }
        if (message.isNotEmpty()) Muted(message, Modifier.padding(top = 6.dp), size = 13)
    }
}

/** Heart-rate zones from his own references, and the pace he really runs in zone 2. */
@Composable
fun ZonesCard(snap: Snapshot) {
    val pal = LocalPal.current
    val refs = snap.analysis.refs
    val zones = remember(refs.rest, refs.max) { Zones.of(refs) }
    val ef = remember(snap, refs.rest, refs.max) { Zones.efPace(snap.activities, refs) }
    FoldCard(title = "Mes zones") {
        zones.forEach { z ->
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Z${z.number} · ${z.name}", color = pal.text, fontSize = 14.sp)
                Text("${z.from} à ${z.to} bpm", color = pal.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Muted("Réserve cardiaque entre ${Math.round(refs.rest)} bpm (repos) et ${Math.round(refs.max)} bpm (max), par tranches de 10 %.", Modifier.padding(top = 6.dp), size = 13)
        Column(Modifier.padding(top = 14.dp)) {
            Text("Mon allure en EF", fontWeight = FontWeight.SemiBold, color = pal.text, fontSize = 15.sp)
            if (ef == null) Muted("Pas assez de footings en zone 2 sur les 60 derniers jours pour la mesurer.", Modifier.padding(top = 3.dp), size = 13)
            else {
                Text(Fmt.pace(ef.first), Modifier.padding(top = 2.dp), fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = pal.text)
                Muted("Mesurée sur ${ef.third} footing${if (ef.third > 1) "s" else ""} de plus de 20 min en zone 2, FC moyenne ${Math.round(ef.second)} bpm.", Modifier.padding(top = 2.dp), size = 13)
            }
        }
    }
}
