// Générateur de prompt : un petit questionnaire, puis un texte avec les données anonymisées à coller dans un chat (chatgpt.com, claude.ai…).
// Règle d'anonymisation commune avec le serveur MCP : jamais de trace GPS ni de coordonnées, de nom, d'e-mail, d'identifiant ni de jeton ; les dates peuvent devenir « J-n » ;
// les textes libres (noms de séances, commentaires) sont gardés si l'utilisateur le veut, avec les adresses, e-mails, numéros de téléphone et liens masqués.
import { addDays, daysBetween } from "./dates";
import { categoryLabel, categoryOf } from "./categories";
import { dec, roundToInt } from "./format";
import type { Analysis } from "./insights";
import { isRun, type ActivityRow, type DailyRow } from "./model";
import { withoutRecoveries } from "./coaching";

// ---------- Masquage des textes libres (même règle que mcp.rs) ----------

/** Masque les numéros de téléphone écrits par groupes : une suite de chiffres, espaces, points et tirets qui commence par 0 ou + et compte 9 à 15 chiffres. */
function masquerTelephones(texte: string): string {
  const c = [...texte];
  const chiffre = (x: string) => x >= "0" && x <= "9";
  let sortie = "";
  let i = 0;
  while (i < c.length) {
    if (c[i] === "+" || c[i] === "0") {
      let j = i;
      while (j < c.length && (chiffre(c[j] as string) || " .-+".includes(c[j] as string))) j++;
      while (j > i && !chiffre(c[j - 1] as string)) j--;
      const chiffres = c.slice(i, j).filter(chiffre).length;
      const collé = i > 0 && /[\p{L}\p{N}]/u.test(c[i - 1] as string);
      if (!collé && chiffres >= 9 && chiffres <= 15) { sortie += "[téléphone]"; i = j; continue; }
    }
    sortie += c[i];
    i++;
  }
  return sortie;
}

/** Masque ce qui ressemble à un e-mail, un numéro de téléphone ou un lien dans un texte libre. */
export function masquer(texte: string): string {
  const mots = (texte.match(/\S+\s*|\s+/g) ?? []).map((m) => {
    const mot = m.trimEnd();
    const reste = m.slice(mot.length);
    const nu = mot.replace(/^[^\p{L}\p{N}@+]+|[^\p{L}\p{N}@+]+$/gu, "");
    if (nu.includes("@") && nu.includes(".")) return `[e-mail]${reste}`;
    if (nu.startsWith("http://") || nu.startsWith("https://") || nu.startsWith("www.")) return `[lien]${reste}`;
    return m;
  });
  return masquerTelephones(mots.join(""));
}

// ---------- Le questionnaire ----------

export type Modele = "bilan" | "preparation" | "croyances" | "libre";
export type Ton = "direct" | "technique";

export interface Questionnaire {
  modele: Modele;
  /** Nombre de jours de séances et de santé joints. */
  jours: number;
  ton: Ton;
  /** « Préparation » : la course visée ; « croyances » : la croyance à travailler (« je ne battrai jamais 17 min au 5 km ») ; « libre » : la question. */
  texte: string;
  /** « Préparation » et « croyances » : le temps visé, par exemple « 16:30 sur 5 km ». */
  objectif: string;
  /** Garder les noms et commentaires de séance (adresses, e-mails, téléphones et liens masqués). */
  textesLibres: boolean;
  /** Remplacer les dates par « J-n » (n jours avant aujourd'hui). */
  datesRelatives: boolean;
}

export const QUESTIONNAIRE_PAR_DEFAUT: Questionnaire = { modele: "bilan", jours: 28, ton: "direct", texte: "", objectif: "", textesLibres: true, datesRelatives: false };

export interface Ressenti { activityId: number; rpe: number | null; legs: number | null; pain: number | null; note: string }
export interface Prevu { date: string; titre: string; dureeS: number | null; distanceM: number | null }
export interface DonneesPrompt {
  seances: ActivityRow[];
  daily: DailyRow[];
  ressentis: Ressenti[];
  prevus: Prevu[];
  analysis: Analysis;
  today: string;
  references: { vma: number; rec5: number; rec10: number; recHalf: number };
}

const TONS: Record<Ton, string> = {
  direct: "Réponds de façon directe et concise, sans flatterie : dis ce que les chiffres montrent, y compris ce qui ne va pas.",
  technique: "Réponds de façon technique, avec les mécanismes physiologiques et les ordres de grandeur, comme à un coureur averti.",
};

const CONSIGNES: Record<Modele, (q: Questionnaire) => string> = {
  bilan: () => "Fais le bilan de mon entraînement sur la période : ce qui progresse, ce qui stagne, les risques (charge, récupération, blessure) et trois priorités pour les prochaines semaines.",
  preparation: (q) => `Je prépare ${q.texte.trim() || "une course"}${q.objectif.trim() ? ` avec pour objectif ${q.objectif.trim()}` : ""}. À partir de mes données, dis si l'objectif est réaliste, ce qui manque et propose les grandes lignes des prochaines semaines (volume, séances clés, affûtage).`,
  croyances: (q) => `J'ai une croyance limitante : « ${q.texte.trim() || "je n'y arriverai pas"} »${q.objectif.trim() ? `. Mon objectif : ${q.objectif.trim()}` : ""}. 1) Donne les preuves chiffrées tirées de MES données qui contredisent ou nuancent cette croyance (cite les séances et les valeurs). 2) Dis honnêtement ce que les données ne permettent pas de conclure. 3) Pose-moi cinq questions de recadrage qui m'aident à voir ce qui est dans mon contrôle.`,
  libre: (q) => q.texte.trim() || "Analyse mes données d'entraînement.",
};

