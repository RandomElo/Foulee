import { repo } from "../repo";
import { CLES_REFERENCES, REFERENCES_VIDES, type References } from "./references";

export async function lireReferences(): Promise<References> {
  const r = { ...REFERENCES_VIDES };
  for (const k of Object.keys(CLES_REFERENCES) as (keyof References)[]) r[k] = (await repo.getSetting(CLES_REFERENCES[k])) ?? "";
  return r;
}

/** Écrit chaque champ rempli ; un champ vidé est écrit vide (le retirer est un choix). */
export async function ecrireReferences(r: References): Promise<void> {
  for (const k of Object.keys(CLES_REFERENCES) as (keyof References)[]) await repo.setSetting(CLES_REFERENCES[k], r[k].trim());
}
