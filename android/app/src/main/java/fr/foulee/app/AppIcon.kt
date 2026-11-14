package fr.foulee.app

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/** The launcher icon follows the style: the yellow one with the Néo style, the blue one otherwise. Applied when the app goes to the background, never in front of the user. */
object AppIcon {
    fun apply(context: Context, style: String) {
        val pm = context.packageManager
        val neo = ComponentName(context, "fr.foulee.app.LauncherNeo")
        val classic = ComponentName(context, "fr.foulee.app.LauncherFoulee")
        val wantNeo = style == "neo"
        fun set(c: ComponentName, on: Boolean) {
            val state = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            if (pm.getComponentEnabledSetting(c) != state) pm.setComponentEnabledSetting(c, state, PackageManager.DONT_KILL_APP)
        }
        // Enable the new entry first so the app never disappears from the launcher
        set(if (wantNeo) neo else classic, true)
        set(if (wantNeo) classic else neo, false)
    }

    /** Starts the app again from scratch: the launcher entry of the chosen style is switched first, then the process ends. */
    fun restart(context: Context, style: String) {
        apply(context, style)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(launch)
        Runtime.getRuntime().exit(0)
    }
}