// ---------- Le texte ----------

const allure = (v: number | null) => { if (!v || v <= 0) return "–"; const s = roundToInt(1000 / v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`; };
const duree = (s: number | null) => { if (s === null || s <= 0) return "–"; const m = roundToInt(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`; };
const temps = (s: number) => { const t = roundToInt(s); return t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

/** Le prompt complet, prêt à copier. Ne contient que des chiffres et, si demandé, des textes libres masqués. */
export function construirePrompt(q: Questionnaire, d: DonneesPrompt): string {
  const jour = (date: string) => { if (!q.datesRelatives) return date; const n = daysBetween(date, d.today); return n >= 0 ? `J-${n}` : `J+${-n}`; };
  const libre = (t: string) => (q.textesLibres ? masquer(t.trim()) : "");
  const depuis = addDays(d.today, -(q.jours - 1));
  const dansPeriode = (date: string) => date >= depuis && date <= d.today;
  const seances = d.seances.filter((a) => dansPeriode(a.startLocal.slice(0, 10))).sort((a, b) => (a.startLocal < b.startLocal ? -1 : 1));
  const ressenti = new Map(d.ressentis.map((r) => [r.activityId, r]));
  const L: string[] = [];

  L.push("Tu es un entraîneur de course à pied expérimenté. " + TONS[q.ton]);
  L.push("");
  L.push(`Ma demande : ${CONSIGNES[q.modele](q)}`);
  L.push("");
  L.push("Règles : base-toi uniquement sur les données ci-dessous, n'invente aucune valeur, signale quand une donnée manque. Les données sont anonymisées : pas de nom, de lieu précis ni de trace GPS.");
  L.push("");

  const r = d.references;
  const refs = [r.vma > 0 ? `VMA ${dec(r.vma)} km/h` : null, r.rec5 > 0 ? `5 km en ${temps(r.rec5)}` : null, r.rec10 > 0 ? `10 km en ${temps(r.rec10)}` : null, r.recHalf > 0 ? `semi en ${temps(r.recHalf)}` : null].filter((x): x is string => x !== null);
  L.push("## Mes références");
  L.push(refs.length > 0 ? refs.join(", ") : "Non renseignées.");
  L.push("");

  const courses = seances.filter(isRun);
  const km = courses.reduce((s, a) => s + (a.distance ?? 0), 0) / 1000;
  L.push(`## Séances des ${q.jours} derniers jours (${courses.length} sorties, ${dec(km, 0)} km)`);
  L.push("Date | type | titre | distance | durée | allure | FC moy | charge | ressenti");
  for (const a of seances) {
    const f = ressenti.get(a.id);
    const titre = a.intervalTitle !== null ? withoutRecoveries(a.intervalTitle) : libre(a.name);
    const charge = d.analysis.globalAfter(a)?.total;
    const res = f ? [f.rpe !== null ? `RPE ${f.rpe}/10` : null, f.legs !== null ? `jambes ${["", "lourdes", "normales", "légères"][f.legs] ?? f.legs}` : null, f.pain ? `douleur ${["aucune", "légère", "gênante"][f.pain] ?? f.pain}` : null, libre(f.note) || null].filter((x): x is string => x !== null && x !== "").join(", ") : "";
    L.push([jour(a.startLocal.slice(0, 10)), categoryLabel(categoryOf(a)), titre || "–", a.distance ? `${dec(a.distance / 1000, 2)} km` : "–", duree(a.duration), allure(a.averageSpeed), a.averageHr ? `${roundToInt(a.averageHr)}` : "–", charge !== undefined ? `${dec(charge)}/20` : "–", res || "–"].join(" | "));
  }
  if (seances.length === 0) L.push("Aucune séance sur la période.");
  L.push("");

  const sante = d.daily.filter((x) => dansPeriode(x.date));
  const moy = (v: (number | null)[]) => { const k = v.filter((x): x is number => x !== null && x > 0); return k.length > 0 ? k.reduce((a, b) => a + b, 0) / k.length : null; };
  const sommeil = moy(sante.map((x) => x.sleepSeconds)), vfc = moy(sante.map((x) => x.hrvNight)), fcr = moy(sante.map((x) => x.restingHr));
  L.push("## Santé (moyennes sur la période)");
  L.push([sommeil !== null ? `sommeil ${duree(sommeil)} par nuit` : null, vfc !== null ? `VFC ${roundToInt(vfc)} ms` : null, fcr !== null ? `FC au repos ${roundToInt(fcr)} bpm` : null].filter((x): x is string => x !== null).join(", ") || "Pas de données de la montre.");
  const pointCharge = d.analysis.load[d.analysis.load.length - 1];
  const forme = d.analysis.readiness;
  L.push(`Aujourd'hui : ${forme ? `forme ${forme.score}/100 (${forme.label})` : "forme inconnue"}, ${pointCharge?.fatigue !== null && pointCharge?.fatigue !== undefined ? `fatigue d'entraînement ${dec(pointCharge.fatigue)}/10` : "fatigue inconnue"}.`);
  L.push("");

  const prevus = d.prevus.filter((p) => p.date >= d.today && p.date <= addDays(d.today, 14));
  if (prevus.length > 0) {
    L.push("## Prévu par mon coach (14 prochains jours)");
    for (const p of prevus) L.push(`${jour(p.date)} : ${libre(p.titre) || "séance"}${p.dureeS ? `, ${duree(p.dureeS)}` : ""}${p.distanceM ? `, ${dec(p.distanceM / 1000, 1)} km` : ""}`);
    L.push("");
  }
  return L.join("\n").trimEnd() + "\n";
}
