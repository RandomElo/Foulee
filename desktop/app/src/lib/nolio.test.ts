import { describe, expect, it } from "vitest";
import type { NolioEvt, Seance } from "../repo/types";
import { aVenir, dansJours, joursEntre, positionSousLimite, prevuDe, prochainObjectif } from "./nolio";

const e = (o: Partial<NolioEvt> & { id: string; date: string }): NolioEvt => ({
  genre: "prevu", competition: false, heure: null, titre: o.id, sport: "Running", dureeS: null, distanceM: null, denivM: null, allureSKm: null, allurePlafond: false,
  rpePrevu: null, ressenti: null, rpePercu: null, commentaire: null, ...o,
});

describe("calendrier Nolio", () => {
  it("compte les jours à travers les fins de mois et d'année", () => {
    expect(joursEntre("2026-11-14", "2026-11-15")).toBe(1);
    expect(joursEntre("2026-12-30", "2027-01-02")).toBe(3);
    expect(joursEntre("2027-02-27", "2027-03-01")).toBe(2);
    expect(joursEntre("2026-11-14", "2026-11-14")).toBe(0);
    expect(joursEntre("2026-11-14", "2026-11-10")).toBe(-4);
  });
  it("ne garde à venir que les séances prévues d'aujourd'hui en avant, dans l'ordre, sans les compétitions ni le réalisé", () => {
    const l = aVenir([
      e({ id: "b", date: "2026-11-16" }), e({ id: "passe", date: "2026-11-13" }), e({ id: "a", date: "2026-11-14" }),
      e({ id: "c", date: "2026-11-15", competition: true }), e({ id: "r", date: "2026-11-15", genre: "reel" }), e({ id: "n", date: "2026-11-15", genre: "note" }),
      e({ id: "d", date: "2026-11-17" }), e({ id: "z", date: "2026-11-20" }),
    ], "2026-11-14");
    expect(l.map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(aVenir([], "2026-11-14")).toEqual([]);
  });
  it("trouve la prochaine compétition et le nombre de jours", () => {
    const o = prochainObjectif([e({ id: "loin", date: "2027-04-11", competition: true }), e({ id: "proche", date: "2026-11-15", competition: true }), e({ id: "passee", date: "2026-10-18", competition: true })], "2026-11-14");
    expect(o?.evt.id).toBe("proche");
    expect(o?.jours).toBe(1);
    expect(prochainObjectif([], "2026-11-14")).toBeNull();
    expect(dansJours(0)).toBe("aujourd'hui");
    expect(dansJours(1)).toBe("demain");
    expect(dansJours(64)).toBe("dans 64 jours");
  });
  const seance = (startLocal: string, duration: number | null) => ({ startLocal, duration } as unknown as Seance);
  it("rapproche une séance réalisée de la séance prévue du même jour, la plus proche en durée", () => {
    const l = [e({ id: "echauf", date: "2026-11-03", dureeS: 900 }), e({ id: "footing", date: "2026-11-03", dureeS: 3000 }), e({ id: "autre-jour", date: "2026-11-04", dureeS: 3000 })];
    expect(prevuDe(l, seance("2026-11-03T07:29:00", 3067))?.id).toBe("footing");
    expect(prevuDe(l, seance("2026-11-03T07:29:00", null))?.id).toBe("echauf");
    expect(prevuDe(l, seance("2026-11-05T07:29:00", 3000))).toBeNull();
    expect(prevuDe([e({ id: "r", date: "2026-11-03", genre: "reel" })], seance("2026-11-03T07:29:00", 3000))).toBeNull();
  });
  it("compare à la limite seulement pour une allure plafond", () => {
    const plafond = e({ id: "p", date: "2026-11-03", allureSKm: 295, allurePlafond: true });
    expect(positionSousLimite(plafond, 1000 / 314)).toBe("sous");
    expect(positionSousLimite(plafond, 1000 / 280)).toBe("au-dessus");
    expect(positionSousLimite(plafond, 1000 / 295)).toBe("sous");
    expect(positionSousLimite({ ...plafond, allurePlafond: false }, 1000 / 314)).toBeNull();
    expect(positionSousLimite(plafond, null)).toBeNull();
    expect(positionSousLimite({ ...plafond, allureSKm: null }, 3)).toBeNull();
  });
});
