import { type AuditSignals, createRepositoryAudit, SOURCE_DIRECTORIES } from "@/application/audit";
import type { Project } from "@/domain/project/project";
import type { RepositoryAudit, RepositoryAuditSnapshot } from "@/domain/project/repository-audit";
import type { CodeQualitySnapshot } from "@/domain/project/repository-code-quality";
import type { RepositoryStatsSnapshot } from "@/domain/project/repository-stats";
import { type CommunityProfileSignals, GitHubClient } from "../github/github-client";
import { EMPTY_AUDIT_SNAPSHOT, readAuditSnapshot, writeAuditSnapshot } from "./audit-store";
import type { ScorecardSignal } from "./scorecard-client";

export interface AuditSignalsClient {
  readonly hasToken: boolean;
  fetchCommunityProfile(repo: string): Promise<CommunityProfileSignals | null>;
  fetchRootEntries(repo: string, ref: string): Promise<string[]>;
  fetchDirectoryEntries(repo: string, path: string, ref: string): Promise<string[]>;
}

export interface AuditScorecardClient {
  fetch(repo: string): Promise<ScorecardSignal | null>;
}

export interface AuditSyncOptions {
  readonly projects: readonly Project[];
  readonly statsSnapshot: RepositoryStatsSnapshot;
  readonly codeQualitySnapshot?: CodeQualitySnapshot;
  readonly cachePath: string;
  readonly token?: string;
  readonly offline?: boolean;
  readonly client?: AuditSignalsClient;
  readonly scorecardClient?: AuditScorecardClient;
  readonly now?: Date;
  readonly logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface AuditSyncSummary {
  readonly total: number;
  readonly fetched: number;
  readonly cached: number;
  readonly skipped: number;
  readonly fetchErrors: number;
  readonly source: RepositoryAuditSnapshot["source"];
  readonly generatedAt: string;
  readonly durationMs: number;
}

export interface AuditSyncResult {
  readonly snapshot: RepositoryAuditSnapshot;
  readonly summary: AuditSyncSummary;
}

const AUDIT_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;

        try {
          results[index] = await worker(items[index]);
        } catch {
          results[index] = undefined;
        }
      }
    }),
  );

  return results;
}

function uniqueRepos(projects: readonly Project[]): string[] {
  return [...new Set(projects.flatMap((project) => (project.repo ? [project.repo] : [])))];
}

async function fetchSignals(
  repo: string,
  branch: string,
  client: AuditSignalsClient,
  scorecardClient: AuditScorecardClient,
): Promise<{ signals: AuditSignals; errors: number }> {
  let errors = 0;

  const [community, rootFiles, scorecard] = await Promise.all([
    client.fetchCommunityProfile(repo).catch(() => {
      errors += 1;
      return null;
    }),
    client.fetchRootEntries(repo, branch).catch(() => {
      errors += 1;
      return null;
    }),
    scorecardClient.fetch(repo),
  ]);

  let githubDirectory: string[] | null = [];

  if (rootFiles?.some((name) => name.toLowerCase() === ".github")) {
    githubDirectory = await client.fetchDirectoryEntries(repo, ".github", branch).catch(() => {
      errors += 1;
      return null;
    });
  } else if (rootFiles === null) {
    githubDirectory = null;
  }

  const sourceDirectories = (rootFiles ?? [])
    .filter((name) => SOURCE_DIRECTORIES.has(name.trim().toLowerCase()))
    .slice(0, 2);
  let sourceFiles: string[] | null = null;

  if (sourceDirectories.length > 0) {
    const sourceEntries = await Promise.all(
      sourceDirectories.map((directory) =>
        client.fetchDirectoryEntries(repo, directory, branch).catch(() => {
          errors += 1;
          return null;
        }),
      ),
    );

    if (sourceEntries.some((entries) => entries !== null)) {
      sourceFiles = sourceEntries.flatMap((entries) => entries ?? []);
    }
  }

  return {
    signals: {
      community,
      rootFiles,
      sourceFiles,
      githubDirectory,
      scorecard,
    },
    errors,
  };
}

