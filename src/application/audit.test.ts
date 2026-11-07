import { describe, expect, it } from "vitest";
import type { RepositoryCodeQuality } from "@/domain/project/repository-code-quality";
import type { RepositoryStats } from "@/domain/project/repository-stats";
import { type AuditSignals, createRepositoryAudit } from "./audit";

const now = new Date("2026-11-05T00:00:00.000Z");

function stats(overrides: Partial<RepositoryStats> = {}): RepositoryStats {
  return {
    fullName: "owner/repo",
    description: "A test repository",
    stars: 100,
    forks: 10,
    openIssues: 0,
    language: "TypeScript",
    license: "MIT",
    archived: false,
    defaultBranch: "main",
    lastCommitAt: "2026-10-30T00:00:00.000Z",
    pushedAt: "2026-10-30T00:00:00.000Z",
    commitsLast90Days: 20,
    commitsLast90DaysCapped: false,
    commitsLastYear: 80,
    homepageUrl: null,
    topics: ["zju"],
    fetchedAt: now.toISOString(),
    ...overrides,
  };
}

function codeQuality(overrides: Partial<RepositoryCodeQuality> = {}): RepositoryCodeQuality {
  return {
    analyzedAt: now.toISOString(),
    commitAt: "2026-10-30T00:00:00.000Z",
    branch: "main",
    language: "TypeScript",
    status: "complete",
    tools: ["lizard", "jscpd", "oxlint", "gitleaks", "osv-scanner"],
    toolVersions: {},
    metrics: {
      files: 10,
      loc: 1000,
      functions: 100,
      averageComplexity: 3,
      maxComplexity: 8,
      highComplexityFunctions: 1,
      duplicationPercentage: 2,
      duplicatedBlocks: 0,
      lintErrors: 0,
      lintWarnings: 0,
      secrets: 0,
      vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 },
    },
    ...overrides,
  };
}

function signals(overrides: Partial<AuditSignals> = {}): AuditSignals {
  return {
    community: {
      healthPercentage: 80,
      readme: true,
      license: true,
      contributing: true,
      codeOfConduct: true,
      issueTemplate: true,
      pullRequestTemplate: true,
    },
    rootFiles: [
      "README.md",
      "package.json",
      "pnpm-lock.yaml",
      "biome.json",
      "tests",
      ".github",
      "docs",
      "Dockerfile",
      "examples",
    ],
    githubDirectory: ["workflows", "SECURITY.md", "dependabot.yml"],
    scorecard: { score: 8.5, date: "2026-11-01" },
    ...overrides,
  };
}

describe("createRepositoryAudit", () => {
  it("scores an engineered project highly and marks AI risk low", () => {
    const audit = createRepositoryAudit(stats(), signals(), now);

    expect(audit.score).toBeGreaterThanOrEqual(90);
    expect(audit.grade).toBe("A");
    expect(audit.confidence).toBe("high");
    expect(audit.aiRisk.level).toBe("low");
    expect(audit.checks.find((check) => check.id === "tests")?.status).toBe("pass");
    expect(audit.checks.find((check) => check.id === "scorecard")?.status).toBe("pass");
  });

  it("marks missing engineering signals and raises heuristic AI risk", () => {
    const audit = createRepositoryAudit(
      stats({ license: null }),
      {
        community: null,
        rootFiles: ["README.md"],
        githubDirectory: null,
        scorecard: null,
      },
      now,
    );

    expect(audit.score).toBeLessThan(50);
    expect(audit.confidence).toBe("low");
    expect(audit.aiRisk.level).not.toBe("low");
    expect(audit.checks.find((check) => check.id === "tests")?.status).toBe("fail");
  });

  it("marks AI risk as unknown when there is no audit data", () => {
    const audit = createRepositoryAudit(
      stats(),
      { community: null, rootFiles: null, githubDirectory: null, scorecard: null },
      now,
    );

    expect(audit.aiRisk.level).toBe("unknown");
    expect(audit.confidence).toBe("low");
  });

  it("softens AI risk for widely adopted repositories", () => {
    const audit = createRepositoryAudit(
      stats({ stars: 5000, forks: 500 }),
      {
        community: null,
        rootFiles: ["README.md"],
        githubDirectory: null,
        scorecard: null,
      },
      now,
    );

    expect(audit.aiRisk.level).not.toBe("high");
  });

  it("does not infer AI risk for archived repositories", () => {
    const audit = createRepositoryAudit(
      stats({ archived: true }),
      {
        community: null,
        rootFiles: ["README.md"],
        githubDirectory: null,
        scorecard: null,
      },
      now,
    );

    expect(audit.aiRisk.level).toBe("unknown");
  });

  it("uses deep code quality as the dominant score when available", () => {
    const audit = createRepositoryAudit(stats(), signals({ codeQuality: codeQuality() }), now);

    expect(audit.codeQuality?.score).toBeGreaterThan(90);
    expect(audit.dimensions.codeQuality).toBe(audit.codeQuality?.score);
    expect(audit.score).toBeGreaterThanOrEqual(90);
    expect(audit.checks.find((check) => check.id === "code-quality")?.status).toBe("pass");
  });

  it("falls back to engineering signals when deep analysis is missing", () => {
    const audit = createRepositoryAudit(stats(), signals(), now);

    expect(audit.codeQuality).toBeNull();
    expect(audit.dimensions.codeQuality).toBeNull();
    expect(audit.checks.find((check) => check.id === "code-quality")?.status).toBe("unknown");
  });

  it("degrades security to its fallback without a scorecard", () => {
    const audit = createRepositoryAudit(stats(), {
      ...signals(),
      githubDirectory: [],
      scorecard: null,
    });

    expect(audit.scorecard).toBeNull();
    expect(audit.dimensions.security).toBe(35);
    expect(audit.checks.find((check) => check.id === "scorecard")?.status).toBe("unknown");
  });
});
