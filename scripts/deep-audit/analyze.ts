import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type {
  CodeQualityMetrics,
  CodeQualityVulnerabilities,
  RepositoryCodeQuality,
} from "../../src/domain/project/repository-code-quality";
import { writeCodeQualitySnapshot } from "../../src/infrastructure/code-quality/code-quality-store";

interface DeepAuditRepo {
  readonly repo: string;
  readonly branch: string;
  readonly language: string | null;
  readonly commitAt: string | null;
  readonly archived: boolean;
}

interface DeepAuditChunks {
  readonly generatedAt: string;
  readonly chunks: readonly {
    readonly index: number;
    readonly repositories: readonly DeepAuditRepo[];
  }[];
}

interface ToolResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly available: boolean;
}

interface LizardMetrics {
  readonly files: number;
  readonly loc: number;
  readonly functions: number;
  readonly averageComplexity: number | null;
  readonly maxComplexity: number | null;
  readonly highComplexityFunctions: number;
}

interface LintMetrics {
  readonly errors: number;
  readonly warnings: number;
  readonly tools: readonly string[];
}

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const LARGE_REPO_KB = 100 * 1000;
const TOOL_TIMEOUT_MS = 90_000;
const SPARSE_PATTERNS = [
  "*.py",
  "*.pyi",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.ts",
  "*.tsx",
  "*.vue",
  "*.svelte",
  "*.c",
  "*.h",
  "*.cc",
  "*.cpp",
  "*.cxx",
  "*.hpp",
  "*.hh",
  "*.java",
  "*.kt",
  "*.kts",
  "*.go",
  "*.rs",
  "*.cs",
  "*.swift",
  "*.rb",
  "*.php",
  "*.dart",
  "*.lua",
  "*.scala",
  "*.ex",
  "*.exs",
  "*.hs",
  "*.clj",
  "*.sh",
  "*.ipynb",
  "*.html",
  "*.htm",
  "*.md",
  "*.mdx",
  "*.tex",
  "*.cmake",
  "CMakeLists.txt",
  "Makefile",
  "*.json",
  "*.lock",
  "*.toml",
  "*.yaml",
  "*.yml",
  "*.gradle",
  "*.xml",
  "*.sql",
  "*.proto",
  "*.sol",
];
const MAX_BUFFER = 64 * 1024 * 1024;
function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;

  if (!value && !fallback) {
    throw new Error(`缺少参数 ${name}`);
  }

  return value ?? fallback ?? "";
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutable(command: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }

    const candidate = join(directory, command);

    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function runTool(command: string, args: readonly string[], cwd: string): ToolResult {
  const executable = findExecutable(command);

  if (!executable) {
    return { stdout: "", stderr: "", status: null, available: false };
  }

  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: TOOL_TIMEOUT_MS,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    available: true,
  };
}

interface ProcessOptions {
  readonly cwd?: string;
  readonly stdio?: "ignore";
  readonly env?: NodeJS.ProcessEnv;
}

function runProcess(command: string, args: readonly string[], options: ProcessOptions): void {
  const executable = findExecutable(command);

  if (!executable) {
    throw new Error(`找不到命令 ${command}`);
  }

  execFileSync(executable, args, options);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current);

  return values;
}

function parseLizard(stdout: string): LizardMetrics | null {
  const rows = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("NLOC,"))
    .map(parseCsvLine)
    .filter(
      (row) => row.length >= 11 && row.slice(0, 5).every((value) => Number.isFinite(Number(value))),
    );

  if (rows.length === 0) {
    return null;
  }

  const files = new Set(rows.map((row) => row[6]).filter(Boolean));
  let loc = 0;
  let complexity = 0;
  let maxComplexity = 0;
  let highComplexityFunctions = 0;

  for (const row of rows) {
    const nloc = Number(row[0]);
    const ccn = Number(row[1]);

    loc += Number.isFinite(nloc) ? nloc : 0;
    complexity += Number.isFinite(ccn) ? ccn : 0;
    maxComplexity = Math.max(maxComplexity, Number.isFinite(ccn) ? ccn : 0);
    highComplexityFunctions += Number.isFinite(ccn) && ccn >= 15 ? 1 : 0;
  }

  return {
    files: files.size,
    loc,
    functions: rows.length,
    averageComplexity: rows.length > 0 ? Number((complexity / rows.length).toFixed(2)) : null,
    maxComplexity,
    highComplexityFunctions,
  };
}

