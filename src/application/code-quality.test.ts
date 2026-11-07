import { describe, expect, it } from "vitest";
import type { RepositoryCodeQuality } from "@/domain/project/repository-code-quality";
import { scoreCodeQuality } from "./code-quality";

function quality(overrides: Partial<RepositoryCodeQuality> = {}): RepositoryCodeQuality {
  return {
    analyzedAt: "2026-11-05T00:00:00.000Z",
    commitAt: "2026-11-04T00:00:00.000Z",
    branch: "main",
    language: "TypeScript",
    status: "complete",
    tools: ["lizard", "jscpd", "oxlint", "gitleaks", "osv-scanner"],
    toolVersions: { lizard: "1.17.10", jscpd: "4.0.0" },
    metrics: {
      files: 10,
      loc: 1000,
      functions: 100,
      averageComplexity: 2,
      maxComplexity: 6,
      highComplexityFunctions: 0,
      duplicationPercentage: 1,
      duplicatedBlocks: 0,
      lintErrors: 0,
      lintWarnings: 0,
      secrets: 0,
      vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 },
    },
    ...overrides,
  };
}

describe("scoreCodeQuality", () => {
  it("scores clean code at 100", () => {
    const result = scoreCodeQuality(quality());

    expect(result?.score).toBe(100);
    expect(result?.maintainability).toBe(100);
    expect(result?.reliability).toBe(100);
    expect(result?.confidence).toBe("high");
  });

  it("penalizes complexity, duplication, lint and security findings", () => {
    const result = scoreCodeQuality(
      quality({
        metrics: {
          files: 10,
          loc: 1000,
          functions: 100,
          averageComplexity: 20,
          maxComplexity: 60,
          highComplexityFunctions: 50,
          duplicationPercentage: 40,
          duplicatedBlocks: 20,
          lintErrors: 100,
          lintWarnings: 100,
          secrets: 1,
          vulnerabilities: { critical: 1, high: 2, medium: 3, low: 4 },
        },
      }),
    );

    expect(result?.score).toBeLessThan(25);
    expect(result?.maintainability).toBe(4);
    expect(result?.reliability).toBe(15);
    expect(result?.security).toBe(0);
  });

  it("renormalizes when only generic metrics are available", () => {
    const result = scoreCodeQuality(
      quality({
        metrics: {
          files: 10,
          loc: 1000,
          functions: 100,
          averageComplexity: 3,
          maxComplexity: 9,
          highComplexityFunctions: 1,
          duplicationPercentage: 2,
          duplicatedBlocks: 0,
          lintErrors: null,
          lintWarnings: null,
          secrets: null,
          vulnerabilities: null,
        },
      }),
    );

    expect(result?.score).toBeGreaterThan(90);
    expect(result?.reliability).toBeNull();
    expect(result?.security).toBeNull();
    expect(result?.confidence).toBe("medium");
  });

  it("returns null for skipped or missing metrics", () => {
    expect(scoreCodeQuality(quality({ status: "skipped", metrics: null }))).toBeNull();
    expect(scoreCodeQuality(undefined)).toBeNull();
  });
});
