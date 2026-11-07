import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { projects } from "../../src/data/projects";
import type { Project } from "../../src/domain/project/project";
import {
  type CodeQualitySnapshot,
  parseCodeQualitySnapshot,
} from "../../src/domain/project/repository-code-quality";
import {
  readCodeQualitySnapshot,
  writeCodeQualitySnapshot,
} from "../../src/infrastructure/code-quality/code-quality-store";

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;

  if (!value && !fallback) {
    throw new Error(`缺少参数 ${name}`);
  }

  return value ?? fallback ?? "";
}

const inputDirectory = resolve(process.cwd(), argument("--inputs", "code-quality-chunks"));
const outputPath = resolve(
  process.cwd(),
  argument("--output", "src/generated/repository-code-quality.json"),
);
const cachePath = resolve(process.cwd(), "src/generated/repository-code-quality.json");
const files = (await readdir(inputDirectory))
  .filter((file) => file.endsWith(".json"))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  throw new Error(`没有找到深审计结果：${inputDirectory}`);
}

const allProjects: readonly Project[] = projects;
const currentRepos = new Set(
  allProjects.flatMap((project) => (project.repo ? [project.repo.toLowerCase()] : [])),
);
const previous = await readCodeQualitySnapshot(cachePath);
const repositories: Record<string, CodeQualitySnapshot["repositories"][string]> = {};
let fileCount = 0;

for (const file of files) {
  const snapshot = parseCodeQualitySnapshot(
    JSON.parse(await readFile(resolve(inputDirectory, file), "utf8")),
  );

  for (const [repo, quality] of Object.entries(snapshot.repositories)) {
    if (currentRepos.has(repo.toLowerCase())) {
      repositories[repo.toLowerCase()] = quality;
      fileCount += 1;
    }
  }
}

for (const [repo, quality] of Object.entries(previous.repositories)) {
  if (currentRepos.has(repo.toLowerCase()) && !repositories[repo.toLowerCase()]) {
    repositories[repo.toLowerCase()] = quality;
  }
}

if (Object.keys(repositories).length === 0) {
  throw new Error("合并后没有有效的代码质量结果。");
}

const missing = [...currentRepos].filter((repo) => !repositories[repo]);
const snapshot = {
  schemaVersion: 1 as const,
  generatedAt: new Date().toISOString(),
  source: "deep-audit" as const,
  repositories,
};

await writeCodeQualitySnapshot(outputPath, snapshot);
console.info(
  `合并 ${fileCount} 条结果，写入 ${Object.keys(repositories).length} 个仓库：${outputPath}`,
);
if (missing.length > 0) {
  console.warn(`仍有 ${missing.length} 个仓库没有结果：${missing.join(", ")}`);
}
