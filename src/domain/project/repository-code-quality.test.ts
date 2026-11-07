import { describe, expect, it } from "vitest";
import { EMPTY_CODE_QUALITY_SNAPSHOT, parseCodeQualitySnapshot } from "./repository-code-quality";

const snapshot = {
  schemaVersion: 1,
  generatedAt: "2026-11-05T00:00:00.000Z",
  source: "deep-audit",
  repositories: {
    "owner/repo": {
      analyzedAt: "2026-11-05T00:00:00.000Z",
      commitAt: "2026-11-04T00:00:00.000Z",
      branch: "main",
      language: "Python",
      status: "complete",
      tools: ["lizard", "ruff"],
      toolVersions: { lizard: "1.17.10", ruff: "0.9.0" },
      metrics: {
        files: 4,
        loc: 200,
        functions: 12,
        averageComplexity: 4.5,
        maxComplexity: 12,
        highComplexityFunctions: 1,
        duplicationPercentage: 2.5,
        duplicatedBlocks: 1,
        lintErrors: 0,
        lintWarnings: 3,
        secrets: 0,
        vulnerabilities: null,
      },
    },
  },
};

describe("parseCodeQualitySnapshot", () => {
  it("parses a valid deep audit snapshot", () => {
    const parsed = parseCodeQualitySnapshot(snapshot);

    expect(parsed.source).toBe("deep-audit");
    expect(parsed.repositories["owner/repo"]?.metrics?.averageComplexity).toBe(4.5);
    expect(parsed.repositories["owner/repo"]?.tools).toEqual(["lizard", "ruff"]);
  });

  it("drops invalid repository entries", () => {
    const parsed = parseCodeQualitySnapshot({
      ...snapshot,
      repositories: {
        ...snapshot.repositories,
        broken: { status: "complete" },
      },
    });

    expect(Object.keys(parsed.repositories)).toEqual(["owner/repo"]);
  });

  it("returns an empty snapshot for invalid input", () => {
    expect(parseCodeQualitySnapshot(null)).toBe(EMPTY_CODE_QUALITY_SNAPSHOT);
    expect(parseCodeQualitySnapshot({ schemaVersion: 2 })).toBe(EMPTY_CODE_QUALITY_SNAPSHOT);
  });
});
