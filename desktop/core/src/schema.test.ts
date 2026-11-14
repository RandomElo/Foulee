import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./index";

describe("noyau", () => {
  it("expose une version de schéma entière positive", () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
