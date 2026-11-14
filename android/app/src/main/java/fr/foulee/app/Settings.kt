package fr.foulee.app

import android.content.Context

/** Garmin tokens (encrypted with the Android Keystore; the password is never stored) and the runs already notified. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("foulee", Context.MODE_PRIVATE)

    init {
        NetworkDiagnostic.appContext = context.applicationContext
        // Before the references were asked, every install used these figures (the author's own): whoever is already signed in keeps them
        if (!prefs.contains("ref_vma") && loggedIn) {
            prefs.edit().putFloat("ref_vma", 19.2f).putFloat("ref_5k", 16 * 60 + 48f).putFloat("ref_10k", 37 * 60 + 2f).putFloat("ref_half", 83 * 60 + 48f).apply()
        }
        UserRefs.load(prefs)
        AppStyle.family = style
        AppStyle.mode = prefs.getString("mode", "auto") ?: "auto"
    }

    /** "revue" (Foulée, auto/light/dark) or "neo" (always light); a former "soft" choice becomes "neo". */
    var style: String get() = prefs.getString("style", "revue").let { if (it == "soft") "neo" else it ?: "revue" }; set(v) { prefs.edit().putString("style", v).apply(); AppStyle.family = v }
    var mode: String get() = prefs.getString("mode", "auto") ?: "auto"; set(v) { prefs.edit().putString("mode", v).apply(); AppStyle.mode = v }

    /** His references (VMA, records, heart rates): kept here, used for the zones, the race paces of the "Spé" texts and the heart-rate load. */
    fun saveRefs(vma: Double, rec5: Double, rec10: Double, recHalf: Double, hrMax: Int, hrRest: Int) {
        prefs.edit().putFloat("ref_vma", vma.toFloat()).putFloat("ref_5k", rec5.toFloat()).putFloat("ref_10k", rec10.toFloat()).putFloat("ref_half", recHalf.toFloat())
            .putInt("ref_hrmax", hrMax).putInt("ref_hrrest", hrRest).apply()
        UserRefs.load(prefs)
    }

    // Apart from the main file: signing out wipes that one, and the introduction must not come back for the same person
    private val ui = context.getSharedPreferences("foulee_ui", Context.MODE_PRIVATE)
    var onboardingDone: Boolean get() = ui.getBoolean("onboardingDone", false); set(v) = ui.edit().putBoolean("onboardingDone", v).apply()

    /** Seconds per item of a sync step, measured on earlier syncs: the time estimate of the next one starts from it. */
    fun stepRate(key: String): Double? = prefs.getFloat("rate_$key", -1f).takeIf { it > 0 }?.toDouble()
    fun setStepRate(key: String, seconds: Double) = prefs.edit().putFloat("rate_$key", seconds.toFloat()).apply()

    private fun string(key: String) = prefs.getString(key, null)

    var oauth1Token: String? get() = Secret.decrypt(string("oauth1Token")); set(v) = prefs.edit().putString("oauth1Token", v?.let(Secret::encrypt)).apply()
    var oauth1Secret: String? get() = Secret.decrypt(string("oauth1Secret")); set(v) = prefs.edit().putString("oauth1Secret", v?.let(Secret::encrypt)).apply()
    var accessToken: String? get() = Secret.decrypt(string("accessToken")); set(v) = prefs.edit().putString("accessToken", v?.let(Secret::encrypt)).apply()

    /** Epoch seconds */
    var accessExpiresAt: Long get() = prefs.getLong("accessExpiresAt", 0); set(v) = prefs.edit().putLong("accessExpiresAt", v).apply()
    var displayName: String? get() = string("displayName"); set(v) = prefs.edit().putString("displayName", v).apply()

    var firstName: String? get() = string("firstName"); set(v) = prefs.edit().putString("firstName", v).apply()
    var photoUrl: String? get() = string("photoUrl"); set(v) = prefs.edit().putString("photoUrl", v).apply()

    /** False until the first full sync: the runs already there are then marked as seen without a notification. */
    var initialized: Boolean get() = prefs.getBoolean("initialized", false); set(v) = prefs.edit().putBoolean("initialized", v).apply()

    var seenIds: Set<String> get() = prefs.getStringSet("seenIds", emptySet()) ?: emptySet(); set(v) = prefs.edit().putStringSet("seenIds", v).apply()

    /** Notification check every 15 minutes, on by default */
    var autoCheck: Boolean get() = prefs.getBoolean("autoCheck", true); set(v) = prefs.edit().putBoolean("autoCheck", v).apply()

    /** Epoch millis of the last successful sync, and of the last background check */
    var lastSuccessAt: Long get() = prefs.getLong("lastSuccessAt", 0); set(v) = prefs.edit().putLong("lastSuccessAt", v).apply()
    var lastCheckAt: Long get() = prefs.getLong("lastCheckAt", 0); set(v) = prefs.edit().putLong("lastCheckAt", v).apply()

    /** Version of the data kept locally: a lower one means the lists must be fetched again (new columns). */
    var dataVersion: Int get() = prefs.getInt("dataVersion", 0); set(v) = prefs.edit().putInt("dataVersion", v).apply()

    /** Version of the interval detection that wrote the stored titles: a lower one means they are computed again from the stored laps. */
    var titlesVersion: Int get() = prefs.getInt("titlesVersion", 0); set(v) = prefs.edit().putInt("titlesVersion", v).apply()

    /** Number of activities on Garmin, known after a sync (for the completeness gauge) */
    var garminTotal: Int get() = prefs.getInt("garminTotal", 0); set(v) = prefs.edit().putInt("garminTotal", v).apply()

    /** The home Strava server: address, key (encrypted like the Garmin tokens) and where the last fetch stopped. Both fields are optional. */
    var stravaUrl: String? get() = string("stravaUrl"); set(v) = prefs.edit().putString("stravaUrl", v).apply()
    var stravaKey: String? get() = Secret.decrypt(string("stravaKey")); set(v) = prefs.edit().putString("stravaKey", v?.let(Secret::encrypt)).apply()
    /** Local start ("yyyy-MM-dd HH:mm:ss") after which interval runs get their title and description written on Strava; set when the feature first runs. */
    /** Runs waiting to show up on Strava, as "activityId:detectedAtMillis" (see [StravaFollowUp]). */
    var stravaWaiting: Set<String> get() = prefs.getStringSet("stravaWaiting", emptySet()) ?: emptySet(); set(v) = prefs.edit().putStringSet("stravaWaiting", v).apply()
    /** Titles and descriptions of footings and long runs go by themselves when this is on (the server keeps the Workout label off them, since its version 0.3.0). */
    var easyTexts: Boolean get() = prefs.getBoolean("easyTexts", true); set(v) = prefs.edit().putBoolean("easyTexts", v).apply()
    /** Hidden switch (set with adb): writes the scores and the global loads to the journal, to tune the formulas on real data. */
    /** The day the "you recover badly" pop-up was last shown: once a day at most */
    var recoveryAlertDay: String? get() = prefs.getString("recoveryAlertDay", null); set(v) = prefs.edit().putString("recoveryAlertDay", v).apply()
    var diagnostic: Boolean get() = prefs.getBoolean("diagnostic", false); set(v) = prefs.edit().putBoolean("diagnostic", v).apply()
    var textsSince: String? get() = string("textsSince"); set(v) = prefs.edit().putString("textsSince", v).apply()
    var stravaCursor: String? get() = string("stravaCursor"); set(v) = prefs.edit().putString("stravaCursor", v).apply()

    /** What the last exchange with the home Strava server said (empty: all went well), and when. */
    var stravaStatus: String? get() = string("stravaStatus"); set(v) = prefs.edit().putString("stravaStatus", v).apply()
    var stravaStatusAt: Long get() = prefs.getLong("stravaStatusAt", 0); set(v) = prefs.edit().putLong("stravaStatusAt", v).apply()

    val loggedIn: Boolean get() = oauth1Token != null && oauth1Secret != null

    fun clear() = prefs.edit().clear().apply()
}
