import {
  type AiRiskAssessment,
  type AiRiskLevel,
  type AuditCheck,
  type AuditCheckStatus,
  type AuditConfidence,
  gradeForScore,
  type RepositoryAudit,
  type ScorecardSummary,
} from "@/domain/project/repository-audit";
import type { RepositoryCodeQuality } from "@/domain/project/repository-code-quality";
import { assessMaintenance, type RepositoryStats } from "@/domain/project/repository-stats";
import { scoreCodeQuality } from "./code-quality";

export interface CommunitySignals {
  readonly healthPercentage: number | null;
  readonly readme: boolean;
  readonly license: boolean;
  readonly contributing: boolean;
  readonly codeOfConduct: boolean;
  readonly issueTemplate: boolean;
  readonly pullRequestTemplate: boolean;
}

export interface AuditSignals {
  readonly community: CommunitySignals | null;
  readonly rootFiles: readonly string[] | null;
  readonly sourceFiles?: readonly string[] | null;
  readonly githubDirectory: readonly string[] | null;
  readonly codeQuality?: RepositoryCodeQuality | null;
  readonly scorecard: {
    readonly score: number;
    readonly date: string | null;
  } | null;
}

const CODE_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "c++",
  "c",
  "kotlin",
  "swift",
  "c#",
  "php",
  "ruby",
  "dart",
  "vue",
  "svelte",
  "scala",
  "elixir",
  "clojure",
  "haskell",
  "lua",
]);

const MANIFEST_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "gemfile",
  "package.swift",
  "pubspec.yaml",
  "cmakelists.txt",
  "makefile",
  "meson.build",
  "build.zig",
  "deno.json",
  "deno.jsonc",
  "requirements.txt",
  "requirements-dev.txt",
  "environment.yml",
  "environment.yaml",
  "pipfile",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
  "composer.lock",
  "gemfile.lock",
  "pubspec.lock",
  "pnpm-workspace.yaml",
]);

const LINT_NAMES = new Set([
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "biome.json",
  "biome.jsonc",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  "prettier.config.js",
  "prettier.config.mjs",
  "ruff.toml",
  ".ruff.toml",
  ".golangci.yml",
  ".golangci.yaml",
  "rustfmt.toml",
  ".rustfmt.toml",
  ".clang-format",
  "stylelint.config.js",
]);

const CI_FILES = new Set([
  ".gitlab-ci.yml",
  "jenkinsfile",
  "azure-pipelines.yml",
  ".travis.yml",
  "appveyor.yml",
  "bitbucket-pipelines.yml",
]);

const DOC_DIRECTORIES = new Set(["docs", "doc", "documentation", "wiki"]);
const TEST_DIRECTORIES = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "cypress",
  "playwright",
]);
const EXAMPLE_DIRECTORIES = new Set(["example", "examples", "demo", "samples"]);
export const SOURCE_DIRECTORIES = new Set([
  "src",
  "lib",
  "app",
  "packages",
  "backend",
  "frontend",
  "firmware",
  "include",
  "core",
  "server",
  "cmd",
  "source",
]);

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedNames(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase());
}

function includesAny(values: readonly string[], candidates: ReadonlySet<string>): boolean {
  return values.some((value) => candidates.has(value));
}

function includesGithubName(values: readonly string[] | null, name: string): boolean {
  return (values ?? []).some((value) => value.toLowerCase() === name.toLowerCase());
}

function statusScore(status: string): number {
  switch (status) {
    case "active":
      return 100;
    case "maintained":
      return 82;
    case "low":
      return 55;
    case "dormant":
      return 18;
    default:
      return 0;
  }
}

function frequencyScore(commits: number | null): number {
  if (commits === null) {
    return 35;
  }

  if (commits >= 20) {
    return 100;
  }

  if (commits >= 10) {
    return 88;
  }

  if (commits >= 3) {
    return 72;
  }

  if (commits >= 1) {
    return 55;
  }

  return 25;
}

function statusOf(present: boolean, dataAvailable: boolean): AuditCheckStatus {
  if (!dataAvailable) {
    return "unknown";
  }

  return present ? "pass" : "fail";
}

