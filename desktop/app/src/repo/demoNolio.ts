import type { NolioEvt } from "./types";

const jour = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

const evt = (e: Partial<NolioEvt> & Pick<NolioEvt, "id" | "date" | "titre">): NolioEvt => ({
  genre: "prevu", competition: false, heure: null, sport: "Running", dureeS: null, distanceM: null, denivM: null, allureSKm: null, allurePlafond: false,
  rpePrevu: null, ressenti: null, rpePercu: null, commentaire: null, ...e,
});

const MOT_EF = "Sensation de facilité, aisance respiratoire, possibilité de maintenir une conversation sans essoufflement. Tu dois avoir l'impression que tu pourrais tenir cette allure pendant longtemps.";

/**
 * Calendrier Nolio inventé pour développer l'interface dans un navigateur : trois séances et un objectif à venir, et une séance prévue
 * le jour de chacune des deux dernières séances de démonstration. Aucune donnée réelle.
 */
export function demoNolio(today: string, joursDeSeances: string[]): NolioEvt[] {
  const derniers = [...new Set(joursDeSeances)].sort().slice(-2);
  return [
    ...derniers.map((d, i) => evt({ id: `tp-demo-${i}`, date: d, titre: i === 0 ? "Footing 50'" : "6x400", dureeS: i === 0 ? 3000 : 3300, distanceM: i === 0 ? 10000 : 11000, allureSKm: i === 0 ? 295 : 250, allurePlafond: i === 0, rpePrevu: i === 0 ? 2 : 7, commentaire: i === 0 ? MOT_EF : "Récupération trot 1'. Garde de la fraîcheur sur les dernières." })),
    evt({ id: "tp-demo-a", date: jour(today, 1), titre: "Footing EF 45'", dureeS: 2700, distanceM: 9000, allureSKm: 295, allurePlafond: true, rpePrevu: 2, commentaire: MOT_EF }),
    evt({ id: "tp-demo-b", date: jour(today, 3), titre: "3x1 km AS21", dureeS: 3900, distanceM: 12000, allureSKm: 235, rpePrevu: 6, commentaire: "Allure semi, relâché. 2' de récupération." }),
    evt({ id: "tp-demo-c", date: jour(today, 5), titre: "Sortie longue 1h30", dureeS: 5400, distanceM: 18000, allureSKm: 300, rpePrevu: 4 }),
    evt({ id: "cp-demo", date: jour(today, 20), titre: "Semi de démonstration", competition: true, sport: "Running", dureeS: 5000, distanceM: 21097 }),
  ];
}
