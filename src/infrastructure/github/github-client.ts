import type { RepositoryStats } from "@/domain/project/repository-stats";

const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "zju-open-source-atlas/1.0";
const REQUEST_TIMEOUT_MS = 20_000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_COMMITS_PER_PAGE = 100;
const GRAPHQL_BATCH_SIZE = 10;

const REPOSITORY_FRAGMENT = `
fragment RepositoryStats on Repository {
  nameWithOwner
  description
  stargazerCount
  forkCount
  isArchived
  pushedAt
  homepageUrl
  primaryLanguage { name }
  licenseInfo { spdxId }
  defaultBranchRef {
    name
    target {
      ... on Commit {
        committedDate
        commitsLast90Days: history(since: $since90, first: 1) { totalCount }
        commitsLastYear: history(since: $since365, first: 1) { totalCount }
      }
    }
  }
  repositoryTopics(first: 20) {
    nodes { topic { name } }
  }
  issues(states: OPEN) { totalCount }
}
`;

interface GraphQLRepository {
  nameWithOwner: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  pushedAt: string | null;
  homepageUrl: string | null;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string } | null;
  defaultBranchRef: {
    name: string;
    target: {
      committedDate?: string | null;
      commitsLast90Days?: { totalCount: number } | null;
      commitsLastYear?: { totalCount: number } | null;
    } | null;
  } | null;
  repositoryTopics: {
    nodes: Array<{ topic: { name: string } }>;
  } | null;
  issues: { totalCount: number };
}

interface GraphQLResponse {
  data?: Record<string, GraphQLRepository | null>;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
}

interface RestRepository {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  default_branch: string | null;
  pushed_at: string | null;
  homepage: string | null;
  topics?: string[];
}

interface RestCommit {
  commit: {
    author: { date: string } | null;
    committer: { date: string } | null;
  };
}

export interface CommunityProfileSignals {
  readonly healthPercentage: number | null;
  readonly readme: boolean;
  readonly license: boolean;
  readonly contributing: boolean;
  readonly codeOfConduct: boolean;
  readonly issueTemplate: boolean;
  readonly pullRequestTemplate: boolean;
}

interface RestCommunityProfile {
  health_percentage: number | null;
  files: {
    readme: unknown | null;
    license: unknown | null;
    contributing: unknown | null;
    code_of_conduct: unknown | null;
    issue_template: unknown | null;
    pull_request_template: unknown | null;
  } | null;
}

interface RestContentEntry {
  name: string;
  type: string;
}

interface RequestResult<T> {
  data: T;
  remaining: number | null;
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly remaining: number | null;

  constructor(message: string, status: number, remaining: number | null = null) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.remaining = remaining;
  }
}

export interface GitHubClientOptions {
  readonly token?: string;
  readonly apiUrl?: string;
  readonly userAgent?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");

  if (!owner || !name) {
    throw new Error(`Invalid repository identifier: ${repo}`);
  }

  return { owner, name };
}

