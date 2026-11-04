import type { RepositoryStats, RepositoryStatsSnapshot } from "./repository-stats";

export const EMPTY_SNAPSHOT: RepositoryStatsSnapshot = {
  schemaVersion: 1,
  generatedAt: "",
  source: "cache",
  repositories: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStats(value: unknown): value is RepositoryStats {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.fullName === "string" &&
    typeof value.stars === "number" &&
    typeof value.archived === "boolean" &&
    typeof value.fetchedAt === "string" &&
    Array.isArray(value.topics)
  );
}

export function parseSnapshot(value: unknown): RepositoryStatsSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.repositories)) {
    return EMPTY_SNAPSHOT;
  }

  const repositories = Object.fromEntries(
    Object.entries(value.repositories).filter((entry): entry is [string, RepositoryStats] =>
      isStats(entry[1]),
    ),
  );

  return {
    schemaVersion: 1,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    source:
      value.source === "github-graphql" ||
      value.source === "github-rest" ||
      value.source === "mixed" ||
      value.source === "cache"
        ? value.source
        : "cache",
    repositories,
  };
}
