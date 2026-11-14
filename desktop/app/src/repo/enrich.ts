import { analyze, type Lap, type RoleOverrides } from "@foulee/core";
import type { Seance } from "./types";

type Base = Omit<Seance, "laps" | "overrides" | "intervalTitle">;

/** Ajoute les tours, les corrections de l'utilisateur et le titre de fractionné (calculé, jamais stocké). */
export function toSeance(base: Base, laps: Lap[], overrides?: RoleOverrides): Seance {
  const o = overrides ?? laps.map(() => null);
  const course = base.type.includes("running");
  const title = course && laps.length > 0 ? (analyze(laps, new Map(), o)?.title ?? null) : null;
  return { ...base, intervalTitle: title, laps, overrides: o };
}

export function applyOverride(current: RoleOverrides | undefined, laps: number, idx: number, role: import("@foulee/core").LapRole | null): RoleOverrides {
  const o = current ? [...current] : new Array(laps).fill(null);
  o[idx] = role;
  return o;
}
