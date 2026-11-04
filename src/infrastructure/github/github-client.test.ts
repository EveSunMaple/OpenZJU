import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "./github-client";

const now = new Date("2026-11-04T00:00:00.000Z");

function jsonResponse(data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-ratelimit-remaining": "100",
      ...headers,
    },
  });
}

describe("GitHubClient", () => {
  it("parses GraphQL repository stats", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          repo0: {
            nameWithOwner: "owner/repo",
            description: "A test repository",
            stargazerCount: 123,
            forkCount: 4,
            isArchived: false,
            pushedAt: "2026-10-01T00:00:00Z",
            homepageUrl: "https://example.com",
            primaryLanguage: { name: "TypeScript" },
            licenseInfo: { spdxId: "MIT" },
            defaultBranchRef: {
              name: "main",
              target: {
                committedDate: "2026-10-01T00:00:00Z",
                commitsLast90Days: { totalCount: 7 },
                commitsLastYear: { totalCount: 30 },
              },
            },
            repositoryTopics: {
              nodes: [{ topic: { name: "zju" } }],
            },
            issues: { totalCount: 2 },
          },
        },
      }),
    );
    const client = new GitHubClient({
      token: "test-token",
      fetchImpl,
      now: () => now,
    });

    const result = await client.fetchGraphQLStats(["owner/repo"]);
    const stats = result.get("owner/repo");

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(stats?.fullName).toBe("owner/repo");
    expect(stats?.stars).toBe(123);
    expect(stats?.language).toBe("TypeScript");
    expect(stats?.license).toBe("MIT");
    expect(stats?.commitsLast90Days).toBe(7);
    expect(stats?.commitsLastYear).toBe(30);
    expect(stats?.topics).toEqual(["zju"]);
  });

  it("counts REST commits in the last 90 days", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/commits")) {
        return jsonResponse([
          { commit: { committer: { date: "2026-10-01T00:00:00Z" } } },
          { commit: { committer: { date: "2026-09-01T00:00:00Z" } } },
          { commit: { committer: { date: "2025-01-01T00:00:00Z" } } },
        ]);
      }

      return jsonResponse({
        full_name: "owner/repo",
        description: "A test repository",
        stargazers_count: 50,
        forks_count: 2,
        open_issues_count: 1,
        language: "Go",
        license: { spdx_id: "Apache-2.0" },
        archived: false,
        default_branch: "main",
        pushed_at: "2026-10-02T00:00:00Z",
        homepage: null,
        topics: ["zju"],
      });
    });
    const client = new GitHubClient({
      fetchImpl,
      now: () => now,
    });

    const stats = await client.fetchRestStats("owner/repo");

    expect(stats.lastCommitAt).toBe("2026-10-01T00:00:00Z");
    expect(stats.commitsLast90Days).toBe(2);
    expect(stats.stars).toBe(50);
  });

  it("falls back to the Atom feed when commit history is unavailable", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith(".atom")) {
        return new Response(
          `<feed><entry><updated>2026-10-01T00:00:00Z</updated></entry><entry><updated>2026-09-01T00:00:00Z</updated></entry></feed>`,
          { status: 200, headers: { "Content-Type": "application/atom+xml" } },
        );
      }

      return jsonResponse(
        {
          full_name: "owner/repo",
          description: null,
          stargazers_count: 1,
          forks_count: 0,
          open_issues_count: 0,
          language: "Go",
          license: null,
          archived: false,
          default_branch: "main",
          pushed_at: "2026-10-01T00:00:00Z",
          homepage: null,
          topics: [],
        },
        { "x-ratelimit-remaining": "0" },
      );
    });
    const client = new GitHubClient({
      fetchImpl,
      now: () => now,
    });

    const stats = await client.fetchRestStats("owner/repo");

    expect(stats.lastCommitAt).toBe("2026-10-01T00:00:00Z");
    expect(stats.commitsLast90Days).toBe(2);
    expect(stats.commitsLast90DaysCapped).toBe(false);
  });
});
