import type { Project } from "@/domain/project/project";
import type { RepositoryStats, RepositoryStatsSnapshot } from "@/domain/project/repository-stats";
import { EMPTY_SNAPSHOT } from "@/domain/project/snapshot";
import { GitHubApiError, GitHubClient } from "./github-client";
import { readSnapshot, writeSnapshot } from "./stats-store";

export interface StatsClient {
  readonly hasToken: boolean;
  fetchGraphQLStats(repos: readonly string[]): Promise<Map<string, RepositoryStats>>;
  fetchRestStats(repo: string): Promise<RepositoryStats>;
}

export interface SyncOptions {
  readonly projects: readonly Project[];
  readonly cachePath: string;
  readonly offline?: boolean;
  readonly token?: string;
  readonly client?: StatsClient;
  readonly now?: Date;
  readonly logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface SyncSummary {
  readonly total: number;
  readonly fetched: number;
  readonly cached: number;
  readonly missing: number;
  readonly fetchErrors: number;
  readonly rateLimitErrors: number;
  readonly source: RepositoryStatsSnapshot["source"];
  readonly generatedAt: string;
  readonly durationMs: number;
}

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) {
    return false;
  }

  return (
    error.status === 429 ||
    (error.status === 403 && (error.remaining === 0 || /rate limit/i.test(error.message)))
  );
}

export interface SyncResult {
  readonly snapshot: RepositoryStatsSnapshot;
  readonly summary: SyncSummary;
}

const REST_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = await worker(items[index], index);
      } catch {
        results[index] = undefined;
      }
    }
  });

  await Promise.all(runners);

  return results;
}

function uniqueRepos(projects: readonly Project[]): string[] {
  return [...new Set(projects.flatMap((project) => (project.repo ? [project.repo] : [])))];
}

export async function syncRepositoryStats(options: SyncOptions): Promise<SyncResult> {
  const logger = options.logger ?? console;
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const repos = uniqueRepos(options.projects);
  const previous = await readSnapshot(options.cachePath).catch(() => EMPTY_SNAPSHOT);
  const previousByRepo = new Map(
    Object.entries(previous.repositories).map(([repo, stats]) => [repo.toLowerCase(), stats]),
  );

  if (options.offline || repos.length === 0) {
    const snapshot: RepositoryStatsSnapshot = {
      ...previous,
      source: "cache",
      repositories: Object.fromEntries(
        repos
          .map((repo) => [repo.toLowerCase(), previousByRepo.get(repo.toLowerCase())] as const)
          .filter((entry): entry is [string, RepositoryStats] => Boolean(entry[1])),
      ),
    };

    const summary: SyncSummary = {
      total: repos.length,
      fetched: 0,
      cached: Object.keys(snapshot.repositories).length,
      missing: repos.length - Object.keys(snapshot.repositories).length,
      fetchErrors: 0,
      rateLimitErrors: 0,
      source: "cache",
      generatedAt: snapshot.generatedAt,
      durationMs: Date.now() - startedAt,
    };

    return { snapshot, summary };
  }

  const client =
    options.client ??
    new GitHubClient({
      token: options.token,
    });

  logger.info(
    `同步 ${repos.length} 个 GitHub 仓库${client.hasToken ? "（已认证）" : "（未认证，受速率限制）"}…`,
  );

  const fresh = new Map<string, RepositoryStats>();
  let usedGraphQL = false;
  let usedRest = false;
  let usedCache = false;
  let fetchErrors = 0;
  let rateLimitErrors = 0;

  if (client.hasToken) {
    try {
      const graph = await client.fetchGraphQLStats(repos);

      for (const [repo, stats] of graph) {
        fresh.set(repo, stats);
      }

      if (fresh.size > 0) {
        usedGraphQL = true;
        logger.info(`  GraphQL 返回 ${fresh.size}/${repos.length} 个仓库。`);
      }
    } catch (error) {
      logger.warn(`  GraphQL 同步失败，改用 REST：${(error as Error).message}`);
    }
  }

  const missingAfterGraphQL = repos.filter((repo) => !fresh.has(repo.toLowerCase()));

  const restResults = await mapWithConcurrency(
    missingAfterGraphQL,
    REST_CONCURRENCY,
    async (repo) => {
      try {
        return await client.fetchRestStats(repo);
      } catch (error) {
        fetchErrors += 1;

        if (isRateLimitError(error)) {
          rateLimitErrors += 1;
        }

        logger.warn(`  REST 同步失败 ${repo}：${(error as Error).message}`);

        return undefined;
      }
    },
  );

  for (const stats of restResults) {
    if (stats) {
      fresh.set(stats.fullName.toLowerCase(), stats);
      usedRest = true;
    }
  }

  const repositories: Record<string, RepositoryStats> = {};
  let cached = 0;

  for (const repo of repos) {
    const key = repo.toLowerCase();
    const stats = fresh.get(key);

    if (stats) {
      repositories[key] = stats;
      continue;
    }

    const fallback = previousByRepo.get(key);

    if (fallback) {
      repositories[key] = fallback;
      cached += 1;
      usedCache = true;
    }
  }

  const fetched = Object.keys(repositories).length - cached;
  const missing = repos.length - Object.keys(repositories).length;
  const source: RepositoryStatsSnapshot["source"] =
    fetched === 0
      ? "cache"
      : usedCache
        ? "mixed"
        : usedGraphQL && usedRest
          ? "mixed"
          : usedGraphQL
            ? "github-graphql"
            : "github-rest";

  const snapshot: RepositoryStatsSnapshot = {
    schemaVersion: 1,
    generatedAt: fetched > 0 ? now.toISOString() : previous.generatedAt,
    source,
    repositories,
  };

  await writeSnapshot(options.cachePath, snapshot);

  logger.info(
    `同步完成：${fetched} 个更新，${cached} 个使用缓存，${missing} 个缺失，${fetchErrors} 次请求失败（其中 ${rateLimitErrors} 次限流），用时 ${Date.now() - startedAt}ms。`,
  );

  return {
    snapshot,
    summary: {
      total: repos.length,
      fetched,
      cached,
      missing,
      fetchErrors,
      rateLimitErrors,
      source,
      generatedAt: snapshot.generatedAt,
      durationMs: Date.now() - startedAt,
    },
  };
}