function parseRemaining(headers: Headers): number | null {
  const value = headers.get("x-ratelimit-remaining");

  if (value === null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? null : parsed;
}

function buildGraphQLQuery(repos: readonly string[]): string {
  const aliases = repos
    .map((repo, index) => {
      const { owner, name } = splitRepo(repo);

      return `  repo${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...RepositoryStats }`;
    })
    .join("\n");

  return `${REPOSITORY_FRAGMENT}
query RepositoryBatch($since90: GitTimestamp!, $since365: GitTimestamp!) {
${aliases}
}`;
}

function normalizeGraphQLStats(data: GraphQLRepository, now: Date): RepositoryStats {
  const target = data.defaultBranchRef?.target;

  return {
    fullName: data.nameWithOwner,
    description: data.description,
    stars: data.stargazerCount,
    forks: data.forkCount,
    openIssues: data.issues.totalCount,
    language: data.primaryLanguage?.name ?? null,
    license: data.licenseInfo?.spdxId ?? null,
    archived: data.isArchived,
    defaultBranch: data.defaultBranchRef?.name ?? null,
    lastCommitAt: target?.committedDate ?? data.pushedAt,
    pushedAt: data.pushedAt,
    commitsLast90Days: target?.commitsLast90Days?.totalCount ?? null,
    commitsLast90DaysCapped: false,
    commitsLastYear: target?.commitsLastYear?.totalCount ?? null,
    homepageUrl: data.homepageUrl,
    topics: data.repositoryTopics?.nodes.map((node) => node.topic.name) ?? [],
    fetchedAt: now.toISOString(),
  };
}

function normalizeRestStats(
  data: RestRepository,
  commits: readonly RestCommit[],
  now: Date,
): RepositoryStats {
  const latestCommit =
    commits[0]?.commit.committer?.date ?? commits[0]?.commit.author?.date ?? null;
  const ninetyDaysAgo = now.getTime() - 90 * DAY_IN_MS;
  const recentCommitCount = commits.filter((commit) => {
    const date = commit.commit.committer?.date ?? commit.commit.author?.date;

    return date ? Date.parse(date) >= ninetyDaysAgo : false;
  }).length;

  return {
    fullName: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language,
    license: data.license?.spdx_id ?? null,
    archived: data.archived,
    defaultBranch: data.default_branch,
    lastCommitAt: latestCommit ?? data.pushed_at,
    pushedAt: data.pushed_at,
    commitsLast90Days: commits.length === 0 ? 0 : recentCommitCount,
    commitsLast90DaysCapped: commits.length >= MAX_COMMITS_PER_PAGE,
    commitsLastYear: null,
    homepageUrl: data.homepage,
    topics: data.topics ?? [],
    fetchedAt: now.toISOString(),
  };
}

function parseAtomCommitDates(xml: string): string[] {
  return xml
    .split("<entry>")
    .slice(1)
    .map((entry) => entry.match(/<updated>([^<]+)<\/updated>/)?.[1])
    .filter((date): date is string => Boolean(date));
}

export class GitHubClient {
  readonly #token: string | undefined;
  readonly #apiUrl: string;
  readonly #userAgent: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  #lastRemaining: number | null = null;

  constructor(options: GitHubClientOptions = {}) {
    this.#token = options.token?.trim() || undefined;
    this.#apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  get hasToken(): boolean {
    return Boolean(this.#token);
  }

  get rateLimitRemaining(): number | null {
    return this.#lastRemaining;
  }

  #headers(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": this.#userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.#token) {
      headers.Authorization = `Bearer ${this.#token}`;
    }

    return headers;
  }

  async #request<T>(path: string): Promise<RequestResult<T>> {
    const response = await this.#fetch(`${this.#apiUrl}${path}`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const remaining = parseRemaining(response.headers);
    this.#lastRemaining = remaining;

    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub API ${response.status} for ${path}: ${response.statusText}`,
        response.status,
        remaining,
      );
    }

    return { data: (await response.json()) as T, remaining };
  }

  async fetchGraphQLStats(repos: readonly string[]): Promise<Map<string, RepositoryStats>> {
    if (!this.#token) {
      throw new GitHubApiError("A token is required for the GitHub GraphQL API", 401);
    }

    const now = this.#now();
    const since90 = new Date(now.getTime() - 90 * DAY_IN_MS).toISOString();
    const since365 = new Date(now.getTime() - 365 * DAY_IN_MS).toISOString();
    const result = new Map<string, RepositoryStats>();

    for (let offset = 0; offset < repos.length; offset += GRAPHQL_BATCH_SIZE) {
      const batch = repos.slice(offset, offset + GRAPHQL_BATCH_SIZE);
      const response = await this.#fetch(`${this.#apiUrl}/graphql`, {
        method: "POST",
        headers: {
          ...this.#headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: buildGraphQLQuery(batch),
          variables: { since90, since365 },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const remaining = parseRemaining(response.headers);
      this.#lastRemaining = remaining;

      if (!response.ok) {
        throw new GitHubApiError(
          `GitHub GraphQL ${response.status}: ${response.statusText}`,
          response.status,
          remaining,
        );
      }

      const payload = (await response.json()) as GraphQLResponse;
      const failedAliases = new Set(
        (payload.errors ?? [])
          .flatMap((error) => error.path ?? [])
          .filter((part): part is string => typeof part === "string" && part.startsWith("repo")),
      );

      batch.forEach((repo, index) => {
        const key = `repo${index}`;
        const data = payload.data?.[key];

        if (data && !failedAliases.has(key)) {
          result.set(repo.toLowerCase(), normalizeGraphQLStats(data, now));
        }
      });
    }

    return result;
  }

  async fetchRestStats(repo: string): Promise<RepositoryStats> {
    const now = this.#now();
    const metadata = await this.#request<RestRepository>(`/repos/${repo}`);
    let commits: RestCommit[] = [];

    if ((metadata.remaining ?? 1) > 0) {
      try {
        const since = new Date(now.getTime() - 90 * DAY_IN_MS).toISOString();
        const commitResult = await this.#request<RestCommit[]>(
          `/repos/${repo}/commits?since=${encodeURIComponent(since)}&per_page=${MAX_COMMITS_PER_PAGE}`,
        );
        commits = Array.isArray(commitResult.data) ? commitResult.data : [];
      } catch (error) {
        if (!(error instanceof GitHubApiError) || error.status !== 409) {
          console.warn(`  ! commit history unavailable for ${repo}, will try Atom feed`);
        }
      }
    }

    const stats = normalizeRestStats(metadata.data, commits, now);

    if (commits.length === 0) {
      const atomDates = await this.fetchAtomCommitDates(metadata.data.default_branch, repo);

      if (atomDates.length > 0) {
        const ninetyDaysAgo = now.getTime() - 90 * DAY_IN_MS;
        const recent = atomDates.filter((date) => Date.parse(date) >= ninetyDaysAgo);

        return {
          ...stats,
          lastCommitAt: atomDates[0] ?? stats.lastCommitAt,
          commitsLast90Days: recent.length,
          commitsLast90DaysCapped: atomDates.length >= 20 && recent.length === 20,
        };
      }
    }

    return stats;
  }

  async fetchCommunityProfile(repo: string): Promise<CommunityProfileSignals | null> {
    try {
      const { data } = await this.#request<RestCommunityProfile>(
        `/repos/${repo}/community/profile`,
      );
      const files = data.files;

      return {
        healthPercentage:
          typeof data.health_percentage === "number" ? data.health_percentage : null,
        readme: Boolean(files?.readme),
        license: Boolean(files?.license),
        contributing: Boolean(files?.contributing),
        codeOfConduct: Boolean(files?.code_of_conduct),
        issueTemplate: Boolean(files?.issue_template),
        pullRequestTemplate: Boolean(files?.pull_request_template),
      };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async fetchRootEntries(repo: string, ref: string): Promise<string[]> {
    return this.fetchDirectoryEntries(repo, "", ref);
  }

  async fetchDirectoryEntries(repo: string, path: string, ref: string): Promise<string[]> {
    const suffix = path ? `/${path}` : "";
    const { data } = await this.#request<RestContentEntry[] | RestContentEntry>(
      `/repos/${repo}/contents${suffix}?ref=${encodeURIComponent(ref)}`,
    );

    if (Array.isArray(data)) {
      return data.map((entry) => entry.name);
    }

    return data?.name ? [data.name] : [];
  }

  async fetchAtomCommitDates(branch: string | null, repo: string): Promise<string[]> {
    const branchName = branch || "HEAD";

    try {
      const response = await this.#fetch(
        `https://github.com/${repo}/commits/${encodeURIComponent(branchName)}.atom`,
        {
          headers: {
            Accept: "application/atom+xml",
            "User-Agent": this.#userAgent,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        return [];
      }

      return parseAtomCommitDates(await response.text());
    } catch {
      return [];
    }
  }
}
