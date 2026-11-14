import Database from "@tauri-apps/plugin-sql";

let connexion: Promise<Database> | null = null;

/** Ouvre (une seule fois) la base locale ; les migrations sont jouées côté Rust. */
export function base(): Promise<Database> {
  connexion ??= Database.load("sqlite:foulee.db");
  return connexion;
}
