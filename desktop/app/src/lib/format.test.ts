import { describe, expect, it } from "vitest";
import { fmtClock, fmtDayLong, fmtDayShort, fmtKm, fmtLong, fmtMeters, fmtPace, fmtTime, fmtWeekday1 } from "./format";

const NB = " ";

describe("formats français", () => {
  it("allure : minutes, secondes à deux chiffres, espaces insécables", () => {
    expect(fmtPace(1000 / 234)).toBe(`3${NB}min${NB}54${NB}/${NB}km`);
    expect(fmtPace(1000 / 245)).toBe(`4${NB}min${NB}05${NB}/${NB}km`);
    expect(fmtPace(null)).toBe("–");
    expect(fmtPace(0)).toBe("–");
  });
  it("distance : virgule décimale et unité collée par une espace insécable", () => {
    expect(fmtKm(10234)).toBe(`10,2${NB}km`);
    expect(fmtKm(null)).toBe("–");
    expect(fmtMeters(800)).toBe(`800${NB}m`);
    expect(fmtMeters(3500)).toBe(`3,5${NB}km`);
  });
  it("durées", () => {
    expect(fmtClock(2772)).toBe("46:12");
    expect(fmtClock(3725)).toBe("1:02:05");
    expect(fmtLong(370)).toBe(`6${NB}min${NB}10`);
    expect(fmtLong(45)).toBe(`45${NB}s`);
  });
  it("dates sans décalage de fuseau, sans point d'abréviation", () => {
    expect(fmtDayLong("2026-11-14")).toBe("samedi 14 novembre");
    expect(fmtDayShort("2026-11-13")).toBe("ven 13");
    expect(fmtWeekday1("2026-11-09")).toBe("L");
    expect(fmtTime("2026-11-13 18:05:00")).toBe(`18${NB}h${NB}05`);
    expect(fmtTime("2026-11-13 07:30:00")).toBe(`7${NB}h${NB}30`);
  });
});
