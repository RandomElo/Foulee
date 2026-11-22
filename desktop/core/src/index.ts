// Noyau de Foulée : fonctions pures, sans fichier, sans réseau, sans base.
// L'application Tauri et le serveur MCP lui passent les données.
export * from "./schema";
export * from "./format";
export * from "./intervals";
export * from "./dates";
export * from "./model";
export * from "./categories";
export * from "./sessions";
export * from "./splits";
export * from "./refs";
export * from "./health";
export * from "./sessionanalysis";
export * from "./coaching";
export * from "./profile";
export * from "./prompt";
export { hillsTitle, climbs as hillClimbs, bestRun as hillBestRun, type Climb } from "./hills";
export { reviewList, REVIEW_SCORE, type ReviewItem, type StravaDit } from "./review";
export * from "./stravatext";
export * from "./insights";
export * from "./globalload";
export * from "./loadcompare";
export * from "./weeks";
