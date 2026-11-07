import type { AuditConfidence, CodeQualitySummary } from "@/domain/project/repository-audit";
import type {
  CodeQualityMetrics,
  RepositoryCodeQuality,
} from "@/domain/project/repository-code-quality";

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasComplexityMetrics(metrics: CodeQualityMetrics): boolean {
  return metrics.averageComplexity !== null;
}

function hasLintMetrics(metrics: CodeQualityMetrics): boolean {
  return metrics.lintErrors !== null || metrics.lintWarnings !== null;
}

function hasSecurityMetrics(metrics: CodeQualityMetrics): boolean {
  return metrics.secrets !== null || metrics.vulnerabilities !== null;
}

function complexityScore(metrics: CodeQualityMetrics): number | null {
  if (!hasComplexityMetrics(metrics) || metrics.averageComplexity === null) {
    return null;
  }

  const average = metrics.averageComplexity;
  let score: number;

  if (average <= 4) {
    score = 100;
  } else if (average <= 6) {
    score = 85;
  } else if (average <= 8) {
    score = 70;
  } else if (average <= 10) {
    score = 55;
  } else if (average <= 15) {
    score = 35;
  } else {
    score = 15;
  }

  if (metrics.highComplexityFunctions !== null && metrics.functions > 0) {
    const highRatio = metrics.highComplexityFunctions / metrics.functions;
    score -= clamp(highRatio * 120, 0, 30);
  }

  return clamp(score);
}

function duplicationScore(metrics: CodeQualityMetrics): number | null {
  if (metrics.duplicationPercentage === null) {
    return null;
  }

  const percentage = metrics.duplicationPercentage;

  if (percentage <= 3) {
    return 100;
  }

  if (percentage <= 5) {
    return 88;
  }

  if (percentage <= 10) {
    return 70;
  }

  if (percentage <= 20) {
    return 45;
  }

  if (percentage <= 30) {
    return 25;
  }

  return 10;
}

function lintScore(metrics: CodeQualityMetrics): number | null {
  if (!hasLintMetrics(metrics)) {
    return null;
  }

  const errors = metrics.lintErrors ?? 0;
  const warnings = metrics.lintWarnings ?? 0;
  const weightedIssues = errors + warnings * 0.25;
  const kloc = Math.max(metrics.loc / 1000, 0.5);
  const density = weightedIssues / kloc;

  if (density <= 0) {
    return 100;
  }

  if (density <= 2) {
    return 88;
  }

  if (density <= 5) {
    return 70;
  }

  if (density <= 10) {
    return 50;
  }

  if (density <= 20) {
    return 30;
  }

  return 15;
}

function securityScore(metrics: CodeQualityMetrics): number | null {
  if (!hasSecurityMetrics(metrics)) {
    return null;
  }

  let penalty = 0;

  if (metrics.secrets !== null) {
    penalty += metrics.secrets * 60;
  }

  if (metrics.vulnerabilities) {
    penalty +=
      metrics.vulnerabilities.critical * 40 +
      metrics.vulnerabilities.high * 25 +
      metrics.vulnerabilities.medium * 8 +
      metrics.vulnerabilities.low * 2;
  }

  return clamp(100 - penalty);
}

function weightedAverage(
  components: readonly { score: number | null; weight: number }[],
): number | null {
  const available = components.filter(
    (component): component is { score: number; weight: number } => component.score !== null,
  );

  if (available.length === 0) {
    return null;
  }

  const totalWeight = available.reduce((total, component) => total + component.weight, 0);

  return Math.round(
    available.reduce((total, component) => total + component.score * component.weight, 0) /
      totalWeight,
  );
}

function qualityConfidence(
  complexity: number | null,
  duplication: number | null,
  lint: number | null,
  security: number | null,
): AuditConfidence {
  if (complexity !== null && duplication !== null && lint !== null && security !== null) {
    return "high";
  }

  if (complexity !== null && duplication !== null) {
    return "medium";
  }

  return "low";
}

export function scoreCodeQuality(
  quality: RepositoryCodeQuality | undefined,
): CodeQualitySummary | null {
  if (!quality || quality.status === "skipped" || !quality.metrics) {
    return null;
  }

  const metrics = quality.metrics;
  const complexity = complexityScore(metrics);
  const duplication = duplicationScore(metrics);
  const lint = lintScore(metrics);
  const security = securityScore(metrics);
  const maintainability = weightedAverage([
    { score: complexity, weight: 35 },
    { score: duplication, weight: 20 },
  ]);
  const score = weightedAverage([
    { score: complexity, weight: 35 },
    { score: duplication, weight: 20 },
    { score: lint, weight: 30 },
    { score: security, weight: 15 },
  ]);

  if (score === null) {
    return null;
  }

  return {
    score,
    maintainability,
    reliability: lint,
    security,
    confidence: qualityConfidence(complexity, duplication, lint, security),
    tools: quality.tools,
    metrics,
  };
}
