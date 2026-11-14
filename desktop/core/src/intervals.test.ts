import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, layout, type IntervalAnalysis, type Lap } from "./intervals";

/** Ce que le Kotlin (banc de détection) a conclu d'une séance : voir ~/demo-claude/foulee/detection (export-synth, export-reels). */
interface Reference {
  title: string;
  structured: boolean;
  efforts: string;
  block: boolean;
  entries: [string, string][];
  groups: { label: string; timeBased: boolean; reps: number; recovery: string | null; measured: boolean | null }[];
  roles: string[];
  kinds: { label: string; measured: boolean; n: number }[];
  sequence: number[];
}
interface Cas {
  name?: string;
  mode?: string;
  seed?: number;
  id?: string;
  date?: string;
  laps: Lap[];
  kotlin: Reference | null;
}

/** Réduit une analyse TS à la même forme que l'export Kotlin. */
function resume(a: IntervalAnalysis): Reference {
  const l = layout(a);
  return {
    title: a.title,
    structured: a.structured,
    efforts: l.efforts,
    block: l.block,
    entries: l.entries,
    groups: a.groups.map((g) => ({ label: g.label, timeBased: g.timeBased, reps: g.reps.length, recovery: g.recovery?.label ?? null, measured: g.recovery?.measured ?? null })),
    roles: a.laps.map((x) => x.role),
    kinds: a.recoveryKinds.map((k) => ({ label: k.label, measured: k.measured, n: k.laps.length })),
    sequence: a.sequence,
  };
}

function rejouer(cas: Cas[]): string[] {
  const ecarts: string[] = [];
  for (const c of cas) {
    const a = analyze(c.laps);
    const obtenu = a ? resume(a) : null;
    if (JSON.stringify(obtenu) !== JSON.stringify(c.kotlin)) ecarts.push(`${c.name ?? c.id} [${c.mode ?? c.date}/${c.seed ?? ""}]\n  TS     : ${obtenu?.title}\n  Kotlin : ${c.kotlin?.title}`);
  }
  return ecarts;
}

describe("détection du fractionné : parité avec le Kotlin", () => {
  it("rejoue les 297 séances synthétiques à l'identique (titres, rôles, groupes, récups)", () => {
    const cas = JSON.parse(readFileSync(new URL("../fixtures/synth.json", import.meta.url), "utf8")) as Cas[];
    expect(cas.length).toBe(297);
    expect(rejouer(cas)).toEqual([]);
  });

  const reels = new URL("../fixtures-locales/reels.json", import.meta.url);
  // Séances réelles d'Eloi : données personnelles, jamais versionnées. Régénérées par le banc Kotlin (export-reels).
  it.skipIf(!existsSync(reels))("rejoue les séances réelles à l'identique", () => {
    const cas = JSON.parse(readFileSync(reels, "utf8")) as Cas[];
    expect(cas.length).toBeGreaterThan(100);
    expect(rejouer(cas)).toEqual([]);
  });
});
