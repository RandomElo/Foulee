import { invoke } from "@tauri-apps/api/core";

/** Valeurs acceptées en paramètre d'une requête (liées côté Rust, jamais concaténées au SQL). */
export type Param = string | number | boolean | null;

/** La base est chiffrée (SQLCipher) et ouverte côté Rust : le webview ne voit que ces commandes. */
export const select = <T extends Record<string, unknown>>(sql: string, params: Param[] = []) =>
  invoke<T[]>("db_select", { sql, params });

export const execute = (sql: string, params: Param[] = []) => invoke<number>("db_execute", { sql, params });

/** [version de SQLite, version de SQLCipher] */
export const infos = () => invoke<[string, string]>("db_infos");
