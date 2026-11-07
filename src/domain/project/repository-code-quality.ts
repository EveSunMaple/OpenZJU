export const CODE_QUALITY_STATUSES = ["complete", "partial", "skipped"] as const;

export type CodeQualityStatus = (typeof CODE_QUALITY_STATUSES)[number];

export interface CodeQualityVulnerabilities {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export interface CodeQualityMetrics {
  readonly files: number;
  readonly loc: number;
  readonly functions: number;
  readonly averageComplexity: number | null;
  readonly maxComplexity: number | null;
  readonly highComplexityFunctions: number | null;
  readonly duplicationPercentage: number | null;
  readonly duplicatedBlocks: number | null;
  readonly lintErrors: number | null;
  readonly lintWarnings: number | null;
  readonly secrets: number | null;
  readonly vulnerabilities: CodeQualityVulnerabilities | null;
}

export interface RepositoryCodeQuality {
  readonly analyzedAt: string;
  readonly commitAt: string | null;
  readonly branch: string;
  readonly language: string | null;
  readonly status: CodeQualityStatus;
  readonly skippedReason?: string;
  readonly tools: readonly string[];
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly metrics: CodeQualityMetrics | null;
}

export interface CodeQualitySnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly source: "deep-audit" | "mixed" | "cache";
  readonly repositories: Readonly<Record<string, RepositoryCodeQuality>>;
}

export const EMPTY_CODE_QUALITY_SNAPSHOT: CodeQualitySnapshot = {
  schemaVersion: 1,
  generatedAt: "",
  source: "cache",
  repositories: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isVulnerabilities(value: unknown): value is CodeQualityVulnerabilities {
  return (
    isRecord(value) &&
    typeof value.critical === "number" &&
    typeof value.high === "number" &&
    typeof value.medium === "number" &&
    typeof value.low === "number"
  );
}

function isMetrics(value: unknown): value is CodeQualityMetrics {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.files === "number" &&
    typeof value.loc === "number" &&
    typeof value.functions === "number" &&
    isNullableNumber(value.averageComplexity) &&
    isNullableNumber(value.maxComplexity) &&
    isNullableNumber(value.highComplexityFunctions) &&
    isNullableNumber(value.duplicationPercentage) &&
    isNullableNumber(value.duplicatedBlocks) &&
    isNullableNumber(value.lintErrors) &&
    isNullableNumber(value.lintWarnings) &&
    isNullableNumber(value.secrets) &&
    (value.vulnerabilities === null || isVulnerabilities(value.vulnerabilities))
  );
}

function isCodeQuality(value: unknown): value is RepositoryCodeQuality {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.analyzedAt === "string" &&
    (value.commitAt === null || typeof value.commitAt === "string") &&
    typeof value.branch === "string" &&
    (value.language === null || typeof value.language === "string") &&
    CODE_QUALITY_STATUSES.includes(value.status as CodeQualityStatus) &&
    (value.skippedReason === undefined || typeof value.skippedReason === "string") &&
    Array.isArray(value.tools) &&
    value.tools.every((tool) => typeof tool === "string") &&
    isRecord(value.toolVersions) &&
    Object.values(value.toolVersions).every((version) => typeof version === "string") &&
    (value.metrics === null || isMetrics(value.metrics))
  );
}

export function parseCodeQualitySnapshot(value: unknown): CodeQualitySnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.repositories)) {
    return EMPTY_CODE_QUALITY_SNAPSHOT;
  }

  const repositories = Object.fromEntries(
    Object.entries(value.repositories).filter((entry): entry is [string, RepositoryCodeQuality] =>
      isCodeQuality(entry[1]),
    ),
  );

  return {
    schemaVersion: 1,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    source:
      value.source === "deep-audit" || value.source === "mixed" || value.source === "cache"
        ? value.source
        : "cache",
    repositories,
  };
}
