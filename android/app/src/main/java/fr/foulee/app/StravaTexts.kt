package fr.foulee.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** A title and a description ready to go to Strava for one session. */
class TextItem(val activity: ActivityRow, val text: StravaText, val key: String, val hash: String, val json: JSONObject)

/**
 * Titles and descriptions of the new sessions (intervals, footings, long runs), sent to the home server (POST /api/seances). Only runs that started after the
 * feature was switched on go: the history is never touched. A text that changed since the last real sending (a recovery corrected by hand)
 * goes again, which the server allows because the description it replaces carries the Foulée signature.
 */
object StravaTexts {
    private const val CHUNK = 5
    private const val TIMEOUT_MS = 180_000

    /** "Forme du jour" of the day of the session: the night before for a morning run, the day itself for an afternoon one. */
    fun readinessOf(a: ActivityRow, analysis: Analysis): Int? {
        val hour = a.startLocal.drop(11).take(2).toIntOrNull() ?: 0
        val date = a.startLocal.take(10)
        return analysis.readinessOn(date, if (hour >= 14) date else LocalDate.parse(date).minusDays(1).toString())?.score
    }

    /** The text of one session, with the two form figures of its day. Null when it is neither an interval session (laps) nor a footing or long run. */
    fun textOf(a: ActivityRow, analysis: Analysis, laps: List<Lap>?, history: SessionHistory?, activities: List<ActivityRow>): StravaText? {
        // A race (chosen by hand or labelled on Strava) gets no text at all: no review of the week, no form figure
        if (WeekReviews.isRace(a)) return null
        val date = LocalDate.parse(a.startLocal.take(10))
        // On a Sunday run, the review of the week goes at the end of the description
        // (only the last run of the day carries it, and a day with a race gets neither the review nor the form figure)
        val week = if (WeekReviews.carriesReview(a, activities)) WeekReviews.of(date, activities, analysis, history) else null
        val recovery = if (WeekReviews.isRaceDay(a, activities)) null else RecoveryCheck.line(readinessOf(a, analysis))
        val iv = if (a.category == "interval") laps?.let { Intervals.analyze(it, a.recoveryModes) } else null
        if (iv != null) return StravaTextBuilder.build(iv, analysis.globalLoadOn(a), laps?.let { SessionRemark.of(history?.analyze(a.id, emptyList(), it)) }, a.speciality, week, recovery)
        if (!a.isRun || a.category !in setOf("easy", "long")) return null
        return StravaTextBuilder.buildEasy(a, analysis.globalLoadOn(a), week, recovery)
    }

    /** What is on Strava, as the app compares it: line endings and outer spaces ignored. */
    private fun hashOf(name: String, description: String) = (name.replace("\r\n", "\n").trim() + "\n" + description.replace("\r\n", "\n").trim()).hashCode().toString(16)

    /** Strava's own and Garmin's default titles: "Morning Run", "Paris Course à pied"… A title that is none of them was chosen by hand. */
    private val defaultTitle = Regex("^(morning|afternoon|evening|lunch|night) run$|^run$|course à pied", RegexOption.IGNORE_CASE)

    /**
     * True when the title or the description on Strava is no longer what the app wrote (or never was the app's: a description or a title he gave
     * himself): such an outing is never written over, so a change made on Strava before the sync is kept. The app notes what it wrote ("v" + id).
     */
    private fun editedOnStrava(a: ActivityRow, sent: Map<String, Pair<String, String>>): Boolean {
        val s = a.strava ?: return false
        val written = sent["v${a.id}"]?.first
        if (written != null) return hashOf(s.name, s.description) != written
        // Written before the app noted what it wrote: its signature at the end of the description shows the text is its own (even with its own title)
        if (s.description.trim().endsWith(StravaTextBuilder.SIGNATURE)) return false
        return s.description.isNotBlank() || !defaultTitle.containsMatchIn(s.name.trim())
    }

    /** A description Eloi wrote himself: it is kept, and the form figures of the day go after it (once). */
    private fun hasOwnDescription(a: ActivityRow): Boolean {
        val d = a.strava?.description?.trim() ?: return false
        return d.isNotBlank() && !d.endsWith(StravaTextBuilder.SIGNATURE)
    }