async function parseJscpd(outputDirectory: string): Promise<{
  percentage: number | null;
  clones: number | null;
  lines: number | null;
} | null> {
  try {
    const report = JSON.parse(
      await readFile(join(outputDirectory, "jscpd-report.json"), "utf8"),
    ) as {
      statistics?: {
        total?: {
          percentage?: number;
          clones?: number;
          lines?: number;
        };
      };
    };
    const total = report.statistics?.total;

    if (!total) {
      return null;
    }

    return {
      percentage: typeof total.percentage === "number" ? Number(total.percentage.toFixed(2)) : null,
      clones: typeof total.clones === "number" ? total.clones : null,
      lines: typeof total.lines === "number" ? total.lines : null,
    };
  } catch {
    return null;
  }
}

function parseRuff(stdout: string): LintMetrics | null {
  try {
    const issues = JSON.parse(stdout) as unknown;

    if (!Array.isArray(issues)) {
      return null;
    }

    return { errors: issues.length, warnings: 0, tools: ["ruff"] };
  } catch {
    return null;
  }
}

function parseOxlint(stdout: string): LintMetrics | null {
  try {
    const report = JSON.parse(stdout) as { diagnostics?: { severity?: string }[] };

    if (!Array.isArray(report.diagnostics)) {
      return null;
    }

    let errors = 0;
    let warnings = 0;

    for (const diagnostic of report.diagnostics) {
      if (diagnostic.severity === "error") {
        errors += 1;
      } else {
        warnings += 1;
      }
    }

    return { errors, warnings, tools: ["oxlint"] };
  } catch {
    return null;
  }
}

function parseCppcheck(stderr: string): LintMetrics | null {
  const matches = [...stderr.matchAll(/<error\b[^>]*severity="([^"]+)"[^>]*>/g)];

  if (matches.length === 0) {
    return null;
  }

  let errors = 0;
  let warnings = 0;

  for (const match of matches) {
    if (match[1] === "error") {
      errors += 1;
    } else {
      warnings += 1;
    }
  }

  return { errors, warnings, tools: ["cppcheck"] };
}

function parseGitleaks(reportPath: string): number | null {
  try {
    const findings: unknown = JSON.parse(readFileSync(reportPath, "utf8"));

    return Array.isArray(findings) ? findings.length : null;
  } catch {
    return null;
  }
}

type MutableVulnerabilities = { critical: number; high: number; medium: number; low: number };

function emptyVulnerabilities(): MutableVulnerabilities {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function addVulnerability(
  counts: MutableVulnerabilities,
  severity: string | null | undefined,
): void {
  const normalized = (severity ?? "").toLowerCase();

  if (normalized.includes("critical")) {
    counts.critical += 1;
  } else if (normalized.includes("high")) {
    counts.high += 1;
  } else if (normalized.includes("low")) {
    counts.low += 1;
  } else {
    counts.medium += 1;
  }
}

function parseOsv(stdout: string): CodeQualityVulnerabilities | null {
  try {
    const report = JSON.parse(stdout) as {
      results?: {
        packages?: {
          vulnerabilities?: {
            database_specific?: { severity?: string };
            severity?: { type?: string }[];
          }[];
        }[];
      }[];
    };

    if (!Array.isArray(report.results)) {
      return null;
    }

    const vulnerabilities = emptyVulnerabilities();
    let found = false;

    for (const result of report.results) {
      for (const packageResult of result.packages ?? []) {
        for (const vulnerability of packageResult.vulnerabilities ?? []) {
          found = true;
          addVulnerability(
            vulnerabilities,
            vulnerability.database_specific?.severity ??
              vulnerability.severity?.find((entry) => entry.type)?.type,
          );
        }
      }
    }

    return found ? vulnerabilities : null;
  } catch {
    return null;
  }
}

async function fetchRepositorySizeKb(
  repo: string,
  token: string | undefined,
): Promise<number | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "zju-open-source-atlas-deep-audit",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { size?: number };

    return typeof data.size === "number" ? data.size : null;
  } catch {
    return null;
  }
}