function addCheck(
  checks: AuditCheck[],
  id: string,
  label: string,
  status: AuditCheckStatus,
  detail: string,
): void {
  checks.push({ id, label, status, detail });
}

function createAiRisk(
  stats: RepositoryStats,
  signals: AuditSignals,
  hasReadme: boolean,
  hasDocs: boolean,
  hasTests: boolean,
  hasCi: boolean,
  hasManifest: boolean,
  hasLockfile: boolean,
  hasLint: boolean,
  hasLicense: boolean,
  healthPercentage: number | null,
): AiRiskAssessment {
  const rootAvailable = signals.rootFiles !== null;
  const communityAvailable = signals.community !== null;

  if (!rootAvailable && !communityAvailable) {
    return {
      level: "unknown",
      score: 0,
      reasons: ["缺少足够的仓库工程数据"],
    };
  }

  if (stats.archived) {
    return {
      level: "unknown",
      score: 0,
      reasons: ["仓库已归档，未做 AI 风险判断"],
    };
  }

  const isCodeProject =
    hasManifest ||
    CODE_LANGUAGES.has((stats.language ?? "").trim().toLowerCase()) ||
    signals.rootFiles?.some((file) =>
      /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|cs|kt|swift|php|rb|dart)$/i.test(file),
    );

  let score = 0;
  const reasons: string[] = [];

  if (!hasReadme) {
    score += 12;
    reasons.push("未发现 README");
  }

  if (!hasDocs) {
    score += 8;
    reasons.push("未发现文档目录");
  }

  if (!hasLicense) {
    score += 10;
    reasons.push("缺少许可证");
  }

  if (healthPercentage !== null && healthPercentage < 30) {
    score += 10;
    reasons.push("社区健康度较低");
  }

  if (isCodeProject) {
    if (!hasTests) {
      score += 18;
      reasons.push("未发现测试目录");
    }

    if (!hasCi) {
      score += 18;
      reasons.push("未发现 CI 配置");
    }

    if (!hasManifest) {
      score += 10;
      reasons.push("未发现依赖清单");
    }

    if (!hasLockfile) {
      score += 5;
      reasons.push("未锁定依赖版本");
    }

    if (!hasLint) {
      score += 5;
      reasons.push("未发现 lint/format 配置");
    }
  } else {
    if (!hasTests) {
      score += 6;
    }

    if (!hasCi) {
      score += 6;
    }
  }

  const adoptionRelief =
    stats.stars >= 500 || stats.forks >= 50
      ? 25
      : stats.stars >= 100 || stats.forks >= 20
        ? 20
        : stats.stars >= 20
          ? 10
          : 0;
  const activityRelief = stats.commitsLast90Days !== null && stats.commitsLast90Days >= 3 ? 5 : 0;
  const normalized = clamp(score - adoptionRelief - activityRelief);
  const level: AiRiskLevel = normalized >= 70 ? "high" : normalized >= 35 ? "medium" : "low";

  return {
    level,
    score: normalized,
    reasons: reasons.length > 0 ? reasons : ["未发现明显的工程信号缺口"],
  };
}

