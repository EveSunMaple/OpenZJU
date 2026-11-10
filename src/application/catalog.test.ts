import { describe, expect, it } from "vitest";
import type { Project } from "@/domain/project/project";
import type { RepositoryAudit, RepositoryAuditSnapshot } from "@/domain/project/repository-audit";
import { gradeForScore } from "@/domain/project/repository-audit";
import type { RepositoryStatsSnapshot } from "@/domain/project/repository-stats";
import { buildCatalog, type ProjectView, sortProjectViews, summarizeProjects } from "./catalog";

const projects: Project[] = [
  {
    slug: "recent",
    name: "Recent",
    description: "最近仍在更新的项目，用来测试目录聚合。",
    repo: "owner/recent",
    category: "study",
    tags: ["课程"],
  },
  {
    slug: "archived",
    name: "Archived",
    description: "已经归档但仍可使用的项目，用来测试排序。",
    repo: "owner/archived",
    category: "work",
    tags: ["工具"],
  },
  {
    slug: "unknown",
    name: "Unknown",
    description: "没有获取到仓库信息的项目，用来测试未知状态。",
    repo: "owner/unknown",
    category: "life",
    tags: ["校园"],
  },
];

const now = new Date("2026-11-04T00:00:00.000Z");

const snapshot: RepositoryStatsSnapshot = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  source: "github-graphql",
  repositories: {
    "owner/recent": {
      fullName: "owner/recent",
      description: null,
      stars: 100,
      forks: 10,
      openIssues: 0,
      language: "TypeScript",
      license: "MIT",
      archived: false,
      defaultBranch: "main",
      lastCommitAt: "2026-10-01T00:00:00.000Z",
      pushedAt: "2026-10-01T00:00:00.000Z",
      commitsLast90Days: 12,
      commitsLast90DaysCapped: false,
      commitsLastYear: 40,
      homepageUrl: null,
      topics: ["zju"],
      fetchedAt: now.toISOString(),
    },
    "owner/archived": {
      fullName: "owner/archived",
      description: null,
      stars: 200,
      forks: 20,
      openIssues: 0,
      language: "Go",
      license: "Apache-2.0",
      archived: true,
      defaultBranch: "main",
      lastCommitAt: "2022-01-01T00:00:00.000Z",
      pushedAt: "2022-01-01T00:00:00.000Z",
      commitsLast90Days: 0,
      commitsLast90DaysCapped: false,
      commitsLastYear: 0,
      homepageUrl: null,
      topics: [],
      fetchedAt: now.toISOString(),
    },
  },
};

function makeAudit(score: number): RepositoryAudit {
  return {
    score,
    grade: gradeForScore(score),
    confidence: "high",
    dimensions: {
      maintenance: 80,
      documentation: 70,
      engineering: 75,
      security: 80,
      codeQuality: null,
    },
    codeQuality: null,
    aiRisk: { level: "low", score: 20, reasons: [] },
    checks: [],
    scorecard: null,
    fetchedAt: now.toISOString(),
  };
}

const auditSnapshot: RepositoryAuditSnapshot = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  source: "github",
  audits: {
    "owner/recent": makeAudit(68),
    "owner/unknown": makeAudit(85),
  },
};

describe("buildCatalog", () => {
  it("merges stats, computes counts and puts archived repositories last", () => {
    const catalog = buildCatalog(projects, snapshot, now);

    expect(catalog.counts.total).toBe(3);
    expect(catalog.counts.totalStars).toBe(300);
    expect(catalog.counts.byCategory.study).toBe(1);
    expect(catalog.counts.byStatus.active).toBe(1);
    expect(catalog.counts.byStatus.archived).toBe(1);
    expect(catalog.counts.byStatus.unknown).toBe(1);
    expect(catalog.counts.maintained).toBe(1);
    expect(catalog.projects.at(-1)?.slug).toBe("archived");
    expect(catalog.projects.find((project) => project.slug === "unknown")?.stats).toBeUndefined();
  });

  it("sorts by stars, quality and name", () => {
    const catalog = buildCatalog(projects, snapshot, now, auditSnapshot);
    const byStars = sortProjectViews(catalog.projects, "stars");
    const byQuality = sortProjectViews(catalog.projects, "quality");
    const byName = sortProjectViews(catalog.projects, "name");

    expect(byStars[0]?.slug).toBe("recent");
    expect(byStars.at(-1)?.slug).toBe("archived");
    expect(byQuality.map((project) => project.slug)).toEqual(["unknown", "recent", "archived"]);
    expect(byName.map((project) => project.name)).toEqual(["Recent", "Unknown", "Archived"]);
  });
});

describe("summarizeProjects", () => {
  it("summarizes a page slice", () => {
    const catalog = buildCatalog(projects, snapshot, now);
    const studyProjects = catalog.projects.filter(
      (project): project is ProjectView => project.category === "study",
    );
    const counts = summarizeProjects(studyProjects);

    expect(counts.total).toBe(1);
    expect(counts.maintained).toBe(1);
    expect(counts.byCategory.study).toBe(1);
  });
});