export async function syncRepositoryAudits(options: AuditSyncOptions): Promise<AuditSyncResult> {
  const logger = options.logger ?? console;
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const repos = uniqueRepos(options.projects);
  const previous = await readAuditSnapshot(options.cachePath);
  const previousByRepo = new Map(
    Object.entries(previous.audits).map(([repo, audit]) => [repo.toLowerCase(), audit]),
  );
  const statsByRepo = new Map(
    Object.entries(options.statsSnapshot.repositories).map(([repo, stats]) => [
      repo.toLowerCase(),
      stats,
    ]),
  );
  const codeQualityByRepo = new Map(
    Object.entries(options.codeQualitySnapshot?.repositories ?? {}).map(([repo, quality]) => [
      repo.toLowerCase(),
      quality,
    ]),
  );

  const currentRepos = repos.filter((repo) => statsByRepo.has(repo.toLowerCase()));

  if (options.offline || currentRepos.length === 0) {
    const audits: Record<string, RepositoryAudit> = {};

    for (const repo of currentRepos) {
      const cached = previousByRepo.get(repo.toLowerCase());

      if (cached) {
        audits[repo.toLowerCase()] = cached;
      }
    }

    const snapshot: RepositoryAuditSnapshot = {
      schemaVersion: 1,
      generatedAt: previous.generatedAt,
      source: "cache",
      audits,
    };

    await writeAuditSnapshot(options.cachePath, snapshot);

    return {
      snapshot,
      summary: {
        total: currentRepos.length,
        fetched: 0,
        cached: Object.keys(audits).length,
        skipped: currentRepos.length - Object.keys(audits).length,
        fetchErrors: 0,
        source: "cache",
        generatedAt: snapshot.generatedAt,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  const client =
    options.client ??
    new GitHubClient({
      token: options.token,
    });
  const scorecardClient =
    options.scorecardClient ?? new (await import("./scorecard-client")).ScorecardClient();

  if (!client.hasToken) {
    const audits: Record<string, RepositoryAudit> = {};

    for (const repo of currentRepos) {
      const cached = previousByRepo.get(repo.toLowerCase());

      if (cached) {
        audits[repo.toLowerCase()] = cached;
      }
    }

    const snapshot: RepositoryAuditSnapshot = {
      schemaVersion: 1,
      generatedAt: previous.generatedAt,
      source: "cache",
      audits,
    };

    await writeAuditSnapshot(options.cachePath, snapshot);
    logger.warn("  审计同步需要 GITHUB_TOKEN 才能读取社区健康度与文件树；当前使用已有审计缓存。");

    return {
      snapshot,
      summary: {
        total: currentRepos.length,
        fetched: 0,
        cached: Object.keys(audits).length,
        skipped: currentRepos.length - Object.keys(audits).length,
        fetchErrors: 0,
        source: "cache",
        generatedAt: snapshot.generatedAt,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  logger.info(`审计 ${currentRepos.length} 个 GitHub 仓库…`);

  const results = await mapWithConcurrency(currentRepos, AUDIT_CONCURRENCY, async (repo) => {
    const stats = statsByRepo.get(repo.toLowerCase());

    if (!stats) {
      return undefined;
    }

    const branch = stats.defaultBranch || "main";
    const { signals, errors } = await fetchSignals(repo, branch, client, scorecardClient);
    const signalsWithQuality = {
      ...signals,
      codeQuality: codeQualityByRepo.get(repo.toLowerCase()) ?? null,
    };
    const previousAudit = previousByRepo.get(repo.toLowerCase());
    const hasFreshRootData = signals.rootFiles !== null;
    const audit =
      hasFreshRootData || !previousAudit
        ? createRepositoryAudit(stats, signalsWithQuality, now)
        : previousAudit;

    return {
      repo: repo.toLowerCase(),
      audit,
      fresh: hasFreshRootData,
      errors,
    };
  });

  const audits: Record<string, RepositoryAudit> = {};
  let fetched = 0;
  let cached = 0;
  let fetchErrors = 0;
  let usedScorecard = false;

  for (const result of results) {
    if (!result) {
      continue;
    }

    audits[result.repo] = result.audit;
    fetchErrors += result.errors;

    if (result.audit.scorecard) {
      usedScorecard = true;
    }

    if (result.fresh) {
      fetched += 1;
    } else {
      cached += 1;
    }
  }

  const source: RepositoryAuditSnapshot["source"] =
    fetched === 0 ? "cache" : cached > 0 ? "mixed" : usedScorecard ? "github+scorecard" : "github";

  const snapshot: RepositoryAuditSnapshot = {
    schemaVersion: 1,
    generatedAt: fetched > 0 ? now.toISOString() : previous.generatedAt,
    source,
    audits,
  };

  await writeAuditSnapshot(options.cachePath, snapshot);

  const skipped = currentRepos.length - Object.keys(audits).length;

  logger.info(
    `审计完成：${fetched} 个更新，${cached} 个缓存回退，${skipped} 个跳过，${fetchErrors} 次请求失败，用时 ${Date.now() - startedAt}ms。`,
  );

  return {
    snapshot,
    summary: {
      total: currentRepos.length,
      fetched,
      cached,
      skipped,
      fetchErrors,
      source,
      generatedAt: snapshot.generatedAt,
      durationMs: Date.now() - startedAt,
    },
  };
}

export { EMPTY_AUDIT_SNAPSHOT };
