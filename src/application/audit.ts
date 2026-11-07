import {
  type AiRiskAssessment,
  type AiRiskLevel,
  type AuditCheck,
  type AuditCheckStatus,
  type AuditConfidence,
  type AuditDimensions,
  type CodeQualitySummary,
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

export interface AiRiskInput {
  readonly stats: RepositoryStats;
  readonly signals: AuditSignals;
  readonly presence: PresenceFlags;
  readonly healthPercentage: number | null;
}

interface PresenceFlags {
  readonly readme: boolean;
  readonly license: boolean;
  readonly contributing: boolean;
  readonly codeOfConduct: boolean;
  readonly issueTemplate: boolean;
  readonly docs: boolean;
  readonly tests: boolean;
  readonly ci: boolean;
  readonly manifest: boolean;
  readonly lockfile: boolean;
  readonly lint: boolean;
  readonly docker: boolean;
  readonly examples: boolean;
  readonly sourceLayout: boolean;
  readonly securityPolicy: boolean;
  readonly dependabot: boolean;
}

type PresenceKey = keyof PresenceFlags;

const DOCUMENTATION_WEIGHTS: ReadonlyArray<readonly [PresenceKey, number]> = [
  ["readme", 20],
  ["license", 15],
  ["contributing", 10],
  ["codeOfConduct", 5],
  ["issueTemplate", 5],
  ["docs", 10],
];

const ENGINEERING_WEIGHTS: ReadonlyArray<readonly [PresenceKey, number]> = [
  ["tests", 22],
  ["ci", 22],
  ["manifest", 12],
  ["lockfile", 8],
  ["lint", 8],
  ["docs", 5],
  ["docker", 5],
  ["examples", 5],
  ["sourceLayout", 13],
];

const SECURITY_WEIGHTS: ReadonlyArray<readonly [PresenceKey, number]> = [
  ["license", 25],
  ["securityPolicy", 30],
  ["dependabot", 20],
  ["ci", 15],
  ["lockfile", 10],
];

function weightedScore(
  flags: PresenceFlags,
  weights: readonly (readonly [PresenceKey, number])[],
): number {
  return weights.reduce((total, [key, weight]) => total + (flags[key] ? weight : 0), 0);
}

function communityPresence(
  community: CommunitySignals | null,
  rootNames: readonly string[],
  githubDirectory: readonly string[] | null,
): Pick<PresenceFlags, "readme" | "license" | "contributing" | "codeOfConduct" | "issueTemplate"> {
  return {
    readme: Boolean(community?.readme) || rootNames.some((name) => /^readme(?:\..+)?$/.test(name)),
    license: Boolean(community?.license),
    contributing:
      Boolean(community?.contributing) ||
      rootNames.some((name) => /^contributing(?:\..+)?$/.test(name)),
    codeOfConduct:
      Boolean(community?.codeOfConduct) ||
      rootNames.some((name) => /^code[_-]?of[_-]?conduct(?:\..+)?$/.test(name)),
    issueTemplate:
      Boolean(community?.issueTemplate) || includesGithubName(githubDirectory, "ISSUE_TEMPLATE"),
  };
}

function engineeringPresence(
  evidenceNames: readonly string[],
  rootNames: readonly string[],
  githubDirectory: readonly string[] | null,
): Pick<
  PresenceFlags,
  | "docs"
  | "tests"
  | "ci"
  | "manifest"
  | "lockfile"
  | "lint"
  | "docker"
  | "examples"
  | "sourceLayout"
  | "securityPolicy"
  | "dependabot"
> {
  return {
    docs:
      includesAny(evidenceNames, DOC_DIRECTORIES) ||
      evidenceNames.some((name) => name.startsWith("docs.")),
    tests:
      includesAny(evidenceNames, TEST_DIRECTORIES) ||
      evidenceNames.some((name) => /\.(test|spec)\.[^.]+$/i.test(name)),
    ci: includesAny(rootNames, CI_FILES) || includesGithubName(githubDirectory, "workflows"),
    manifest:
      includesAny(evidenceNames, MANIFEST_NAMES) ||
      evidenceNames.some((name) => /\.(csproj|sln)$/.test(name)),
    lockfile: includesAny(evidenceNames, LOCKFILE_NAMES),
    lint: includesAny(evidenceNames, LINT_NAMES),
    docker:
      rootNames.includes("dockerfile") ||
      rootNames.some((name) => name.startsWith("docker-compose") || name === "compose.yml"),
    examples: includesAny(evidenceNames, EXAMPLE_DIRECTORIES),
    sourceLayout: includesAny(rootNames, SOURCE_DIRECTORIES),
    securityPolicy:
      rootNames.includes("security.md") || includesGithubName(githubDirectory, "SECURITY.md"),
    dependabot: includesGithubName(githubDirectory, "dependabot.yml"),
  };
}

function presenceFlags(stats: RepositoryStats, signals: AuditSignals): PresenceFlags {
  const rootNames = normalizedNames(signals.rootFiles);
  const evidenceNames = [...rootNames, ...normalizedNames(signals.sourceFiles)];
  const community = communityPresence(signals.community, rootNames, signals.githubDirectory);

  return {
    ...community,
    license: Boolean(stats.license) || community.license,
    ...engineeringPresence(evidenceNames, rootNames, signals.githubDirectory),
  };
}

function isCodeProject(
  stats: RepositoryStats,
  signals: AuditSignals,
  presence: PresenceFlags,
): boolean {
  if (presence.manifest) {
    return true;
  }

  if (CODE_LANGUAGES.has((stats.language ?? "").trim().toLowerCase())) {
    return true;
  }

  return Boolean(
    signals.rootFiles?.some((file) =>
      /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|cs|kt|swift|php|rb|dart)$/i.test(file),
    ),
  );
}

