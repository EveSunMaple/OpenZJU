import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

function toolAvailable(command: string): boolean {
  return spawnSync("which", [command], { encoding: "utf8" }).status === 0;
}

function runTool(command: string, args: readonly string[], cwd: string): ToolResult {
  if (!toolAvailable(command)) {
    return { stdout: "", stderr: "", status: null, available: false };
  }

  const result = spawnSync(command, args, {
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

function mergeLint(results: readonly (LintMetrics | null)[]): LintMetrics | null {
  const available = results.filter((result): result is LintMetrics => result !== null);

  if (available.length === 0) {
    return null;
  }

  return {
    errors: available.reduce((total, result) => total + result.errors, 0),
    warnings: available.reduce((total, result) => total + result.warnings, 0),
    tools: available.flatMap((result) => result.tools),
  };
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
  execFileSync(
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
  execFileSync("git", ["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], {
    cwd: directory,
    stdio: "ignore",
  });
  execFileSync("rm", ["-rf", join(directory, ".git")], { stdio: "ignore" });
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
  execFileSync("tar", ["-xzf", archivePath, "-C", directory, "--strip-components=1"], {
    stdio: "ignore",
  });
  await rm(archivePath);
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
    const lizardResult = runTool("lizard", ["--csv", "--verbose", "."], directory);
    const lizard = lizardResult.available ? parseLizard(lizardResult.stdout) : null;

    if (lizardResult.available) {
      tools.push("lizard");
      const version = runTool("lizard", ["--version"], directory);
      if (version.stdout.trim()) {
        toolVersions.lizard = version.stdout.trim();
      }
    }

    const jscpdOutput = join(directory, ".jscpd-report");
    await mkdir(jscpdOutput, { recursive: true });
    const jscpdResult = runTool(
      "jscpd",
      [
        ".",
        "--reporters",
        "json",
        "--output",
        jscpdOutput,
        "--silent",
        "--ignore",
        "**/node_modules/**,**/vendor/**,**/dist/**,**/build/**,**/*.min.*",
      ],
      directory,
    );
    const duplication = jscpdResult.available ? await parseJscpd(jscpdOutput) : null;

    if (jscpdResult.available) {
      tools.push("jscpd");
      const version = runTool("jscpd", ["--version"], directory);
      if (version.stdout.trim()) {
        toolVersions.jscpd = version.stdout.trim();
      }
    }

    const lintResults: (LintMetrics | null)[] = [];
    const language = (entry.language ?? "").toLowerCase();

    if (language === "python") {
      const result = runTool(
        "ruff",
        ["check", "--output-format", "json", "--no-cache", "."],
        directory,
      );
      if (result.available) {
        const lint = parseRuff(result.stdout);
        if (lint) {
          lintResults.push(lint);
          tools.push("ruff");
          const version = runTool("ruff", ["--version"], directory);
          if (version.stdout.trim()) {
            toolVersions.ruff = version.stdout.trim();
          }
        }
      }
    }

    if (language === "javascript" || language === "typescript") {
      const result = runTool("oxlint", [".", "--format", "json"], directory);
      if (result.available) {
        const lint = parseOxlint(result.stdout);
        if (lint) {
          lintResults.push(lint);
          tools.push("oxlint");
          const version = runTool("oxlint", ["--version"], directory);
          if (version.stdout.trim()) {
            toolVersions.oxlint = version.stdout.trim();
          }
        }
      }
    }

    if (language === "c" || language === "c++") {
      const result = runTool(
        "cppcheck",
        [
          "--enable=warning,style,performance,portability",
          "--xml",
          "--xml-version=2",
          "--quiet",
          ".",
        ],
        directory,
      );
      if (result.available) {
        const lint = parseCppcheck(result.stderr);
        if (lint) {
          lintResults.push(lint);
          tools.push("cppcheck");
          const version = runTool("cppcheck", ["--version"], directory);
          if (version.stdout.trim()) {
            toolVersions.cppcheck = version.stdout.trim();
          }
        }
      }
    }

    const lint = mergeLint(lintResults);

    const gitleaksReport = join(directory, ".gitleaks-report.json");
    let secrets: number | null = null;
    const gitleaks = runTool(
      "gitleaks",
      ["dir", ".", "--report-format", "json", "--report-path", gitleaksReport, "--no-banner"],
      directory,
    );

    if (gitleaks.available) {
      secrets = parseGitleaks(gitleaksReport);
      if (secrets !== null) {
        tools.push("gitleaks");
        const version = runTool("gitleaks", ["version"], directory);
        if (version.stdout.trim()) {
          toolVersions.gitleaks = version.stdout.trim();
        }
      }
    }

    const osv = runTool("osv-scanner", ["scan", "source", "-r", ".", "-f", "json"], directory);
    const vulnerabilities = osv.available ? parseOsv(osv.stdout) : null;

    if (osv.available && vulnerabilities !== null) {
      tools.push("osv-scanner");
      const version = runTool("osv-scanner", ["--version"], directory);
      if (version.stdout.trim()) {
        toolVersions["osv-scanner"] = version.stdout.trim();
      }
    }

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

    const metrics: CodeQualityMetrics = {
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
    const complete =
      lizard !== null &&
      duplication !== null &&
      lint !== null &&
      (secrets !== null || vulnerabilities !== null);

    return {
      ...base,
      status: complete ? "complete" : "partial",
      tools,
      toolVersions,
      metrics,
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

for (const [index, entry] of chunk.repositories.entries()) {
  console.info(
    `[${chunkIndex}/${chunks.chunks.length}] ${index + 1}/${chunk.repositories.length} ${entry.repo}`,
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
}

await writePartial();
console.info(`写入 ${outputPath}（${Object.keys(repositories).length} 个仓库）`);
