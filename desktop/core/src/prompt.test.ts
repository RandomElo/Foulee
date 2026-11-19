import { describe, expect, it } from "vitest";
import { analyzeLoad, construirePrompt, masquer, QUESTIONNAIRE_PAR_DEFAUT, type ActivityRow, type DonneesPrompt, type DailyRow, type Questionnaire } from "./index";

describe("masquage des textes libres (même règle que le serveur MCP)", () => {
  it("cache e-mails, téléphones et liens, garde les chiffres d'entraînement", () => {
    expect(masquer("Footing avec jean@example.com au 06 12 34 56 78")).toBe("Footing avec [e-mail] au [téléphone]");
    expect(masquer("tel +33 6 12 34 56 78, merci")).toBe("tel [téléphone], merci");
    expect(masquer("0612345678")).toBe("[téléphone]");
    expect(masquer("1000 800 600 400 200 puis 3'55")).toBe("1000 800 600 400 200 puis 3'55");
    expect(masquer("6x400 + 2000, récup 1'30 puis 0 à 10")).toBe("6x400 + 2000, récup 1'30 puis 0 à 10");
    expect(masquer("voir https://exemple.fr/x demain")).toBe("voir [lien] demain");
    expect(masquer("appelle +33612345678")).toBe("appelle [téléphone]");
    expect(masquer("Semi de Paris, 21,1 km")).toBe("Semi de Paris, 21,1 km");
    expect(masquer("")).toBe("");
  });
});

const AUJOURDHUI = "2026-11-14";
const run = (id: number, date: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id, startLocal: `${date} 08:00:00`, type: "running", distance: 10000, duration: 3300, averageSpeed: 3.03, averageHr: 148, maxHr: 170, trainingLoad: null, name: "Footing chez jean@example.com 06 12 34 56 78",
  elevation: null, intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null, ...extra,
});
const seances = [run(12345, "2026-11-10"), run(12346, "2026-11-12", { intervalTitle: "6 × 1000 m (r : 200 m)", manualCategory: "interval", name: "Séance" })];
const daily: DailyRow[] = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-0${i}`, restingHr: 50, avgStress: 30, bodyBatteryHigh: 80, sleepSeconds: 7.5 * 3600, sleepScore: 80, hrvNight: 62, steps: 9000 })).slice(1);
const donnees = (): DonneesPrompt => ({
  seances, daily, analysis: analyzeLoad(seances, daily, AUJOURDHUI), today: AUJOURDHUI, references: { vma: 19.2, rec5: 1008, rec10: 2222, recHalf: 5028 },
  ressentis: [{ activityId: 12345, rpe: 6, legs: 2, pain: 0, note: "Rappelle-moi au 0612345678" }],
  prevus: [{ date: "2026-11-16", titre: "Footing EF 45'", dureeS: 2700, distanceM: 9000 }],
});
const q = (extra: Partial<Questionnaire> = {}): Questionnaire => ({ ...QUESTIONNAIRE_PAR_DEFAUT, ...extra });

describe("générateur de prompt", () => {
  it("contient les références, les séances, la santé et le prévu", () => {
    const p = construirePrompt(q(), donnees());
    expect(p).toContain("VMA 19,2 km/h, 5 km en 16:48, 10 km en 37:02, semi en 1:23:48");
    expect(p).toContain("2026-11-10 | Footing |");
    expect(p).toContain("6 × 1000 m");
    expect(p).not.toContain("(r : 200 m)");
    expect(p).toContain("RPE 6/10, jambes normales");
    expect(p).toContain("sommeil 7h30 par nuit");
    expect(p).toContain("2026-11-16 : Footing EF 45'");
  });
  it("jamais d'identifiant, de coordonnées, d'e-mail ni de téléphone, même avec les textes libres", () => {
    const p = construirePrompt(q(), donnees());
    for (const interdit of ["12345", "12346", "jean@example.com", "06 12 34 56 78", "0612345678", "latitude", "longitude"]) expect(p).not.toContain(interdit);
    expect(p).toContain("[e-mail]");
    expect(p).toContain("[téléphone]");
  });
  it("sans les textes libres, ni titres ni notes ne partent", () => {
    const p = construirePrompt(q({ textesLibres: false }), donnees());
    expect(p).not.toContain("Footing chez");
    expect(p).not.toContain("Rappelle-moi");
    expect(p).not.toContain("[e-mail]");
  });
  it("dates relatives : J-n au lieu des dates", () => {
    const p = construirePrompt(q({ datesRelatives: true }), donnees());
    expect(p).toContain("J-4 | Footing");
    expect(p).toContain("J-2 | Fractionné");
    expect(p).toContain("J+2 : Footing EF 45'");
  });
  it("modèle « croyances » : la croyance, l'objectif et les questions de recadrage", () => {
    const p = construirePrompt(q({ modele: "croyances", texte: "je ne passerai jamais sous 17 min", objectif: "16:30 sur 5 km", ton: "bienveillant" }), donnees());
    expect(p).toContain("« je ne passerai jamais sous 17 min »");
    expect(p).toContain("Mon objectif : 16:30 sur 5 km");
    expect(p).toContain("cinq questions de recadrage");
    expect(p).toContain("bienveillance");
  });
  it("la période limite les séances", () => {
    const p = construirePrompt(q({ jours: 3 }), donnees());
    expect(p).not.toContain("2026-11-10 | Footing");
    expect(p).toContain("2026-11-12 | Fractionné");
  });
});