    /** His own description + the form figures at the end, written over (ecraser) with his text first. Null when there is no figure to add. */
    private fun appendItem(a: ActivityRow, an: Analysis, activities: List<ActivityRow>): TextItem? {
        val s = a.strava ?: return null
        if (WeekReviews.isRace(a) || WeekReviews.isRaceDay(a, activities)) return null
        val extra = listOfNotNull(RecoveryCheck.line(readinessOf(a, an)), StravaTextBuilder.figures(an.globalLoadOn(a)))
        if (extra.isEmpty()) return null
        val description = s.description.trim() + "\n\n" + extra.joinToString("\n")
        val json = JSONObject().put("stravaId", s.id).put("nom", s.name).put("description", description).put("ecraser", true).put("poserLabel", false)
        return TextItem(a, StravaText(s.name, description, interval = false), "f${a.id}", "ajout", json)
    }

    private fun itemOf(a: ActivityRow, text: StravaText): TextItem {
        val hash = (text.name + "\n" + text.description).hashCode().toString(16)
        val json = JSONObject().put("stravaId", a.strava!!.id).put("nom", text.name).put("description", text.description).put("ecraser", false)
        // The server puts the Workout label on a session it writes: only an interval session should get it
        if (!text.interval) json.put("poserLabel", false)
        return TextItem(a, text, "t${a.id}", hash, json)
    }

    /** Runs started after [since], already matched with their Strava outing, whose text was not really sent yet in this form. */
    private fun pending(db: Db, activities: List<ActivityRow>, analysis: () -> Analysis, since: String, easy: Boolean): List<TextItem> {
        val sent = db.stravaSent()
        val kinds = if (easy) setOf("interval", "easy", "long") else setOf("interval")
        val candidates = activities.filter { it.id > 0 && it.isRun && it.category in kinds && it.strava != null && it.startLocal > since }
        if (candidates.isEmpty()) return emptyList()
        val laps = db.lapsOf(candidates.map { it.id })
        val an = analysis()
        val history = SessionHistory(activities, db, an)
        val (mine, his) = candidates.partition { !editedOnStrava(it, sent) }
        his.forEach { db.addLog("I", "strava", "texte ${it.id} : titre ou description changés sur Strava, rien n'est écrit par-dessus") }
        val appended = his.filter { hasOwnDescription(it) && sent["f${it.id}"] == null }.mapNotNull { appendItem(it, an, activities) }
        return mine.mapNotNull { a -> textOf(a, an, laps[a.id], history, activities)?.let { itemOf(a, it) } }.filter { sent[it.key]?.first != it.hash } + appended
    }

    // In simulation nothing is remembered as sent: this keeps the same text from going again at every reload
    private val simulated = mutableSetOf<String>()
    private val pushing = java.util.concurrent.atomic.AtomicBoolean(false)

    /**
     * Sends the texts of the new sessions (sync, background check, or a reload after a correction). Returns what happened in one line,
     * or null when there was nothing to do. Throws when the server cannot be reached or refuses.
     */
    fun push(settings: Settings, db: Db): String? {
        if (settings.stravaUrl.isNullOrBlank() || settings.stravaKey == null || !pushing.compareAndSet(false, true)) return null
        try {
            val since = settings.textsSince ?: run {
                settings.textsSince = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                return null
            }
            val items = pending(db, db.activities(), { Insights.analyze(db) }, since, settings.easyTexts).filter { "${it.key}:${it.hash}" !in simulated }
            if (items.isEmpty()) return null
            val outcome = send(settings, db, items)
            if (outcome.simulation) items.forEach { simulated += "${it.key}:${it.hash}" }
            return "Textes des nouvelles séances : " + summary(outcome) + verifySummary(verify(settings, db, outcome))
        } finally {
            pushing.set(false)
        }
    }

    /** The text of one session, to send by hand whatever its date. */
    fun single(db: Db, snap: Snapshot, a: ActivityRow): TextItem? {
        if (a.strava == null) return null
        return textOf(a, snap.analysis, db.lapsOf(listOf(a.id))[a.id], snap.history, snap.activities)?.let { itemOf(a, it) }
    }

