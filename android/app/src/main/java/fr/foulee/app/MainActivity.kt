package fr.foulee.app

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private class Tab(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val tabs = listOf(
    Tab("Accueil", Icons.Filled.Home),
    Tab("Activités", Icons.Filled.DirectionsRun),
    Tab("Forme", Icons.Filled.MonitorHeart),
    Tab("Utilisateur", Icons.Filled.Person),
)

private const val USER_TAB = 3

class MainActivity : ComponentActivity() {
    private var appState: AppState? = null
    private var started = false

    // Back from the background: a sync or a check may have written new data while the screen showed the old one
    override fun onResume() {
        super.onResume()
        if (started) appState?.refresh() else started = true
    }

    // Switching the launcher entry can make some launchers close the screen it started from: it waits until the app is out of sight
    override fun onStop() {
        super.onStop()
        AppIcon.apply(applicationContext, Settings(applicationContext).style)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val state = AppState(applicationContext)
        appState = state
        if (state.loggedIn && Settings(applicationContext).autoCheck) Detection.schedule(this)
        setContent {
            FouleeTheme {
                LaunchedEffect(Unit) { state.start() }
                // Notifications are asked once the introduction is over, so the system dialog never hides it
                LaunchedEffect(state.onboardingDone) {
                    if (state.onboardingDone && Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                }
                App(state)
            }
        }
    }
}

@Composable
private fun App(state: AppState) {
    val pal = LocalPal.current
    if (!state.loggedIn && !state.onboardingDone) {
        OnboardingScreen(state) { state.finishOnboarding() }
        return
    }
    var tab by rememberSaveable { mutableStateOf(if (state.loggedIn) 0 else USER_TAB) }
    var open by remember { mutableStateOf<ActivityRow?>(null) }
    var review by remember { mutableStateOf(false) }
    // The tab a session was opened from (the validation of the labels lives in the profile tab): back goes there, not to the list
    var openFrom by remember { mutableStateOf<Int?>(null) }
    fun closeDetail() {
        open = null
        openFrom?.let { tab = it }
        openFrom = null
    }
    BackHandler(open != null || review) { if (open != null) closeDetail() else review = false }
    val snap = state.snapshot
    // A bad recovery is announced when the app opens, once a day
    val recovery = remember(snap) { snap?.let { RecoveryCheck.alert(it.analysis, it.activities) } }
    var recoverySeen by rememberSaveable { mutableStateOf(false) }
    if (recovery != null && !recoverySeen && state.loggedIn && state.recoveryAlertDue()) RecoveryDialog(recovery) { recoverySeen = true; state.recoveryAlerted() }
    // The neo looks color the top and bottom bars (white ones break the page); dark keeps them dark
    val barColor = if (pal.neo && !pal.dark) pal.yellow else pal.card
    val onBar = if (pal.neo && !pal.dark) pal.ink else pal.text
    Scaffold(
        containerColor = pal.bg,
        topBar = {
            Column {
                Row(Modifier.fillMaxWidth().background(barColor).padding(horizontal = 16.dp, vertical = 12.dp).padding(top = 28.dp), verticalAlignment = Alignment.CenterVertically) {
                    Image(painterResource(if (pal.neo) R.drawable.logo_neo else R.drawable.logo), null, Modifier.size(24.dp))
                    Text(if (pal.neo) "FOULÉE" else "Foulée", Modifier.padding(start = 8.dp).weight(1f).padding(end = 8.dp), fontWeight = if (pal.neo) FontWeight.Black else FontWeight.SemiBold, fontSize = 17.sp, color = onBar)
                    // A touch on the pill starts a sync; while one is running it opens the sync page to follow it
                    if (state.loggedIn) SyncBadge(state) { if (SyncEngine.current == null) state.sync("today") else { tab = USER_TAB; open = null; openFrom = null } }
                }
                if (pal.neo) Box(Modifier.fillMaxWidth().height(pal.outline).background(pal.border))
            }
        },
        bottomBar = {
            Column {
            if (pal.neo) Box(Modifier.fillMaxWidth().height(pal.outline).background(pal.border))
            NavigationBar(containerColor = barColor) {
                tabs.forEachIndexed { i, t ->
                    NavigationBarItem(
                        selected = tab == i, onClick = { tab = i; open = null; openFrom = null; review = false }, icon = { Icon(t.icon, null) }, label = { Text(if (i == USER_TAB) state.firstName ?: t.label else t.label, fontSize = 11.sp, maxLines = 1) },
                        colors = if (pal.neo) NavigationBarItemDefaults.colors(selectedIconColor = pal.ink, selectedTextColor = onBar, indicatorColor = if (pal.dark) pal.yellow else Color.White, unselectedIconColor = if (pal.dark) pal.muted else pal.ink.copy(alpha = 0.7f), unselectedTextColor = if (pal.dark) pal.muted else pal.ink.copy(alpha = 0.7f))
                        else NavigationBarItemDefaults.colors(selectedIconColor = pal.accent, selectedTextColor = pal.accent, indicatorColor = pal.accent.copy(alpha = 0.1f), unselectedIconColor = pal.muted, unselectedTextColor = pal.muted),
                    )
                }
            }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                tab == USER_TAB || !state.loggedIn -> SyncScreen(state, snap) { openFrom = USER_TAB; tab = 1; open = it }
                snap == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                open != null && (tab == 0 || tab == 1) -> ActivityDetailScreen(state, snap, open!!) { closeDetail() }
                tab == 0 -> HomeScreen(state, snap, { tab = 1 }) { open = it }
                tab == 1 && review -> ReviewScreen(state, snap, { review = false }) { open = it }
                tab == 1 -> ActivitiesScreen(snap, { review = true }) { open = it }
                else -> FormeScreen(snap)
            }
        }
    }
}

/** Health and the global load share one page: health first, the load right under it. */
@Composable
private fun FormeScreen(snap: Snapshot) {
    Column(Modifier.fillMaxSize().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 16.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
        androidx.compose.runtime.CompositionLocalProvider(LocalEmbedded provides true) {
            HealthScreen(snap)
            LoadScreen(snap)
        }
    }
}

/** Pill in the top bar, like the web one: progress while syncing, otherwise the state of the last sync. Tap to open the sync page. */
@Composable
private fun SyncBadge(state: AppState, onClick: () -> Unit) {
    val pal = LocalPal.current
    val current = SyncEngine.current
    val last = state.snapshot?.runs?.firstOrNull()
    val (label, color) = when {
        current != null -> "Synchronisation… ${current.progress} %" to pal.accent
        last?.status == "error" -> "Échec de la dernière synchro" to pal.bad
        last?.status == "partial" -> "Synchro partielle" to pal.warn
        else -> Settings(androidx.compose.ui.platform.LocalContext.current).lastSuccessAt.let { at -> (if (at <= 0) "Pas encore synchronisé" else "Synchronisé ${Fmt.relative(at)}") to pal.good }
    }
    Row(
        Modifier.clip(RoundedCornerShape(if (pal.neo) pal.radius else 50.dp)).background(if (pal.neo) (if (color == pal.bad) pal.pink else if (color == pal.warn) pal.orange else if (color == pal.accent) pal.sky else pal.mint) else androidx.compose.ui.graphics.Color.Transparent).border(if (pal.neo) pal.outline else 1.dp, pal.border, RoundedCornerShape(if (pal.neo) pal.radius else 50.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (current != null) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = if (pal.neo) pal.ink else color)
        else Icon(if (last?.status == "error" || last?.status == "partial") Icons.Filled.Warning else Icons.Filled.CheckCircle, null, Modifier.size(14.dp), tint = if (pal.neo) pal.ink else color)
        Text(label, Modifier.padding(start = 6.dp), color = if (pal.neo) pal.ink else color, fontSize = 13.sp, fontWeight = if (pal.neo) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
    }
}
