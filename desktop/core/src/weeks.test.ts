import { describe, expect, it } from "vitest";
import { groupWeeks, kmPerWeek, weekStart, type ActivityRow } from "./index";

const a = (id: number, day: string, km: number, type = "running"): ActivityRow => ({
  id, startLocal: `${day} 08:00:00`, type, distance: km * 1000, duration: km * 300, averageSpeed: 3.3, averageHr: 150, maxHr: 170, trainingLoad: null, name: "", elevation: null,
  intervalTitle: null, manualCategory: null, trimp: null, stravaLabels: null,
});

describe("semaines", () => {
  it("le lundi d'une date, dimanche compris", () => {
    expect(weekStart("2026-11-14")).toBe("2026-11-09"); // samedi
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // dimanche
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // lundi
    expect(weekStart("2026-03-01")).toBe("2026-02-23"); // passage de mois
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // passage d'année
  });

  it("regroupe par semaine, récentes d'abord, sans compter le vélo dans les km", () => {
    const w = groupWeeks([a(1, "2026-11-02", 10), a(2, "2026-11-08", 20), a(3, "2026-11-09", 8), a(4, "2026-11-10", 30, "cycling")]);
    expect(w.map((x) => [x.start, x.km, x.sessions.length])).toEqual([["2026-11-09", 8, 2], ["2026-11-02", 30, 2]]);
    expect(w[1]?.sessions[0]?.id).toBe(2);
  });

  it("kilomètres des huit dernières semaines, trous à zéro, semaine en cours marquée", () => {
    const k = kmPerWeek([a(1, "2026-11-10", 12), a(2, "2026-10-20", 5)], "2026-11-14", 8);
    expect(k).toHaveLength(8);
    expect(k[7]).toEqual({ start: "2026-11-09", km: 12, current: true });
    expect(k[0]?.start).toBe("2026-09-21");
    expect(k.find((x) => x.start === "2026-10-19")?.km).toBe(5);
    expect(k.filter((x) => x.km === 0)).toHaveLength(6);
  });
});
