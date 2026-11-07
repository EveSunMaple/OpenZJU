import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@/domain/project/project";
import type { RepositoryAudit } from "@/domain/project/repository-audit";
import type { CodeQualitySnapshot } from "@/domain/project/repository-code-quality";
import type { RepositoryStats } from "@/domain/project/repository-stats";
import { readAuditSnapshot, writeAuditSnapshot } from "./audit-store";
import {
  type AuditScorecardClient,
  type AuditSignalsClient,
  syncRepositoryAudits,
} from "./sync-repository-audits";

const directories: string[] = [];
const now = new Date("2026-11-05T00:00:00.000Z");

async function cachePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zju-atlas-audit-"));
  directories.push(directory);
  return join(directory, "repository-audits.json");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function project(repo: string): Project {
  return {
    slug: repo.replaceAll("/", "-").toLowerCase(),
    name: repo,
    description: "用于测试审计同步的项目数据。",
    repo,
    category: "study",
    tags: ["test"],
  };
}

function stats(repo: string): RepositoryStats {
  return {
    fullName: repo,
    description: "A test repository",
    stars: 120,
    forks: 12,
    openIssues: 0,
    language: "TypeScript",
    license: "MIT",
    archived: false,
    defaultBranch: "main",
    lastCommitAt: "2026-10-30T00:00:00.000Z",
    pushedAt: "2026-10-30T00:00:00.000Z",
    commitsLast90Days: 8,
    commitsLast90DaysCapped: false,
    commitsLastYear: 30,
    homepageUrl: null,
    topics: [],
    fetchedAt: now.toISOString(),
  };
}

function fakeClient(overrides: Partial<AuditSignalsClient> = {}): AuditSignalsClient {
  return {
    hasToken: true,
    fetchCommunityProfile: async () => ({
      healthPercentage: 70,
      readme: true,
      license: true,
      contributing: true,
      codeOfConduct: true,
      issueTemplate: true,
      pullRequestTemplate: true,
    }),
    fetchRootEntries: async () => [
      "README.md",
      "package.json",
      "pnpm-lock.yaml",
      "biome.json",
      "tests",
      ".github",
      "docs",
    ],
    fetchDirectoryEntries: async () => ["workflows", "SECURITY.md"],
    ...overrides,
  };
}

function fakeScorecard(score = 8): AuditScorecardClient {
  return {
    fetch: async () => ({ score, date: "2026-11-01" }),
  };
}

describe("syncRepositoryAudits", () => {
  it("writes audits from GitHub and Scorecard signals", async () => {
    const path = await cachePath();
    const snapshot = {
      schemaVersion: 1 as const,
      generatedAt: now.toISOString(),
      source: "github-rest" as const,
      repositories: { "owner/repo": stats("owner/repo") },
    };

    const codeQualitySnapshot: CodeQualitySnapshot = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      source: "deep-audit",
      repositories: {
        "owner/repo": {
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
        },
      },
    };

    const result = await syncRepositoryAudits({
      projects: [project("owner/repo")],
      statsSnapshot: snapshot,
      codeQualitySnapshot,
      cachePath: path,
      client: fakeClient(),
      scorecardClient: fakeScorecard(),
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.fetched).toBe(1);
    expect(result.snapshot.audits["owner/repo"]?.codeQuality?.score).toBe(100);
    expect(result.summary.source).toBe("github+scorecard");
    expect(result.snapshot.audits["owner/repo"]?.score).toBeGreaterThan(70);
    expect(result.snapshot.audits["owner/repo"]?.scorecard?.score).toBe(8);

    const stored = await readAuditSnapshot(path);

    expect(stored.audits["owner/repo"]?.grade).toBeDefined();
  });

  it("detects build manifests nested in common source directories", async () => {
    const path = await cachePath();

    const result = await syncRepositoryAudits({
      projects: [project("owner/repo")],
      statsSnapshot: {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        source: "github-rest",
        repositories: { "owner/repo": stats("owner/repo") },
      },
      cachePath: path,
      client: fakeClient({
        fetchRootEntries: async () => ["README.md", "src"],
        fetchDirectoryEntries: async (_repo, directory) =>
          directory === "src" ? ["CMakeLists.txt", "planner"] : ["workflows"],
      }),
      scorecardClient: fakeScorecard(),
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(
      result.snapshot.audits["owner/repo"]?.checks.find((check) => check.id === "manifest")?.status,
    ).toBe("pass");
  });

  it("keeps the previous audit when GitHub signal fetching fails", async () => {
    const path = await cachePath();
    const previousAudit = {
      score: 77,
      grade: "B",
      confidence: "medium",
      dimensions: {
        maintenance: 80,
        documentation: 70,
        engineering: 80,
        security: 70,
        codeQuality: null,
      },
      codeQuality: null,
      aiRisk: { level: "low", score: 10, reasons: [] },
      checks: [],
      scorecard: null,
      fetchedAt: "2026-10-01T00:00:00.000Z",
    } satisfies RepositoryAudit;
    await writeAuditSnapshot(path, {
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      source: "github",
      audits: { "owner/repo": previousAudit },
    });

    const result = await syncRepositoryAudits({
      projects: [project("owner/repo")],
      statsSnapshot: {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        source: "github-rest",
        repositories: { "owner/repo": stats("owner/repo") },
      },
      cachePath: path,
      client: fakeClient({
        fetchCommunityProfile: async () => {
          throw new Error("unavailable");
        },
        fetchRootEntries: async () => {
          throw new Error("unavailable");
        },
      }),
      scorecardClient: fakeScorecard(),
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.cached).toBe(1);
    expect(result.summary.fetchErrors).toBe(2);
    expect(result.snapshot.audits["owner/repo"]?.score).toBe(77);
  });

  it("uses cache without network when offline", async () => {
    const path = await cachePath();
    const previousAudit = {
      score: 70,
      grade: "C",
      confidence: "low",
      dimensions: {
        maintenance: 80,
        documentation: 60,
        engineering: 60,
        security: 50,
        codeQuality: null,
      },
      codeQuality: null,
      aiRisk: { level: "medium", score: 40, reasons: [] },
      checks: [],
      scorecard: null,
      fetchedAt: "2026-10-01T00:00:00.000Z",
    } satisfies RepositoryAudit;
    await writeAuditSnapshot(path, {
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      source: "github",
      audits: { "owner/repo": previousAudit },
    });

    const result = await syncRepositoryAudits({
      projects: [project("owner/repo")],
      statsSnapshot: {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        source: "github-rest",
        repositories: { "owner/repo": stats("owner/repo") },
      },
      cachePath: path,
      offline: true,
      client: fakeClient(),
      scorecardClient: fakeScorecard(),
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.fetched).toBe(0);
    expect(result.summary.cached).toBe(1);
    expect(result.summary.source).toBe("cache");
    expect(result.snapshot.audits["owner/repo"]?.score).toBe(70);
  });
});