function riskGaps(
  stats: RepositoryStats,
  signals: AuditSignals,
  presence: PresenceFlags,
  healthPercentage: number | null,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const penalize = (points: number, reason?: string): void => {
    score += points;

    if (reason) {
      reasons.push(reason);
    }
  };

  if (!presence.readme) {
    penalize(12, "未发现 README");
  }

  if (!presence.docs) {
    penalize(8, "未发现文档目录");
  }

  if (!presence.license) {
    penalize(10, "缺少许可证");
  }

  if (healthPercentage !== null && healthPercentage < 30) {
    penalize(10, "社区健康度较低");
  }

  const projectGaps = isCodeProject(stats, signals, presence)
    ? codeProjectGaps(presence)
    : generalGaps(presence);

  return {
    score: score + projectGaps.score,
    reasons: [...reasons, ...projectGaps.reasons],
  };
}

function codeProjectGaps(presence: PresenceFlags): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (!presence.tests) {
    score += 18;
    reasons.push("未发现测试目录");
  }

  if (!presence.ci) {
    score += 18;
    reasons.push("未发现 CI 配置");
  }

  if (!presence.manifest) {
    score += 10;
    reasons.push("未发现依赖清单");
  }

  if (!presence.lockfile) {
    score += 5;
    reasons.push("未锁定依赖版本");
  }

  if (!presence.lint) {
    score += 5;
    reasons.push("未发现 lint/format 配置");
  }

  return { score, reasons };
}

function generalGaps(presence: PresenceFlags): { score: number; reasons: string[] } {
  let score = 0;

  if (!presence.tests) {
    score += 6;
  }

  if (!presence.ci) {
    score += 6;
  }

  return { score, reasons: [] };
}

function adoptionRelief(stats: RepositoryStats): number {
  if (stats.stars >= 500 || stats.forks >= 50) {
    return 25;
  }

  if (stats.stars >= 100 || stats.forks >= 20) {
    return 20;
  }

  if (stats.stars >= 20) {
    return 10;
  }

  return 0;
}

function activityRelief(stats: RepositoryStats): number {
  return stats.commitsLast90Days !== null && stats.commitsLast90Days >= 3 ? 5 : 0;
}

function riskLevel(score: number): AiRiskLevel {
  if (score >= 70) {
    return "high";
  }

  if (score >= 35) {
    return "medium";
  }

  return "low";
}

