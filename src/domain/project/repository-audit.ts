import type { CodeQualityMetrics } from "./repository-code-quality";

export const AUDIT_GRADES = ["A", "B", "C", "D", "F"] as const;

export type AuditGrade = (typeof AUDIT_GRADES)[number];

export const AUDIT_CONFIDENCES = ["high", "medium", "low"] as const;

export type AuditConfidence = (typeof AUDIT_CONFIDENCES)[number];

export const AI_RISK_LEVELS = ["low", "medium", "high", "unknown"] as const;

export type AiRiskLevel = (typeof AI_RISK_LEVELS)[number];

export const AI_RISK_LABELS: Readonly<Record<AiRiskLevel, string>> = {
  low: "低",
  medium: "中",
  high: "高",
  unknown: "未知",
};

export type AuditCheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface AuditDimensions {
  readonly maintenance: number;
  readonly documentation: number;
  readonly engineering: number;
  readonly security: number;
  readonly codeQuality: number | null;
}

export interface CodeQualitySummary {
  readonly score: number;
  readonly maintainability: number | null;
  readonly reliability: number | null;
  readonly security: number | null;
  readonly confidence: AuditConfidence;
  readonly tools: readonly string[];
  readonly metrics: CodeQualityMetrics;
}

export interface AuditCheck {
  readonly id: string;
  readonly label: string;
  readonly status: AuditCheckStatus;
  readonly detail: string;
}

export interface AiRiskAssessment {
  readonly level: AiRiskLevel;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface ScorecardSummary {
  readonly score: number;
  readonly date: string | null;
  readonly url: string;
}

export interface RepositoryAudit {
  readonly score: number;
  readonly grade: AuditGrade;
  readonly confidence: AuditConfidence;
  readonly dimensions: AuditDimensions;
  readonly codeQuality: CodeQualitySummary | null;
  readonly aiRisk: AiRiskAssessment;
  readonly checks: readonly AuditCheck[];
  readonly scorecard: ScorecardSummary | null;
  readonly fetchedAt: string;
}

export interface RepositoryAuditSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly source: "github+scorecard" | "github" | "cache" | "mixed";
  readonly audits: Readonly<Record<string, RepositoryAudit>>;
}

export const EMPTY_AUDIT_SNAPSHOT: RepositoryAuditSnapshot = {
  schemaVersion: 1,
  generatedAt: "",
  source: "cache",
  audits: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAudit(value: unknown): value is RepositoryAudit {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.score !== "number" ||
    !AUDIT_GRADES.includes(value.grade as AuditGrade) ||
    !AUDIT_CONFIDENCES.includes(value.confidence as AuditConfidence) ||
    !isRecord(value.dimensions) ||
    !isRecord(value.aiRisk) ||
    !Array.isArray(value.checks) ||
    typeof value.fetchedAt !== "string"
  ) {
    return false;
  }

  const dimensions = value.dimensions;
  const aiRisk = value.aiRisk;

  return (
    typeof dimensions.maintenance === "number" &&
    typeof dimensions.documentation === "number" &&
    typeof dimensions.engineering === "number" &&
    typeof dimensions.security === "number" &&
    (dimensions.codeQuality === undefined ||
      dimensions.codeQuality === null ||
      typeof dimensions.codeQuality === "number") &&
    AI_RISK_LEVELS.includes(aiRisk.level as AiRiskLevel) &&
    typeof aiRisk.score === "number" &&
    Array.isArray(aiRisk.reasons)
  );
}

export function parseAuditSnapshot(value: unknown): RepositoryAuditSnapshot {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !isRecord(value.audits)
  ) {
    return EMPTY_AUDIT_SNAPSHOT;
  }

  const audits = Object.fromEntries(
    Object.entries(value.audits)
      .filter((entry): entry is [string, RepositoryAudit] => isAudit(entry[1]))
      .map(([repo, audit]) => [
        repo,
        {
          ...audit,
          dimensions: {
            ...audit.dimensions,
            codeQuality: audit.dimensions.codeQuality ?? null,
          },
          codeQuality: audit.codeQuality ?? null,
        } satisfies RepositoryAudit,
      ]),
  );

  return {
    schemaVersion: 1,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    source:
      value.source === "github+scorecard" ||
      value.source === "github" ||
      value.source === "mixed" ||
      value.source === "cache"
        ? value.source
        : "cache",
    audits,
  };
}

export function gradeForScore(score: number): AuditGrade {
  if (score >= 90) {
    return "A";
  }

  if (score >= 75) {
    return "B";
  }

  if (score >= 60) {
    return "C";
  }

  if (score >= 40) {
    return "D";
  }

  return "F";
}

export function confidenceLabel(confidence: AuditConfidence): string {
  return {
    high: "高",
    medium: "中",
    low: "低",
  }[confidence];
}
