import { describe, expect, it } from "vitest";
import { assessMaintenance, latestActivityAt, type RepositoryStats } from "./repository-stats";

const now = new Date("2026-11-04T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function stats(overrides: Partial<RepositoryStats> = {}): RepositoryStats {
  return {
    fullName: "owner/repo",
    description: null,
    stars: 10,
    forks: 1,
    openIssues: 0,
    language: "TypeScript",
    license: "MIT",
    archived: false,
    defaultBranch: "main",
    lastCommitAt: daysAgo(10),
    pushedAt: daysAgo(10),
    commitsLast90Days: 3,
    commitsLast90DaysCapped: false,
    commitsLastYear: 10,
    homepageUrl: null,
    topics: [],
    fetchedAt: now.toISOString(),
    ...overrides,
  };
}

describe("assessMaintenance", () => {
  it("marks a repository with recent commits as active", () => {
    expect(assessMaintenance(stats({ lastCommitAt: daysAgo(30) }), now).status).toBe("active");
  });

  it("marks a repository between 90 and 365 days as maintained", () => {
    expect(assessMaintenance(stats({ lastCommitAt: daysAgo(91) }), now).status).toBe("maintained");
  });

  it("marks a repository between one and two years as low frequency", () => {
    expect(assessMaintenance(stats({ lastCommitAt: daysAgo(500) }), now).status).toBe("low");
  });

  it("marks a repository older than two years as dormant", () => {
    expect(assessMaintenance(stats({ lastCommitAt: daysAgo(800) }), now).status).toBe("dormant");
  });

  it("lets archived override all activity thresholds", () => {
    const assessment = assessMaintenance(stats({ archived: true, lastCommitAt: daysAgo(1) }), now);

    expect(assessment.status).toBe("archived");
    expect(assessment.daysSinceActivity).toBeNull();
  });

  it("falls back to pushedAt when a commit date is unavailable", () => {
    const assessment = assessMaintenance(stats({ lastCommitAt: null, pushedAt: daysAgo(20) }), now);

    expect(assessment.status).toBe("active");
    expect(assessment.daysSinceActivity).toBe(20);
  });

  it("returns unknown when there is no stats or activity date", () => {
    expect(assessMaintenance(undefined, now).status).toBe("unknown");
    expect(assessMaintenance(stats({ lastCommitAt: null, pushedAt: null }), now).status).toBe(
      "unknown",
    );
  });
});

describe("latestActivityAt", () => {
  it("prefers the latest commit over the push date", () => {
    expect(latestActivityAt(stats({ lastCommitAt: "2026-10-01T00:00:00.000Z" }))).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("returns null without stats", () => {
    expect(latestActivityAt(undefined)).toBeNull();
  });
});