    /**
     * Reads the server back after a sending: for each text, whether the outing now carries exactly that title and description. The server may
     * take a moment to note its own write, so it is asked up to three times. A text the server answered "protege" is not checked (it kept his).
     */
    fun verify(settings: Settings, db: Db, outcome: Outcome): List<Pair<TextItem, Boolean>> {
        val written = outcome.items.filter { it.second in setOf("ecrit", "inchange") }.map { it.first }
        if (written.isEmpty() || outcome.simulation) return emptyList()
        val since = written.minOf { it.activity.startLocal }
        var left = written
        val ok = mutableListOf<TextItem>()
        for (attempt in 1..3) {
            val onServer = try { StravaSync.readBack(settings, since).associateBy { it.id } } catch (e: Exception) { db.addLog("W", "strava", "relecture impossible : ${e.message}"); break }
            val (good, rest) = left.partition { onServer[it.activity.strava?.id]?.let { s -> same(s.name, it.text.name) && same(s.description, it.text.description) } == true }
            ok += good
            left = rest
            if (left.isEmpty()) break
            Thread.sleep(4000)
        }
        written.forEach { db.addLog(if (it in ok) "I" else "W", "strava", "relecture de ${it.activity.id} : ${if (it in ok) "identique à ce qui a été envoyé" else "pas retrouvé tel quel sur le serveur"}") }
        return written.map { it to (it in ok) }
    }

    /** The server always answers with \n: ours are normalised the same way before comparing. */
    private fun same(a: String, b: String) = a.replace("\r\n", "\n").trim() == b.replace("\r\n", "\n").trim()

    fun verifySummary(checks: List<Pair<TextItem, Boolean>>) = when {
        checks.isEmpty() -> ""
        checks.all { it.second } -> " Relu sur le serveur : identique."
        else -> " Relu sur le serveur : ${checks.count { !it.second }} pas encore à jour (le serveur met parfois une minute)."
    }

    class Outcome(val simulation: Boolean, val counts: Map<String, Int>, val items: List<Pair<TextItem, String>>)

    fun send(settings: Settings, db: Db, items: List<TextItem>): Outcome {
        val base = StravaSync.normalize(settings.stravaUrl) ?: throw StravaError("Pas d'adresse de serveur Strava.")
        val key = settings.stravaKey ?: throw StravaError("Pas de clé pour le serveur Strava.")
        var simulation = false
        val statuses = mutableListOf<Pair<TextItem, String>>()
        for (chunk in items.chunked(CHUNK)) {
            val body = JSONObject().put("activites", JSONArray(chunk.map { it.json })).toString()
            val json = StravaSync.post(base, key, "/api/seances", body, TIMEOUT_MS)
            if (!json.has("simulation") || json.optBoolean("simulation", true)) simulation = true
            val answers = json.optJSONArray("resultats") ?: throw StravaError("Réponse inattendue du serveur Strava.")
            if (answers.length() != chunk.size) throw StravaError("Le serveur a répondu pour ${answers.length()} sorties sur ${chunk.size}.")
            val done = chunk.mapIndexed { i, item -> item to answers.getJSONObject(i).optString("statut") }
            done.forEach { (item, status) -> db.addLog(if (status in setOf("ecrit", "planifie", "inchange")) "I" else "W", "strava", "texte ${item.activity.id} (${item.text.name}) : $status${if (json.optBoolean("simulation", true)) " [simulation]" else ""}") }
            statuses += done
            // Written, already identical, or protected (a text Eloi wrote himself): not asked again. The rest is retried later.
            db.markStravaSent(done.filter { !simulation && it.second in setOf("ecrit", "inchange", "protege") }.map { (item, _) -> Triple(item.key, item.hash, "texte") })
            // What the app wrote, to tell later whether he changed it on Strava
            db.markStravaSent(done.filter { !simulation && it.second in setOf("ecrit", "inchange") && !it.first.key.startsWith("f") }.map { (item, _) -> Triple("v${item.activity.id}", hashOf(item.text.name, item.text.description), "vu") })
        }
        return Outcome(simulation, statuses.groupingBy { it.second }.eachCount(), statuses)
    }

    private fun label(status: String) = when (status) {
        "ecrit" -> "écrit"
        "planifie" -> "prévu"
        "inchange" -> "déjà à jour"
        "protege" -> "description à toi gardée"
        "introuvable" -> "introuvable sur Strava"
        "ambigu" -> "plusieurs sorties possibles"
        "invalide" -> "refusé par le serveur"
        else -> status
    }

    fun summary(o: Outcome) = (if (o.simulation) "Simulation, rien n'a été écrit dans Strava : " else "") +
        o.counts.entries.joinToString(", ") { "${it.value} ${label(it.key)}" }
}
