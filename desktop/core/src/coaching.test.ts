import { describe, expect, it } from "vitest";
import { analyzeLoad, isReviewDay, jourDeCourse, porteLeBilan, recoveryAlert, recoveryLine, weekLines, weekReviewForHome, weekReviewOf, withoutRecoveries, type ActivityRow, type DailyRow } from "./index";

const run = (id: number, startLocal: string, km: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id, startLocal, type: "running", distance: km * 1000, duration: km * 330, averageSpeed: 3.0, averageHr: 148, maxHr: 170, trainingLoad: null, name: "", elevation: null,
  intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null, ...extra,
});
const AUJOURDHUI = "2026-11-15"; // dimanche
const activites = [
  run(1, "2026-11-04 18:00:00", 10), // semaine d'avant
  run(2, "2026-11-10 18:00:00", 12),
  run(3, "2026-11-12 18:00:00", 8, { intervalTitle: "6 × 1000 m (r : 200 m)", manualCategory: "interval" }),
  run(4, "2026-11-15 09:00:00", 20),
];
const analyse = () => analyzeLoad(activites, [], AUJOURDHUI);

describe("bilan de la semaine", () => {
  it("garde les efforts, pas les récupérations, dans les titres", () => {
    expect(withoutRecoveries("6 × 1000 m (r : 200 m)")).toBe("6 × 1000 m");
    expect(withoutRecoveries("2 × 400 m (r : 1 min) + 1200 m (r : 2 min)")).toBe("2 × 400 m + 1200 m");
  });
  it("le dimanche, résume la semaine du lundi à ce jour", () => {
    const w = weekReviewOf(AUJOURDHUI, activites, analyse(), null);
    expect(w?.monday).toBe("2026-11-09");
    expect(w?.km).toBe(40);
    expect(w?.lastKm).toBe(10);
    expect(w?.runs).toBe(3);
    expect(w?.intervals).toHaveLength(1);
    const lignes = weekLines(w!);
    expect(lignes[0]).toBe("Bilan de la semaine : 40 km en 3 séances (10 km la semaine d'avant).");
    expect(lignes).toContain("Fractionné :");
    expect(lignes).toContain("Jeudi : 6 x 1000 m");
  });
  it("sans course dans la semaine : rien ; jour du bilan et accueil", () => {
    expect(weekReviewOf("2026-11-22", [], analyse(), null)).toBeNull();
    expect(isReviewDay("2026-11-15")).toBe(true);
    expect(isReviewDay("2026-11-14")).toBe(false);
    expect(weekReviewForHome("2026-11-14", activites, analyse(), null)).toBeNull();
    expect(weekReviewForHome("2026-11-16", activites, analyse(), null)?.monday).toBe("2026-11-09");
  });
});

describe("alerte de récupération", () => {
  it("la ligne Strava n'apparaît que sous la limite", () => {
    expect(recoveryLine(51)).toBe("Récupération faible ce matin (forme 51/100).");
    expect(recoveryLine(52)).toBeNull();
    expect(recoveryLine(null)).toBeNull();
  });
  it("sans mesure de la montre, pas d'alerte", () => {
    const daily: DailyRow[] = [];
    expect(recoveryAlert(analyzeLoad(activites, daily, AUJOURDHUI), activites, AUJOURDHUI)).toBeNull();
  });
});

describe("qui porte le bilan de la semaine", () => {
  const matin = run(21, "2026-11-22 08:00:00", 8);
  const soir = run(22, "2026-11-22 18:00:00", 10);
  const course = run(23, "2026-11-22 09:00:00", 21, { manualCategory: "competition" });
  it("le dimanche, seulement la dernière sortie du jour", () => {
    const jour = [matin, soir];
    expect(porteLeBilan(matin, jour)).toBe(false);
    expect(porteLeBilan(soir, jour)).toBe(true);
    expect(porteLeBilan(run(24, "2026-11-21 18:00:00", 10), [run(24, "2026-11-21 18:00:00", 10)])).toBe(false);
  });
  it("un jour de course : aucun bilan, ni forme (course seule ou avec un footing autour)", () => {
    expect(porteLeBilan(course, [course])).toBe(false);
    expect(porteLeBilan(soir, [course, soir])).toBe(false);
    expect(jourDeCourse(soir, [course, soir])).toBe(true);
    expect(jourDeCourse(soir, [matin, soir])).toBe(false);
  });
  it("une course reconnue autrement (label Strava) compte aussi", () => {
    const estCourse = (a: ActivityRow) => a.id === 22;
    expect(porteLeBilan(soir, [matin, soir], estCourse)).toBe(false);
    expect(jourDeCourse(matin, [matin, soir], estCourse)).toBe(true);
  });
});
