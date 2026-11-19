// Références du coureur et allures de course : portage de UserRefs.racePaces (UserRefs.kt).

/** Valeurs numériques des références ; 0 = inconnue. Les records sont en secondes. */
export interface RefsNum {
  vma: number;
  rec5: number;
  rec10: number;
  recHalf: number;
}

/** Allures de course en secondes par km. Le marathon se déduit du semi avec la formule de Riegel. */
export function racePaces(r: RefsNum): [string, number][] {
  const out: [string, number][] = [];
  if (r.rec5 > 0) out.push(["5 km", r.rec5 / 5]);
  if (r.rec10 > 0) out.push(["10 km", r.rec10 / 10]);
  if (r.recHalf > 0) {
    out.push(["semi", r.recHalf / 21.0975]);
    out.push(["marathon", (r.recHalf * 2 ** 1.06) / 42.195]);
  }
  return out;
}
