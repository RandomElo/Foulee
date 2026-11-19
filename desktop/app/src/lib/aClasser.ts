import { reviewList, type ReviewItem } from "@foulee/core";
import type { Donnees } from "../repo";
import { stravaDe } from "./strava";

/** Les sorties à classer, avec ce que Strava dit de chacune : le même calcul pour la liste de la page et pour le compte annoncé dans Activités. */
export function sortiesAClasser(data: Pick<Donnees, "seances" | "strava">, hrMax: number): ReviewItem[] {
  return reviewList(data.seances, hrMax, (a) => {
    const s = stravaDe(data.strava, a as Donnees["seances"][number]);
    return s ? { name: s.nom, description: s.description, labels: s.labels } : null;
  });
}
