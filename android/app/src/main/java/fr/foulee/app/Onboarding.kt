package fr.foulee.app

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private class OnboardingPage(val icon: ImageVector, val title: String, val intro: String, val points: List<String>)

private val pages = listOf(
    OnboardingPage(
        Icons.Filled.DirectionsRun, "Bienvenue dans Foulée", "Ton suivi de course à pied, à partir de ta montre Garmin.",
        listOf("Tes séances et leur analyse, fractionnés compris", "Ta charge d'entraînement et ta forme du jour", "Un profil de coureur : points forts et points faibles"),
    ),
    OnboardingPage(
        Icons.Filled.PhoneAndroid, "Comment ça marche", "Foulée récupère tes données sur Garmin Connect, puis calcule tout sur ton téléphone.",
        listOf("Il faut ton compte Garmin Connect, le même que celui de ta montre", "La première synchro peut prendre quelques minutes", "Strava est facultatif : un serveur perso permet d'y envoyer titres et labels"),
    ),
    OnboardingPage(
        Icons.Filled.Lock, "Tes données restent chez toi", "Rien n'est envoyé à un serveur Foulée.",
        listOf(
            "Tout est stocké sur ton téléphone",
            "Ton mot de passe Garmin n'est jamais conservé : il sert une seule fois à ouvrir la session. Seuls des jetons de session sont gardés, chiffrés",
            "Tu peux te déconnecter à tout moment : les données du téléphone sont alors effacées",
        ),
    ),
)

/** The answers of the last screen: records and, when he knows them, his heart rates. A field left empty keeps the value the app already has. */
private class Refs(var vma: String = "", var r5: String = "", var r10: String = "", var rHalf: String = "", var hrMax: String = "", var hrRest: String = "")

