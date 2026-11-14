import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

// La base de test applique les VRAIES migrations de src-tauri/src/base.rs (lues dans le source Rust) : les requêtes de tauri.ts sont ainsi
// vérifiées contre le schéma réel. SQLite simple à la place de SQLCipher : le dialecte SQL est le même.
const rust = readFileSync(new URL("../../src-tauri/src/base.rs", import.meta.url), "utf8");
const bloc = rust.slice(rust.indexOf("const MIGRATIONS"), rust.indexOf("];", rust.indexOf("const MIGRATIONS")));
const MIGRATIONS = [...bloc.matchAll(/"((?:[^"\\]|\\.)*)"\s*,/g)].map((m) => m[1] as string);

let db: DatabaseSync;
type P = (string | number | null)[];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { sql?: string; params?: P; lot?: { sql: string; params: P }[] }) => {
    if (cmd === "db_select") return db.prepare(args.sql as string).all(...(args.params as P)).map((r) => ({ ...r }));
    if (cmd === "db_execute") return Number(db.prepare(args.sql as string).run(...(args.params as P)).changes);
    if (cmd === "db_batch") {
      db.exec("BEGIN");
      try {
        let n = 0;
        for (const o of args.lot ?? []) n += Number(db.prepare(o.sql).run(...o.params).changes);
        db.exec("COMMIT");
        return n;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    throw new Error(`commande inconnue : ${cmd}`);
  },
}));

const { tauriRepo } = await import("./tauri");

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);
});

describe("dépôt Tauri contre le schéma réel", () => {
  it("lit les migrations du source Rust", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(3);
    expect(MIGRATIONS[2]).toContain("rpe");
  });

  it("une base vide se charge sans erreur", async () => {
    const d = await tauriRepo.load();
    expect(d).toEqual({ seances: [], daily: [], feelings: [], nolio: [] });
  });

  it("le jeu de démonstration s'insère et se relit, titres de fractionné calculés", async () => {
    const n = await tauriRepo.loadDemo();
    expect(n).toBeGreaterThan(200);
    const d = await tauriRepo.load();
    expect(d.seances).toHaveLength(n);
    expect(d.seances.some((s) => s.intervalTitle !== null)).toBe(true);
    expect(d.seances.every((s, i, a) => i === 0 || (a[i - 1] as typeof s).startLocal <= s.startLocal)).toBe(true);
    expect(d.daily.length).toBeGreaterThan(100);
    expect(d.feelings.length).toBeGreaterThan(0);
    // idempotent : un second chargement n'ajoute rien
    await tauriRepo.loadDemo();
    expect((await tauriRepo.load()).seances).toHaveLength(n);
  });

  it("le ressenti s'enregistre, se modifie, et refuse un RPE hors 1 à 10", async () => {
    await tauriRepo.loadDemo();
    const id = (await tauriRepo.load()).seances[0]!.id;
    await tauriRepo.saveFeeling({ activityId: id, rpe: 7, legs: 3, pain: 1, note: "ok", answeredAt: "2026-11-14T10:00:00Z" });
    await tauriRepo.saveFeeling({ activityId: id, rpe: 4, legs: 2, pain: 0, note: "", answeredAt: "2026-11-14T11:00:00Z" });
    const f = (await tauriRepo.load()).feelings.filter((x) => x.activityId === id);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rpe: 4, legs: 2, pain: 0, note: "" });
    await expect(tauriRepo.saveFeeling({ activityId: id, rpe: 11, legs: 2, pain: 0, note: "", answeredAt: "x" })).rejects.toThrow();
  });

  it("corriger un rôle change le titre, le retirer le rétablit", async () => {
    await tauriRepo.loadDemo();
    const avant = (await tauriRepo.load()).seances.find((s) => s.intervalTitle !== null)!;
    await tauriRepo.setRole(avant.id, 0, "WORK");
    await tauriRepo.setRole(avant.id, 1, "WORK");
    const pendant = (await tauriRepo.load()).seances.find((s) => s.id === avant.id)!;
    expect(pendant.overrides[0]).toBe("WORK");
    expect(pendant.intervalTitle).not.toBe(avant.intervalTitle);
    await tauriRepo.clearRoles(avant.id);
    const apres = (await tauriRepo.load()).seances.find((s) => s.id === avant.id)!;
    expect(apres.overrides.every((o) => o === null)).toBe(true);
    expect(apres.intervalTitle).toBe(avant.intervalTitle);
  });

  it("le calendrier Nolio se relit tel que Rust l'écrit : booléens, valeurs absentes et ordre", async () => {
    const ins = db.prepare("INSERT INTO nolio_evenements (id, genre, competition, date, heure, titre, sport, duree_s, distance_m, deniv_m, allure_s_km, allure_plafond, rpe_prevu, ressenti, rpe_percu, commentaire, structure, lu_le) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    ins.run("tp-2", "prevu", 0, "2026-11-04", null, "Footing", "Running", 2952, 10000, null, 295, 1, 2, null, null, "Sensation de facilité", "[]", "2026-11-14");
    ins.run("cp-9", "prevu", 1, "2026-11-15", null, "Semi", "Running", null, null, null, null, 0, null, null, null, null, null, "2026-11-14");
    ins.run("t-1", "reel", 0, "2026-11-03", "07:29", "Footing", "Running", 3067, 9780, 108, 314, 0, null, 3, 5, null, null, "2026-11-14");
    const { nolio } = await tauriRepo.load();
    expect(nolio.map((n) => n.id)).toEqual(["t-1", "tp-2", "cp-9"]);
    expect(nolio[1]).toMatchObject({ genre: "prevu", competition: false, allurePlafond: true, dureeS: 2952, distanceM: 10000, denivM: null, rpePrevu: 2, commentaire: "Sensation de facilité", heure: null });
    expect(nolio[2]).toMatchObject({ competition: true, allurePlafond: false, dureeS: null, commentaire: null });
    expect(nolio[0]).toMatchObject({ genre: "reel", heure: "07:29", ressenti: 3, rpePercu: 5, denivM: 108 });
  });

  it("les réglages s'écrivent et se relisent", async () => {
    expect(await tauriRepo.getSetting("theme")).toBeNull();
    await tauriRepo.setSetting("theme", "a");
    await tauriRepo.setSetting("theme", "b");
    expect(await tauriRepo.getSetting("theme")).toBe("b");
  });
});
