import { describeLaps, dayOf, isRun, type LapInfo } from "@foulee/core";
import type { Seance } from "../repo";

export interface IntervalFacts { pace: number | null; hr: number | null; efforts: number }

/** Allure et FC moyennes des seuls efforts d'un fractionné (pas de l'échauffement ni des récups). */
export function intervalFacts(s: Seance): IntervalFacts | null {
  const { analysis } = describeLaps(s.laps, s.overrides);
  if (!analysis) return null;
  const work = analysis.laps.filter((l: LapInfo) => l.role === "WORK").map((l) => l.lap);
  const dist = work.reduce((a, l) => a + (l.distance ?? 0), 0);
  const dur = work.reduce((a, l) => a + (l.duration ?? 0), 0);
  const hrs = work.map((l) => l.averageHr).filter((h): h is number => h !== null);
  return { pace: dur > 0 ? dist / dur : null, hr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null, efforts: work.length };
}

/** Les doutes de la détection pour une séance (vide si la montre a donné les rôles, ou si l'utilisateur a corrigé). */
export function doubtsOf(s: Seance): string[] {
  return isRun(s) && s.laps.length > 0 ? describeLaps(s.laps, s.overrides).doubts : [];
}

export const lastInterval = (seances: Seance[]): Seance | undefined => [...seances].reverse().find((s) => s.intervalTitle !== null);

/** La séance la plus récente des 30 derniers jours avec un doute sur ses tours. */
export function firstDoubt(seances: Seance[], today: string): { seance: Seance; doubt: string } | null {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  for (const s of [...seances].reverse()) {
    if (dayOf(s) < since) break;
    const d = doubtsOf(s)[0];
    if (d) return { seance: s, doubt: d };
  }
  return null;
}