/** First launch: short screens, his references, then the Garmin sign-in. Shown once, only to someone who is not signed in. */
@Composable
fun OnboardingScreen(state: AppState, onDone: () -> Unit) {
    val pal = LocalPal.current
    var page by rememberSaveable { mutableStateOf(0) }
    // The screens of [pages], then the references
    val refsPage = pages.size
    val last = page == refsPage
    var vma by rememberSaveable { mutableStateOf("") }
    var r5 by rememberSaveable { mutableStateOf("") }
    var r10 by rememberSaveable { mutableStateOf("") }
    var rHalf by rememberSaveable { mutableStateOf("") }
    var knowsHr by rememberSaveable { mutableStateOf<Boolean?>(null) }
    var hrMax by rememberSaveable { mutableStateOf("") }
    var hrRest by rememberSaveable { mutableStateOf("") }
    var confirmSkip by rememberSaveable { mutableStateOf(false) }
    // What he did not give: asked about once before going on
    val missing = buildList {
        if (vma.isBlank()) add("la VMA")
        if (r5.isBlank() || r10.isBlank() || rHalf.isBlank()) add("tes records")
        if (knowsHr == true && (hrMax.isBlank() || hrRest.isBlank())) add("tes fréquences cardiaques")
    }
    fun finish() {
        val v = vma.replace(',', '.').toDoubleOrNull() ?: 0.0
        val a = UserRefs.parseTime(r5) ?: 0.0
        val b = UserRefs.parseTime(r10) ?: 0.0
        val c = UserRefs.parseTime(rHalf) ?: 0.0
        val max = if (knowsHr == true) hrMax.toIntOrNull() ?: 0 else 0
        val rest = if (knowsHr == true) hrRest.toIntOrNull() ?: 0 else 0
        if (v > 0 || a > 0 || b > 0 || c > 0 || max > 0 || rest > 0) state.saveRefs(v, a, b, c, max, rest)
        onDone()
    }
    Column(
        Modifier.fillMaxSize().background(pal.bg).statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp)
            // Swipe left for the next screen, right for the previous one
            .pointerInput(page) {
                var drag = 0f
                detectHorizontalDragGestures(
                    onDragStart = { drag = 0f },
                    onDragEnd = { if (drag < -80 && page < refsPage) page++ else if (drag > 80 && page > 0) page-- },
                ) { _, amount -> drag += amount }
            },
    ) {
        Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.End) {
            if (!last) TextButton({ page = refsPage }) { Text("Passer", color = pal.muted) }
        }
        androidx.compose.animation.Crossfade(page, Modifier.weight(1f), label = "onboarding") { index ->
          if (index == refsPage) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(72.dp).clip(CircleShape).background(pal.accent.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Speed, null, Modifier.size(36.dp), tint = pal.accent)
                }
                Text("Tes références", Modifier.padding(top = 24.dp), color = pal.text, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold)
                Text("Elles servent à calculer tes allures de course et le titre « Spé » de tes séances. Tout est facultatif et modifiable dans le profil.", Modifier.padding(top = 12.dp), color = pal.muted, fontSize = 16.sp, lineHeight = 23.sp)
                OutlinedTextField(vma, { vma = it }, Modifier.fillMaxWidth().padding(top = 18.dp), label = { Text("VMA (km/h)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(r5, { r5 = it }, Modifier.weight(1f), label = { Text("5 km") }, placeholder = { Text("16:48") }, singleLine = true)
                    OutlinedTextField(r10, { r10 = it }, Modifier.weight(1f), label = { Text("10 km") }, placeholder = { Text("37:02") }, singleLine = true)
                    OutlinedTextField(rHalf, { rHalf = it }, Modifier.weight(1f), label = { Text("Semi") }, placeholder = { Text("1:23:48") }, singleLine = true)
                }
                Text("Connais-tu tes zones d'intensité en fréquence cardiaque ?", Modifier.padding(top = 22.dp), color = pal.text, fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium)
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Oui", knowsHr == true) { knowsHr = true }
                    Chip("Non", knowsHr == false) { knowsHr = false }
                }
                when (knowsHr) {
                    true -> Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(hrMax, { hrMax = it.filter(Char::isDigit) }, Modifier.weight(1f), label = { Text("FC max") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        OutlinedTextField(hrRest, { hrRest = it.filter(Char::isDigit) }, Modifier.weight(1f), label = { Text("FC repos") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    }
                    false -> Text("Pas de souci : elles seront analysées automatiquement à partir de tes sorties.", Modifier.padding(top = 12.dp), color = pal.muted, fontSize = 15.sp, lineHeight = 22.sp)
                    null -> {}
                }
            }
          } else {
          val current = pages[index]
          Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.Center) {
            Box(Modifier.size(72.dp).clip(CircleShape).background(pal.accent.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                Icon(current.icon, null, Modifier.size(36.dp), tint = pal.accent)
            }
            Text(current.title, Modifier.padding(top = 24.dp), color = pal.text, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold)
            Text(current.intro, Modifier.padding(top = 12.dp), color = pal.muted, fontSize = 17.sp, lineHeight = 24.sp)
            current.points.forEach { point ->
                Row(Modifier.padding(top = 18.dp), verticalAlignment = Alignment.Top) {
                    Box(Modifier.padding(top = 8.dp).size(8.dp).clip(CircleShape).background(pal.accent))
                    Text(point, Modifier.padding(start = 14.dp), color = pal.text, fontSize = 16.sp, lineHeight = 23.sp)
                }
            }
          }
          }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalArrangement = Arrangement.Center) {
            (0..refsPage).forEach { i ->
                Box(Modifier.padding(horizontal = 4.dp).size(if (i == page) 10.dp else 8.dp).clip(CircleShape).background(if (i == page) pal.accent else pal.border))
            }
        }
        Button({ if (!last) page++ else if (missing.isNotEmpty()) confirmSkip = true else finish() }, Modifier.fillMaxWidth().height(54.dp)) {
            Text(if (last) "Se connecter à Garmin" else "Suivant", fontSize = 17.sp, fontWeight = FontWeight.Medium)
        }
    }
    if (confirmSkip) androidx.compose.material3.AlertDialog(
        onDismissRequest = { confirmSkip = false },
        title = { Text("Continuer sans tes données ?") },
        text = { Text("Il manque ${missing.joinToString(", ")}. Tu peux les ajouter plus tard dans le profil, mais en attendant les calculs seront moins précis : allures de course, zones et titres « Spé » de tes séances.") },
        confirmButton = { TextButton({ confirmSkip = false; finish() }) { Text("Continuer sans") } },
        dismissButton = { TextButton({ confirmSkip = false }) { Text("Les renseigner") } },
    )
}
