export interface RepositoryStats {
  readonly fullName: string;
  readonly description: string | null;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly language: string | null;
  readonly license: string | null;
  readonly archived: boolean;
  readonly defaultBranch: string | null;
  readonly lastCommitAt: string | null;
  readonly pushedAt: string | null;
  readonly commitsLast90Days: number | null;
  readonly commitsLast90DaysCapped: boolean;
  readonly commitsLastYear: number | null;
  readonly homepageUrl: string | null;
  readonly topics: readonly string[];
  readonly fetchedAt: string;
}

export interface RepositoryStatsSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly source: "github-graphql" | "github-rest" | "mixed" | "cache";
  readonly repositories: Readonly<Record<string, RepositoryStats>>;
}

export const MAINTENANCE_STATUSES = [
  "active",
  "maintained",
  "low",
  "dormant",
  "archived",
  "unknown",
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export interface MaintenanceAssessment {
  readonly status: MaintenanceStatus;
  readonly label: string;
  readonly description: string;
  readonly daysSinceActivity: number | null;
}

export const MAINTENANCE_META: Readonly<
  Record<MaintenanceStatus, { readonly label: string; readonly description: string }>
> = {
  active: {
    label: "活跃",
    description: "最近 90 天内有提交。",
  },
  maintained: {
    label: "维护中",
    description: "最近一年内有提交。",
  },
  low: {
    label: "低频",
    description: "最近一次提交在一至两年前。",
  },
  dormant: {
    label: "停滞",
    description: "超过两年没有提交。",
  },
  archived: {
    label: "已归档",
    description: "仓库维护者已将其归档。",
  },
  unknown: {
    label: "未知",
    description: "暂未获取到仓库活动数据。",
  },
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? null : timestamp;
}

export function assessMaintenance(
  stats: RepositoryStats | undefined,
  now: Date = new Date(),
): MaintenanceAssessment {
  if (!stats) {
    return {
      status: "unknown",
      ...MAINTENANCE_META.unknown,
      daysSinceActivity: null,
    };
  }

  if (stats.archived) {
    return {
      status: "archived",
      ...MAINTENANCE_META.archived,
      daysSinceActivity: null,
    };
  }

  const activityAt = toTimestamp(stats.lastCommitAt) ?? toTimestamp(stats.pushedAt);

  if (activityAt === null) {
    return {
      status: "unknown",
      ...MAINTENANCE_META.unknown,
      daysSinceActivity: null,
    };
  }

  const daysSinceActivity = Math.max(0, Math.floor((now.getTime() - activityAt) / DAY_IN_MS));

  if (daysSinceActivity <= 90) {
    return {
      status: "active",
      ...MAINTENANCE_META.active,
      daysSinceActivity,
    };
  }

  if (daysSinceActivity <= 365) {
    return {
      status: "maintained",
      ...MAINTENANCE_META.maintained,
      daysSinceActivity,
    };
  }

  if (daysSinceActivity <= 730) {
    return {
      status: "low",
      ...MAINTENANCE_META.low,
      daysSinceActivity,
    };
  }

  return {
    status: "dormant",
    ...MAINTENANCE_META.dormant,
    daysSinceActivity,
  };
}

export function latestActivityAt(stats: RepositoryStats | undefined): string | null {
  return stats?.lastCommitAt ?? stats?.pushedAt ?? null;
}
