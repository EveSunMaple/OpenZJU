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

  const runWorker = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;

    if (index >= items.length) {
      return;
    }

    try {
      results[index] = await worker(items[index], index);
    } catch {
      results[index] = undefined;
    }

    await runWorker();
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));

  return results;
}

function uniqueRepos(projects: readonly Project[]): string[] {
  return [...new Set(projects.flatMap((project) => (project.repo ? [project.repo] : [])))];
}

interface StatsFetchState {
  fetchErrors: number;
  rateLimitErrors: number;
}

async function fetchGraphQL(
  client: StatsClient,
  repos: readonly string[],
  logger: Pick<Console, "info" | "warn" | "error">,
): Promise<Map<string, RepositoryStats> | null> {
  if (!client.hasToken) {
    return null;
  }

  try {
    const graph = await client.fetchGraphQLStats(repos);

    if (graph.size > 0) {
      logger.info(`  GraphQL 返回 ${graph.size}/${repos.length} 个仓库。`);
    }

    return graph;
  } catch (error) {
    logger.warn(`  GraphQL 同步失败，改用 REST：${(error as Error).message}`);
    return null;
  }
}

async function fetchRest(
  client: StatsClient,
  repos: readonly string[],
  logger: Pick<Console, "info" | "warn" | "error">,
  state: StatsFetchState,
): Promise<Map<string, RepositoryStats>> {
  const results = await mapWithConcurrency(repos, REST_CONCURRENCY, async (repo) => {
    try {
      return await client.fetchRestStats(repo);
    } catch (error) {
      state.fetchErrors += 1;

      if (isRateLimitError(error)) {
        state.rateLimitErrors += 1;
      }

      logger.warn(`  REST 同步失败 ${repo}：${(error as Error).message}`);

      return undefined;
    }
  });
  const fresh = new Map<string, RepositoryStats>();

  for (const stats of results) {
    if (stats) {
      fresh.set(stats.fullName.toLowerCase(), stats);
    }
  }

  return fresh;
}

function mergeStats(
  repos: readonly string[],
  fresh: ReadonlyMap<string, RepositoryStats>,
  previousByRepo: ReadonlyMap<string, RepositoryStats>,
): { repositories: Record<string, RepositoryStats>; cached: number; usedCache: boolean } {
  const repositories: Record<string, RepositoryStats> = {};
  let cached = 0;
  let usedCache = false;

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

  return { repositories, cached, usedCache };
}

function statsSource(
  fetched: number,
  usedCache: boolean,
  usedGraphQL: boolean,
  usedRest: boolean,
): RepositoryStatsSnapshot["source"] {
  if (fetched === 0) {
    return "cache";
  }

  if (usedCache || (usedGraphQL && usedRest)) {
    return "mixed";
  }

  if (usedGraphQL) {
    return "github-graphql";
  }

  return "github-rest";
}

function cachedStatsResult(
  repos: readonly string[],
  previous: RepositoryStatsSnapshot,
  previousByRepo: ReadonlyMap<string, RepositoryStats>,
  startedAt: number,
): SyncResult {
  const snapshot: RepositoryStatsSnapshot = {
    ...previous,
    source: "cache",
    repositories: Object.fromEntries(
      repos
        .map((repo) => [repo.toLowerCase(), previousByRepo.get(repo.toLowerCase())] as const)
        .filter((entry): entry is [string, RepositoryStats] => Boolean(entry[1])),
    ),
  };

  return {
    snapshot,
    summary: {
      total: repos.length,
      fetched: 0,
      cached: Object.keys(snapshot.repositories).length,
      missing: repos.length - Object.keys(snapshot.repositories).length,
      fetchErrors: 0,
      rateLimitErrors: 0,
      source: "cache",
      generatedAt: snapshot.generatedAt,
      durationMs: Date.now() - startedAt,
    },
  };
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
    return cachedStatsResult(repos, previous, previousByRepo, startedAt);
  }

  const client =
    options.client ??
    new GitHubClient({
      token: options.token,
    });

  logger.info(
    `同步 ${repos.length} 个 GitHub 仓库${client.hasToken ? "（已认证）" : "（未认证，受速率限制）"}…`,
  );

  const graph = await fetchGraphQL(client, repos, logger);
  const fresh = graph ?? new Map<string, RepositoryStats>();
  const missingAfterGraphQL = repos.filter((repo) => !fresh.has(repo.toLowerCase()));
  const state: StatsFetchState = { fetchErrors: 0, rateLimitErrors: 0 };
  const rest = await fetchRest(client, missingAfterGraphQL, logger, state);

  for (const [repo, stats] of rest) {
    fresh.set(repo, stats);
  }

  const { repositories, cached, usedCache } = mergeStats(repos, fresh, previousByRepo);
  const fetched = Object.keys(repositories).length - cached;
  const missing = repos.length - Object.keys(repositories).length;
  const source = statsSource(fetched, usedCache, graph !== null && graph.size > 0, rest.size > 0);

  const snapshot: RepositoryStatsSnapshot = {
    schemaVersion: 1,
    generatedAt: fetched > 0 ? now.toISOString() : previous.generatedAt,
    source,
    repositories,
  };

  await writeSnapshot(options.cachePath, snapshot);

  logger.info(
    `同步完成：${fetched} 个更新，${cached} 个使用缓存，${missing} 个缺失，${state.fetchErrors} 次请求失败（其中 ${state.rateLimitErrors} 次限流），用时 ${Date.now() - startedAt}ms。`,
  );

  return {
    snapshot,
    summary: {
      total: repos.length,
      fetched,
      cached,
      missing,
      fetchErrors: state.fetchErrors,
      rateLimitErrors: state.rateLimitErrors,
      source,
      generatedAt: snapshot.generatedAt,
      durationMs: Date.now() - startedAt,
    },
  };
}
