import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@/domain/project/project";
import type { RepositoryStats } from "@/domain/project/repository-stats";
import { GitHubApiError } from "./github-client";
import { readSnapshot, writeSnapshot } from "./stats-store";
import { type StatsClient, syncRepositoryStats } from "./sync-repository-stats";

const directories: string[] = [];
const now = new Date("2026-11-04T00:00:00.000Z");

function project(repo: string): Project {
  return {
    slug: repo.replaceAll("/", "-").toLowerCase(),
    name: repo,
    description: "用于测试同步流程的项目数据。",
    repo,
    category: "study",
    tags: ["test"],
  };
}

function stats(repo: string, overrides: Partial<RepositoryStats> = {}): RepositoryStats {
  return {
    fullName: repo,
    description: null,
    stars: 10,
    forks: 1,
    openIssues: 0,
    language: "TypeScript",
    license: "MIT",
    archived: false,
    defaultBranch: "main",
    lastCommitAt: "2026-10-01T00:00:00.000Z",
    pushedAt: "2026-10-01T00:00:00.000Z",
    commitsLast90Days: 3,
    commitsLast90DaysCapped: false,
    commitsLastYear: 10,
    homepageUrl: null,
    topics: [],
    fetchedAt: now.toISOString(),
    ...overrides,
  };
}

async function cachePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zju-atlas-sync-"));
  directories.push(directory);

  return join(directory, "repository-stats.json");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function fakeClient(options: { methods: Partial<StatsClient>; hasToken?: boolean }): StatsClient {
  return {
    hasToken: options.hasToken ?? true,
    fetchGraphQLStats: async () => new Map(),
    fetchRestStats: async () => {
      throw new Error("not implemented");
    },
    ...options.methods,
  };
}

describe("syncRepositoryStats", () => {
  it("writes GraphQL results for all projects", async () => {
    const path = await cachePath();
    const projects = [project("owner/one"), project("owner/two")];
    const client = fakeClient({
      methods: {
        fetchGraphQLStats: async (repos) => {
          return new Map(repos.map((repo) => [repo.toLowerCase(), stats(repo)]));
        },
      },
    });

    const result = await syncRepositoryStats({
      projects,
      cachePath: path,
      client,
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.fetched).toBe(2);
    expect(result.summary.source).toBe("github-graphql");
    expect(result.snapshot.generatedAt).toBe(now.toISOString());
    expect(Object.keys(result.snapshot.repositories)).toHaveLength(2);

    const stored = await readSnapshot(path);

    expect(stored.repositories["owner/one"]?.stars).toBe(10);
  });

  it("falls back to cached stats when a repository fetch fails", async () => {
    const path = await cachePath();
    const cachedStats = stats("owner/one", { stars: 999 });
    await writeSnapshot(path, {
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      source: "github-rest",
      repositories: { "owner/one": cachedStats },
    });

    const client = fakeClient({
      methods: {
        fetchGraphQLStats: async () => {
          throw new Error("GraphQL unavailable");
        },
        fetchRestStats: async () => {
          throw new Error("REST unavailable");
        },
      },
    });

    const result = await syncRepositoryStats({
      projects: [project("owner/one")],
      cachePath: path,
      client,
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.cached).toBe(1);
    expect(result.summary.fetched).toBe(0);
    expect(result.summary.missing).toBe(0);
    expect(result.summary.fetchErrors).toBe(1);
    expect(result.summary.rateLimitErrors).toBe(0);
    expect(result.summary.source).toBe("cache");
    expect(result.snapshot.repositories["owner/one"]?.stars).toBe(999);
  });

  it("counts rate-limit failures separately from missing repositories", async () => {
    const path = await cachePath();
    await writeSnapshot(path, {
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      source: "github-rest",
      repositories: {
        "owner/one": stats("owner/one", { stars: 111 }),
      },
    });

    const client = fakeClient({
      hasToken: false,
      methods: {
        fetchRestStats: async () => {
          throw new GitHubApiError("API rate limit exceeded", 403, 0);
        },
      },
    });

    const result = await syncRepositoryStats({
      projects: [project("owner/one"), project("owner/two")],
      cachePath: path,
      client,
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.cached).toBe(1);
    expect(result.summary.missing).toBe(1);
    expect(result.summary.fetchErrors).toBe(2);
    expect(result.summary.rateLimitErrors).toBe(2);
    expect(result.summary.source).toBe("cache");
  });

  it("uses REST when GraphQL is unavailable", async () => {
    const path = await cachePath();
    const client = fakeClient({
      methods: {
        fetchGraphQLStats: async () => {
          throw new Error("GraphQL unavailable");
        },
        fetchRestStats: async (repo) => stats(repo, { stars: 42 }),
      },
    });

    const result = await syncRepositoryStats({
      projects: [project("owner/one")],
      cachePath: path,
      client,
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.source).toBe("github-rest");
    expect(result.snapshot.repositories["owner/one"]?.stars).toBe(42);
  });

  it("does not write network data in offline mode", async () => {
    const path = await cachePath();
    const client = fakeClient({
      methods: {
        fetchGraphQLStats: async () => {
          throw new Error("should not be called");
        },
      },
    });

    const result = await syncRepositoryStats({
      projects: [project("owner/one")],
      cachePath: path,
      offline: true,
      client,
      now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.summary.fetched).toBe(0);
    expect(result.summary.source).toBe("cache");
  });
});