export function createRepositoryAudit(
  stats: RepositoryStats,
  signals: AuditSignals,
  now: Date = new Date(),
): RepositoryAudit {
  const rootAvailable = signals.rootFiles !== null;
  const communityAvailable = signals.community !== null;
  const rootNames = normalizedNames(signals.rootFiles);
  const evidenceNames = [...rootNames, ...normalizedNames(signals.sourceFiles)];
  const community = signals.community;

  const hasReadme =
    Boolean(community?.readme) || rootNames.some((name) => /^readme(?:\..+)?$/.test(name));
  const hasLicense = Boolean(stats.license) || Boolean(community?.license);
  const hasContributing =
    Boolean(community?.contributing) ||
    rootNames.some((name) => /^contributing(?:\..+)?$/.test(name));
  const hasCodeOfConduct =
    Boolean(community?.codeOfConduct) ||
    rootNames.some((name) => /^code[_-]?of[_-]?conduct(?:\..+)?$/.test(name));
  const hasIssueTemplate =
    Boolean(community?.issueTemplate) ||
    includesGithubName(signals.githubDirectory, "ISSUE_TEMPLATE");
  const hasDocs =
    includesAny(evidenceNames, DOC_DIRECTORIES) ||
    evidenceNames.some((name) => name.startsWith("docs."));
  const hasTests =
    includesAny(evidenceNames, TEST_DIRECTORIES) ||
    evidenceNames.some((name) => /\.(test|spec)\.[^.]+$/i.test(name));
  const hasCi =
    includesAny(rootNames, CI_FILES) || includesGithubName(signals.githubDirectory, "workflows");
  const hasManifest =
    includesAny(evidenceNames, MANIFEST_NAMES) ||
    evidenceNames.some((name) => /\.(csproj|sln)$/.test(name));
  const hasLockfile = includesAny(evidenceNames, LOCKFILE_NAMES);
  const hasLint = includesAny(evidenceNames, LINT_NAMES);
  const hasDocker =
    rootNames.includes("dockerfile") ||
    rootNames.some((name) => name.startsWith("docker-compose") || name === "compose.yml");
  const hasExamples = includesAny(evidenceNames, EXAMPLE_DIRECTORIES);
  const hasSourceLayout = includesAny(rootNames, SOURCE_DIRECTORIES);
  const hasSecurityPolicy =
    rootNames.includes("security.md") || includesGithubName(signals.githubDirectory, "SECURITY.md");
  const hasDependabot = includesGithubName(signals.githubDirectory, "dependabot.yml");
  const healthPercentage = community?.healthPercentage ?? null;

  const maintenanceAssessment = assessMaintenance(stats, now);
  const maintenance = stats.archived
    ? 0
    : Math.round(
        statusScore(maintenanceAssessment.status) * 0.65 +
          frequencyScore(stats.commitsLast90Days) * 0.35,
      );

  const documentation = Math.round(
    clamp(
      (healthPercentage ?? 0) * 0.35 +
        (hasReadme ? 20 : 0) +
        (hasLicense ? 15 : 0) +
        (hasContributing ? 10 : 0) +
        (hasCodeOfConduct ? 5 : 0) +
        (hasIssueTemplate ? 5 : 0) +
        (hasDocs ? 10 : 0),
    ),
  );

  const engineering = Math.round(
    clamp(
      (hasTests ? 22 : 0) +
        (hasCi ? 22 : 0) +
        (hasManifest ? 12 : 0) +
        (hasLockfile ? 8 : 0) +
        (hasLint ? 8 : 0) +
        (hasDocs ? 5 : 0) +
        (hasDocker ? 5 : 0) +
        (hasExamples ? 5 : 0) +
        (hasSourceLayout ? 13 : 0),
    ),
  );

  const security =
    signals.scorecard && signals.scorecard.score >= 0
      ? Math.round(clamp(signals.scorecard.score, 0, 10) * 10)
      : Math.round(
          clamp(
            (hasLicense ? 25 : 0) +
              (hasSecurityPolicy ? 30 : 0) +
              (hasDependabot ? 20 : 0) +
              (hasCi ? 15 : 0) +
              (hasLockfile ? 10 : 0),
          ),
        );

  const codeQuality = scoreCodeQuality(signals.codeQuality ?? undefined);
  const score = Math.round(
    clamp(
      codeQuality
        ? codeQuality.score * 0.6 + maintenance * 0.15 + documentation * 0.1 + security * 0.15
        : maintenance * 0.25 + documentation * 0.2 + engineering * 0.3 + security * 0.25,
    ),
  );
  const signalConfidence: AuditConfidence =
    communityAvailable && rootAvailable && signals.scorecard
      ? "high"
      : communityAvailable && rootAvailable
        ? "medium"
        : "low";
  const confidence: AuditConfidence =
    codeQuality && codeQuality.confidence === "low" && signalConfidence === "high"
      ? "medium"
      : signalConfidence;
  const aiRisk = createAiRisk(
    stats,
    signals,
    hasReadme,
    hasDocs,
    hasTests,
    hasCi,
    hasManifest,
    hasLockfile,
    hasLint,
    hasLicense,
    healthPercentage,
  );

  const checks: AuditCheck[] = [];
  addCheck(
    checks,
    "readme",
    "README",
    statusOf(hasReadme, communityAvailable || rootAvailable),
    hasReadme ? "已提供项目说明" : "未发现 README",
  );
  addCheck(
    checks,
    "license",
    "许可证",
    statusOf(hasLicense, communityAvailable || rootAvailable),
    hasLicense ? stats.license || "已声明许可证" : "缺少许可证",
  );
  addCheck(
    checks,
    "tests",
    "测试",
    statusOf(hasTests, rootAvailable),
    hasTests ? "发现测试目录或测试文件" : "未发现测试目录",
  );
  addCheck(
    checks,
    "ci",
    "持续集成",
    statusOf(hasCi, rootAvailable),
    hasCi ? "发现 CI 配置" : "未发现 CI 配置",
  );
  addCheck(
    checks,
    "docs",
    "文档",
    statusOf(hasDocs, rootAvailable),
    hasDocs ? "发现文档目录" : "未发现文档目录",
  );
  addCheck(
    checks,
    "manifest",
    "依赖清单",
    statusOf(hasManifest, rootAvailable),
    hasManifest ? "发现依赖清单" : "未发现依赖清单",
  );
  addCheck(
    checks,
    "lockfile",
    "依赖锁定",
    statusOf(hasLockfile, rootAvailable),
    hasLockfile ? "发现 lockfile" : "未发现 lockfile",
  );
  addCheck(
    checks,
    "source-layout",
    "源码结构",
    statusOf(hasSourceLayout, rootAvailable),
    hasSourceLayout ? "发现常见源码目录" : "未发现常见源码目录",
  );
  addCheck(
    checks,
    "lint",
    "代码规范",
    statusOf(hasLint, rootAvailable),
    hasLint ? "发现 lint/format 配置" : "未发现 lint/format 配置",
  );
  addCheck(
    checks,
    "security",
    "安全策略",
    statusOf(hasSecurityPolicy || hasDependabot || hasLicense, communityAvailable || rootAvailable),
    hasSecurityPolicy
      ? "发现 SECURITY 声明"
      : hasDependabot
        ? "发现依赖更新配置"
        : hasLicense
          ? "依赖许可证提供基础声明"
          : "未发现安全策略",
  );
  addCheck(
    checks,
    "maintenance",
    "维护状态",
    maintenanceAssessment.status === "archived"
      ? "fail"
      : maintenanceAssessment.status === "active"
        ? "pass"
        : maintenanceAssessment.status === "unknown"
          ? "unknown"
          : "warn",
    maintenanceAssessment.description,
  );
  addCheck(
    checks,
    "frequency",
    "提交频率",
    stats.commitsLast90Days === null ? "unknown" : stats.commitsLast90Days > 0 ? "pass" : "warn",
    stats.commitsLast90Days === null
      ? "暂无提交频率数据"
      : `最近 90 天 ${stats.commitsLast90Days} 次提交`,
  );
  addCheck(
    checks,
    "code-quality",
    "代码质量",
    codeQuality
      ? codeQuality.score >= 75
        ? "pass"
        : codeQuality.score >= 50
          ? "warn"
          : "fail"
      : "unknown",
    codeQuality
      ? `${codeQuality.score} / 100 · ${codeQuality.tools.join("、") || "未标记工具"}`
      : "尚未运行深度静态分析",
  );
  addCheck(
    checks,
    "scorecard",
    "OpenSSF Scorecard",
    signals.scorecard
      ? signals.scorecard.score >= 7
        ? "pass"
        : signals.scorecard.score >= 4
          ? "warn"
          : "fail"
      : "unknown",
    signals.scorecard
      ? `${signals.scorecard.score.toFixed(1)} / 10`
      : "该仓库暂无公开的 Scorecard 结果",
  );

  const scorecard: ScorecardSummary | null = signals.scorecard
    ? {
        score: signals.scorecard.score,
        date: signals.scorecard.date,
        url: `https://scorecard.dev/viewer/?uri=github.com/${stats.fullName}`,
      }
    : null;

  return {
    score,
    grade: gradeForScore(score),
    confidence,
    dimensions: {
      maintenance,
      documentation,
      engineering,
      security,
      codeQuality: codeQuality?.score ?? null,
    },
    codeQuality,
    aiRisk,
    checks,
    scorecard,
    fetchedAt: now.toISOString(),
  };
}