function createAiRisk(input: AiRiskInput): AiRiskAssessment {
  const { stats, signals, presence, healthPercentage } = input;

  if (signals.rootFiles === null && signals.community === null) {
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

  const gaps = riskGaps(stats, signals, presence, healthPercentage);
  const normalized = clamp(gaps.score - adoptionRelief(stats) - activityRelief(stats));

  return {
    level: riskLevel(normalized),
    score: normalized,
    reasons: gaps.reasons.length > 0 ? gaps.reasons : ["未发现明显的工程信号缺口"],
  };
}

interface MaintenanceResult {
  readonly assessment: ReturnType<typeof assessMaintenance>;
  readonly score: number;
}

function maintenanceFor(stats: RepositoryStats, now: Date): MaintenanceResult {
  const assessment = assessMaintenance(stats, now);

  if (stats.archived) {
    return { assessment, score: 0 };
  }

  const score = Math.round(
    statusScore(assessment.status) * 0.65 + frequencyScore(stats.commitsLast90Days) * 0.35,
  );

  return { assessment, score };
}

function documentationScore(healthPercentage: number | null, presence: PresenceFlags): number {
  return Math.round(
    clamp((healthPercentage ?? 0) * 0.35 + weightedScore(presence, DOCUMENTATION_WEIGHTS)),
  );
}

function engineeringScore(presence: PresenceFlags): number {
  return Math.round(clamp(weightedScore(presence, ENGINEERING_WEIGHTS)));
}

function securityScore(scorecard: AuditSignals["scorecard"], presence: PresenceFlags): number {
  if (scorecard && scorecard.score >= 0) {
    return Math.round(clamp(scorecard.score, 0, 10) * 10);
  }

  return Math.round(clamp(weightedScore(presence, SECURITY_WEIGHTS)));
}

function overallScore(codeQuality: CodeQualitySummary | null, dimensions: AuditDimensions): number {
  if (codeQuality) {
    return Math.round(
      clamp(
        codeQuality.score * 0.6 +
          dimensions.maintenance * 0.15 +
          dimensions.documentation * 0.1 +
          dimensions.security * 0.15,
      ),
    );
  }

  return Math.round(
    clamp(
      dimensions.maintenance * 0.25 +
        dimensions.documentation * 0.2 +
        dimensions.engineering * 0.3 +
        dimensions.security * 0.25,
    ),
  );
}

function resolveConfidence(
  communityAvailable: boolean,
  rootAvailable: boolean,
  scorecard: AuditSignals["scorecard"],
  codeQuality: CodeQualitySummary | null,
): AuditConfidence {
  let confidence: AuditConfidence = "low";

  if (communityAvailable && rootAvailable && scorecard) {
    confidence = "high";
  } else if (communityAvailable && rootAvailable) {
    confidence = "medium";
  }

  if (codeQuality?.confidence === "low" && confidence === "high") {
    return "medium";
  }

  return confidence;
}

function licenseDetail(presence: PresenceFlags, stats: RepositoryStats): string {
  if (presence.license) {
    return stats.license || "已声明许可证";
  }

  return "缺少许可证";
}

function securityDetail(presence: PresenceFlags): string {
  if (presence.securityPolicy) {
    return "发现 SECURITY 声明";
  }

  if (presence.dependabot) {
    return "发现依赖更新配置";
  }

  if (presence.license) {
    return "依赖许可证提供基础声明";
  }

  return "未发现安全策略";
}

function maintenanceCheckStatus(status: string): AuditCheckStatus {
  if (status === "archived") {
    return "fail";
  }

  if (status === "active") {
    return "pass";
  }

  if (status === "unknown") {
    return "unknown";
  }

  return "warn";
}

function frequencyCheckStatus(commits: number | null): AuditCheckStatus {
  if (commits === null) {
    return "unknown";
  }

  return commits > 0 ? "pass" : "warn";
}

function frequencyDetail(commits: number | null): string {
  if (commits === null) {
    return "暂无提交频率数据";
  }

  return `最近 90 天 ${commits} 次提交`;
}

function codeQualityCheckStatus(codeQuality: CodeQualitySummary | null): AuditCheckStatus {
  if (!codeQuality) {
    return "unknown";
  }

  if (codeQuality.score >= 75) {
    return "pass";
  }

  if (codeQuality.score >= 50) {
    return "warn";
  }

  return "fail";
}

function codeQualityDetail(codeQuality: CodeQualitySummary | null): string {
  if (!codeQuality) {
    return "尚未运行深度静态分析";
  }

  return `${codeQuality.score} / 100 · ${codeQuality.tools.join("、") || "未标记工具"}`;
}

function scorecardCheckStatus(scorecard: AuditSignals["scorecard"]): AuditCheckStatus {
  if (!scorecard) {
    return "unknown";
  }

  if (scorecard.score >= 7) {
    return "pass";
  }

  if (scorecard.score >= 4) {
    return "warn";
  }

  return "fail";
}

function scorecardDetail(scorecard: AuditSignals["scorecard"]): string {
  if (!scorecard) {
    return "该仓库暂无公开的 Scorecard 结果";
  }

  return `${scorecard.score.toFixed(1)} / 10`;
}

interface CheckInput {
  readonly presence: PresenceFlags;
  readonly stats: RepositoryStats;
  readonly maintenance: ReturnType<typeof assessMaintenance>;
  readonly codeQuality: CodeQualitySummary | null;
  readonly scorecard: AuditSignals["scorecard"];
  readonly communityAvailable: boolean;
  readonly rootAvailable: boolean;
}

function buildChecks(input: CheckInput): AuditCheck[] {
  const { presence, stats, maintenance, codeQuality, scorecard } = input;
  const availability = input.communityAvailable || input.rootAvailable;
  const checks: AuditCheck[] = [];

  addCheck(
    checks,
    "readme",
    "README",
    statusOf(presence.readme, availability),
    presence.readme ? "已提供项目说明" : "未发现 README",
  );
  addCheck(
    checks,
    "license",
    "许可证",
    statusOf(presence.license, availability),
    licenseDetail(presence, stats),
  );
  addCheck(
    checks,
    "tests",
    "测试",
    statusOf(presence.tests, input.rootAvailable),
    presence.tests ? "发现测试目录或测试文件" : "未发现测试目录",
  );
  addCheck(
    checks,
    "ci",
    "持续集成",
    statusOf(presence.ci, input.rootAvailable),
    presence.ci ? "发现 CI 配置" : "未发现 CI 配置",
  );
  addCheck(
    checks,
    "docs",
    "文档",
    statusOf(presence.docs, input.rootAvailable),
    presence.docs ? "发现文档目录" : "未发现文档目录",
  );
  addCheck(
    checks,
    "manifest",
    "依赖清单",
    statusOf(presence.manifest, input.rootAvailable),
    presence.manifest ? "发现依赖清单" : "未发现依赖清单",
  );
  addCheck(
    checks,
    "lockfile",
    "依赖锁定",
    statusOf(presence.lockfile, input.rootAvailable),
    presence.lockfile ? "发现 lockfile" : "未发现 lockfile",
  );
  addCheck(
    checks,
    "source-layout",
    "源码结构",
    statusOf(presence.sourceLayout, input.rootAvailable),
    presence.sourceLayout ? "发现常见源码目录" : "未发现常见源码目录",
  );
  addCheck(
    checks,
    "lint",
    "代码规范",
    statusOf(presence.lint, input.rootAvailable),
    presence.lint ? "发现 lint/format 配置" : "未发现 lint/format 配置",
  );
  addCheck(
    checks,
    "security",
    "安全策略",
    statusOf(presence.securityPolicy || presence.dependabot || presence.license, availability),
    securityDetail(presence),
  );
  addCheck(
    checks,
    "maintenance",
    "维护状态",
    maintenanceCheckStatus(maintenance.status),
    maintenance.description,
  );
  addCheck(
    checks,
    "frequency",
    "提交频率",
    frequencyCheckStatus(stats.commitsLast90Days),
    frequencyDetail(stats.commitsLast90Days),
  );
  addCheck(
    checks,
    "code-quality",
    "代码质量",
    codeQualityCheckStatus(codeQuality),
    codeQualityDetail(codeQuality),
  );
  addCheck(
    checks,
    "scorecard",
    "OpenSSF Scorecard",
    scorecardCheckStatus(scorecard),
    scorecardDetail(scorecard),
  );

  return checks;
}

function toScorecardSummary(
  scorecard: AuditSignals["scorecard"],
  fullName: string,
): ScorecardSummary | null {
  if (!scorecard) {
    return null;
  }

  return {
    score: scorecard.score,
    date: scorecard.date,
    url: `https://scorecard.dev/viewer/?uri=github.com/${fullName}`,
  };
}

export function createRepositoryAudit(
  stats: RepositoryStats,
  signals: AuditSignals,
  now: Date = new Date(),
): RepositoryAudit {
  const presence = presenceFlags(stats, signals);
  const rootAvailable = signals.rootFiles !== null;
  const communityAvailable = signals.community !== null;
  const healthPercentage = signals.community?.healthPercentage ?? null;
  const maintenance = maintenanceFor(stats, now);
  const codeQuality = scoreCodeQuality(signals.codeQuality ?? undefined);
  const dimensions: AuditDimensions = {
    maintenance: maintenance.score,
    documentation: documentationScore(healthPercentage, presence),
    engineering: engineeringScore(presence),
    security: securityScore(signals.scorecard, presence),
    codeQuality: codeQuality?.score ?? null,
  };
  const score = overallScore(codeQuality, dimensions);
  const confidence = resolveConfidence(
    communityAvailable,
    rootAvailable,
    signals.scorecard,
    codeQuality,
  );
  const aiRisk = createAiRisk({ stats, signals, presence, healthPercentage });
  const checks = buildChecks({
    presence,
    stats,
    maintenance: maintenance.assessment,
    codeQuality,
    scorecard: signals.scorecard,
    communityAvailable,
    rootAvailable,
  });
  const scorecard = toScorecardSummary(signals.scorecard, stats.fullName);

  return {
    score,
    grade: gradeForScore(score),
    confidence,
    dimensions,
    codeQuality,
    aiRisk,
    checks,
    scorecard,
    fetchedAt: now.toISOString(),
  };
}
