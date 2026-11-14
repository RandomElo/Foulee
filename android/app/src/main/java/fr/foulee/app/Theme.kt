package fr.foulee.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

/**
 * The palette of the app. [neo] marks the neo-brutalist looks: the components then draw thick outlines and solid offset shadows, and the flat
 * fill colors (yellow, pink, sky, mint, orange, lilac) come into play. [ink] is always dark (text on a flat fill), [band] and [onBand] the
 * title bands (black with yellow text on light, yellow with black text on dark).
 */
data class Pal(
    val bg: Color, val card: Color, val border: Color, val text: Color, val muted: Color, val accent: Color, val track: Color,
    val good: Color, val warn: Color, val bad: Color, val neutral: Color, val violet: Color,
    val neo: Boolean = false,
    val yellow: Color = Color(0xFFFFD23F), val pink: Color = Color(0xFFFF7AA2), val sky: Color = Color(0xFF7AD3FF),
    val mint: Color = Color(0xFF8BF28B), val orange: Color = Color(0xFFFF9F45), val lilac: Color = Color(0xFFB69CFF),
    val ink: Color = Color(0xFF111111), val band: Color = Color(0xFF111111), val onBand: Color = Color(0xFFFFD23F),
    val shadow: Color = Color(0xFF111111), val outline: Dp = 3.dp, val offset: Dp = 4.dp, val radius: Dp = 10.dp,
    val dark: Boolean = false,
) {
    /** The same palette seen from a flat fill: dark text whatever the mode. */
    fun onFill() = copy(text = ink, muted = Color(0xFF4B4B4B), border = ink)
}

private val light = Pal(
    bg = Color(0xFFF8FAFC), card = Color.White, border = Color(0xFFE2E8F0), text = Color(0xFF0F172A), muted = Color(0xFF64748B),
    accent = Color(0xFF2A78D6), track = Color(0xFFF1F5F9), good = Color(0xFF10B981), warn = Color(0xFFF59E0B), bad = Color(0xFFEF4444), neutral = Color(0xFF94A3B8), violet = Color(0xFF6250D6),
)
private val dark = Pal(
    bg = Color(0xFF020617), card = Color(0xFF0F172A), border = Color(0xFF1E293B), text = Color(0xFFF1F5F9), muted = Color(0xFF94A3B8),
    accent = Color(0xFF3987E5), track = Color(0xFF1E293B), good = Color(0xFF10B981), warn = Color(0xFFF59E0B), bad = Color(0xFFEF4444), neutral = Color(0xFF64748B), violet = Color(0xFF9085E9),
    dark = true,
)

/** The neo look: cream background, thin outlines, short solid shadows, rounded corners and soft flat colors. */
private val neoLight = Pal(
    bg = Color(0xFFFBF6E9), card = Color.White, border = Color(0xFF2A2A2A), text = Color(0xFF222222), muted = Color(0xFF5A5A5A),
    accent = Color(0xFF2F5BD1), track = Color(0xFFF1E8CC), good = Color(0xFF2B9A52), warn = Color(0xFFC7731A), bad = Color(0xFFC9344F), neutral = Color(0xFF777777), violet = Color(0xFF6A55D8),
    neo = true, yellow = Color(0xFFF7D774), pink = Color(0xFFF5A9C0), sky = Color(0xFF9ADAF2), mint = Color(0xFFABE5AB), orange = Color(0xFFF3B672), lilac = Color(0xFFC9B9F2),
    ink = Color(0xFF222222), band = Color(0xFF2A2A2A), onBand = Color(0xFFF7D774), shadow = Color(0xFF2A2A2A), outline = 2.5.dp, offset = 3.5.dp, radius = 14.dp,
)

val LocalPal = staticCompositionLocalOf { light }

/** What the user chose: a [family] ("revue" or "neo") and a [mode] ("auto", "light" or "dark"). */
object AppStyle {
    var family by androidx.compose.runtime.mutableStateOf("revue")
    var mode by androidx.compose.runtime.mutableStateOf("auto")
    val neo get() = family != "revue"
}

@Composable
fun FouleeTheme(content: @Composable () -> Unit) {
    // Only the reviewed style has a dark mode ("auto" follows the phone); the neo styles are always light
    val isDark = AppStyle.family == "revue" && when (AppStyle.mode) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val pal = when (AppStyle.family) {
        "neo" -> neoLight
        else -> if (isDark) dark else light
    }
    val scheme = when {
        pal.neo -> (if (pal.dark) darkColorScheme(primary = pal.yellow, onPrimary = pal.ink, background = pal.bg, surface = pal.card, onBackground = pal.text, onSurface = pal.text)
        else lightColorScheme(primary = pal.text, onPrimary = pal.onBand, background = pal.bg, surface = pal.card, onBackground = pal.text, onSurface = pal.text, secondaryContainer = pal.yellow, onSecondaryContainer = pal.ink, surfaceVariant = pal.track))
            .copy(outline = pal.text, outlineVariant = pal.text)
        pal.dark -> darkColorScheme(primary = pal.accent, background = pal.bg, surface = pal.card, onBackground = pal.text, onSurface = pal.text)
        else -> lightColorScheme(primary = pal.accent, background = pal.bg, surface = pal.card, onBackground = pal.text, onSurface = pal.text)
    }
    // The system bars follow the look of the app, not the phone's theme: dark icons on the light (and yellow) bars, light icons on the dark one
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.SideEffect {
        (view.context as? android.app.Activity)?.window?.let { w ->
            androidx.core.view.WindowCompat.getInsetsController(w, view).apply { isAppearanceLightStatusBars = !pal.dark; isAppearanceLightNavigationBars = !pal.dark }
        }
    }
    CompositionLocalProvider(LocalPal provides pal) { MaterialTheme(colorScheme = scheme, content = content) }
}