async function downloadSparseRepository(
  repo: string,
  branch: string,
  directory: string,
): Promise<void> {
  runProcess(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      "--branch",
      branch,
      `https://github.com/${repo}.git`,
      directory,
    ],
    {
      stdio: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  runProcess("git", ["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], {
    cwd: directory,
    stdio: "ignore",
  });
  await rm(join(directory, ".git"), { recursive: true, force: true });
}

async function downloadRepository(
  repo: string,
  branch: string,
  directory: string,
  token: string | undefined,
): Promise<void> {
  const response = await fetch(
    `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(branch)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "zju-open-source-atlas-deep-audit",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(600_000),
    },
  );

  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`仓库归档超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB`);
  }

  const archivePath = join(directory, "source.tar.gz");

  await writeFile(archivePath, buffer);
  runProcess("tar", ["-xzf", archivePath, "-C", directory, "--strip-components=1"], {
    stdio: "ignore",
  });
  await rm(archivePath);
}

function recordToolVersion(
  toolVersions: Record<string, string>,
  command: string,
  versionArgs: readonly string[],
  cwd: string,
): void {
  const version = runTool(command, versionArgs, cwd);
  const value = version.stdout.trim();

  if (value) {
    toolVersions[command] = value;
  }
}

function collectComplexity(
  directory: string,
  tools: string[],
  toolVersions: Record<string, string>,
): LizardMetrics | null {
  const result = runTool("lizard", ["--csv", "--verbose", "."], directory);

  if (!result.available) {
    return null;
  }

  tools.push("lizard");
  recordToolVersion(toolVersions, "lizard", ["--version"], directory);

  return parseLizard(result.stdout);
}

async function collectDuplication(
  directory: string,
  tools: string[],
  toolVersions: Record<string, string>,
): Promise<{
  percentage: number | null;
  clones: number | null;
  lines: number | null;
} | null> {
  const outputDirectory = join(directory, ".jscpd-report");
  await mkdir(outputDirectory, { recursive: true });
  const result = runTool(
    "jscpd",
    [
      ".",
      "--reporters",
      "json",
      "--output",
      outputDirectory,
      "--silent",
      "--ignore",
      "**/node_modules/**,**/vendor/**,**/dist/**,**/build/**,**/*.min.*",
    ],
    directory,
  );

  if (!result.available) {
    return null;
  }

  tools.push("jscpd");
  recordToolVersion(toolVersions, "jscpd", ["--version"], directory);

  return parseJscpd(outputDirectory);
}

interface LinterDefinition {
  readonly command: string;
  readonly args: readonly string[];
  readonly versionArgs: readonly string[];
  readonly parse: (result: ToolResult) => LintMetrics | null;
}

function linterFor(language: string): LinterDefinition | null {
  if (language === "python") {
    return {
      command: "ruff",
      args: ["check", "--output-format", "json", "--no-cache", "."],
      versionArgs: ["--version"],
      parse: (result) => parseRuff(result.stdout),
    };
  }

  if (language === "javascript" || language === "typescript") {
    return {
      command: "oxlint",
      args: [".", "--format", "json"],
      versionArgs: ["--version"],
      parse: (result) => parseOxlint(result.stdout),
    };
  }

  if (language === "c" || language === "c++") {
    return {
      command: "cppcheck",
      args: [
        "--enable=warning,style,performance,portability",
        "--xml",
        "--xml-version=2",
        "--quiet",
        ".",
      ],
      versionArgs: ["--version"],
      parse: (result) => parseCppcheck(result.stderr),
    };
  }

  return null;
}

function collectLint(
  language: string,
  directory: string,
  tools: string[],
  toolVersions: Record<string, string>,
): LintMetrics | null {
  const linter = linterFor(language);

  if (!linter) {
    return null;
  }

  const result = runTool(linter.command, linter.args, directory);

  if (!result.available) {
    return null;
  }

  const lint = linter.parse(result);

  if (!lint) {
    return null;
  }

  tools.push(linter.command);
  recordToolVersion(toolVersions, linter.command, linter.versionArgs, directory);

  return lint;
}

function collectSecrets(
  directory: string,
  tools: string[],
  toolVersions: Record<string, string>,
): number | null {
  const reportPath = join(directory, ".gitleaks-report.json");
  const result = runTool(
    "gitleaks",
    ["dir", ".", "--report-format", "json", "--report-path", reportPath, "--no-banner"],
    directory,
  );

  if (!result.available) {
    return null;
  }

  const secrets = parseGitleaks(reportPath);

  if (secrets === null) {
    return null;
  }

  tools.push("gitleaks");
  recordToolVersion(toolVersions, "gitleaks", ["version"], directory);

  return secrets;
}

function collectVulnerabilities(
  directory: string,
  tools: string[],
  toolVersions: Record<string, string>,
): CodeQualityVulnerabilities | null {
  const result = runTool("osv-scanner", ["scan", "source", "-r", ".", "-f", "json"], directory);

  if (!result.available) {
    return null;
  }

  const vulnerabilities = parseOsv(result.stdout);

  if (vulnerabilities === null) {
    return null;
  }

  tools.push("osv-scanner");
  recordToolVersion(toolVersions, "osv-scanner", ["--version"], directory);

  return vulnerabilities;
}

function buildMetrics(
  lizard: LizardMetrics | null,
  duplication: { percentage: number | null; clones: number | null; lines: number | null } | null,
  lint: LintMetrics | null,
  secrets: number | null,
  vulnerabilities: CodeQualityVulnerabilities | null,
): CodeQualityMetrics {
  return {
    files: lizard?.files ?? duplication?.lines ?? 0,
    loc: lizard?.loc ?? duplication?.lines ?? 0,
    functions: lizard?.functions ?? 0,
    averageComplexity: lizard?.averageComplexity ?? null,
    maxComplexity: lizard?.maxComplexity ?? null,
    highComplexityFunctions: lizard?.highComplexityFunctions ?? null,
    duplicationPercentage: duplication?.percentage ?? null,
    duplicatedBlocks: duplication?.clones ?? null,
    lintErrors: lint?.errors ?? null,
    lintWarnings: lint?.warnings ?? null,
    secrets,
    vulnerabilities,
  };
}

function isComplete(
  lizard: LizardMetrics | null,
  duplication: object | null,
  lint: LintMetrics | null,
  secrets: number | null,
  vulnerabilities: CodeQualityVulnerabilities | null,
): boolean {
  return (
    lizard !== null &&
    duplication !== null &&
    lint !== null &&
    (secrets !== null || vulnerabilities !== null)
  );
}

async function analyzeRepository(
  entry: DeepAuditRepo,
  token: string | undefined,
): Promise<RepositoryCodeQuality> {
  const analyzedAt = new Date().toISOString();
  const base = {
    analyzedAt,
    commitAt: entry.commitAt,
    branch: entry.branch,
    language: entry.language,
  } as const;

  if (entry.archived) {
    return {
      ...base,
      status: "skipped",
      skippedReason: "仓库已归档",
      tools: [],
      toolVersions: {},
      metrics: null,
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "zju-quality-"));

  try {
    const sizeKb = await fetchRepositorySizeKb(entry.repo, token);

    if (sizeKb !== null && sizeKb > LARGE_REPO_KB) {
      await downloadSparseRepository(entry.repo, entry.branch, directory);
    } else {
      await downloadRepository(entry.repo, entry.branch, directory, token);
    }

    const tools: string[] = [];
    const toolVersions: Record<string, string> = {};
    const lizard = collectComplexity(directory, tools, toolVersions);
    const duplication = await collectDuplication(directory, tools, toolVersions);
    const lint = collectLint((entry.language ?? "").toLowerCase(), directory, tools, toolVersions);
    const secrets = collectSecrets(directory, tools, toolVersions);
    const vulnerabilities = collectVulnerabilities(directory, tools, toolVersions);

    if (!lizard && !duplication) {
      return {
        ...base,
        status: "skipped",
        skippedReason: "没有可分析源码或分析工具不可用",
        tools,
        toolVersions,
        metrics: null,
      };
    }

    return {
      ...base,
      status: isComplete(lizard, duplication, lint, secrets, vulnerabilities)
        ? "complete"
        : "partial",
      tools,
      toolVersions,
      metrics: buildMetrics(lizard, duplication, lint, secrets, vulnerabilities),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const chunksPath = resolve(process.cwd(), argument("--chunks", "deep-audit-chunks.json"));
const chunkIndex = Number(argument("--chunk"));
const outputPath = resolve(
  process.cwd(),
  argument("--output", `code-quality-chunk-${chunkIndex}.json`),
);
const chunks = JSON.parse(await readFile(chunksPath, "utf8")) as DeepAuditChunks;
const chunk = chunks.chunks.find((item) => item.index === chunkIndex);

if (!chunk) {
  throw new Error(`找不到审计分片 ${chunkIndex}`);
}

const activeChunk = chunk;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const repositories: Record<string, RepositoryCodeQuality> = {};
const writePartial = async () => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeCodeQualitySnapshot(outputPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "deep-audit",
    repositories,
  });
};

async function analyzeChunk(index = 0): Promise<void> {
  if (index >= activeChunk.repositories.length) {
    return;
  }

  const entry = activeChunk.repositories[index];

  if (!entry) {
    return;
  }

  console.info(
    `[${chunkIndex}/${chunks.chunks.length}] ${index + 1}/${activeChunk.repositories.length} ${entry.repo}`,
  );

  try {
    const quality = await analyzeRepository(entry, token);
    repositories[entry.repo.toLowerCase()] = quality;
    console.info(`  ${quality.status} · ${quality.tools.join(", ") || "no tools"}`);
  } catch (error) {
    repositories[entry.repo.toLowerCase()] = {
      analyzedAt: new Date().toISOString(),
      commitAt: entry.commitAt,
      branch: entry.branch,
      language: entry.language,
      status: "skipped",
      skippedReason: error instanceof Error ? error.message.slice(0, 180) : "未知错误",
      tools: [],
      toolVersions: {},
      metrics: null,
    };
    console.warn(`  skipped · ${error instanceof Error ? error.message : String(error)}`);
  }

  await writePartial();
  await analyzeChunk(index + 1);
}

await analyzeChunk();
await writePartial();
console.info(`写入 ${outputPath}（${Object.keys(repositories).length} 个仓库）`);
