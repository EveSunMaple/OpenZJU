import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { projects } from "../../src/data/projects";
import type { Project } from "../../src/domain/project/project";
import { readSnapshot } from "../../src/infrastructure/github/stats-store";

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

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);

  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const outputPath = resolve(process.cwd(), argument("--output", "deep-audit-chunks.json"));
const chunkSize = Math.max(1, Number(process.env.DEEP_AUDIT_CHUNK_SIZE) || 20);
const statsPath = resolve(process.cwd(), "src/generated/repository-stats.json");
const statsSnapshot = await readSnapshot(statsPath);
const statsByRepo = new Map(
  Object.entries(statsSnapshot.repositories).map(([repo, stats]) => [repo.toLowerCase(), stats]),
);
const allProjects: readonly Project[] = projects;
const repos = [
  ...new Set(allProjects.flatMap((project) => (project.repo ? [project.repo] : []))),
].sort((a, b) => a.localeCompare(b));

const entries: DeepAuditRepo[] = repos.map((repo) => {
  const stats = statsByRepo.get(repo.toLowerCase());

  return {
    repo,
    branch: stats?.defaultBranch || "main",
    language: stats?.language ?? null,
    commitAt: stats?.lastCommitAt ?? null,
    archived: stats?.archived ?? false,
  };
});

if (entries.length === 0) {
  throw new Error("没有可审计的 GitHub 仓库。");
}

const chunks = Array.from({ length: Math.ceil(entries.length / chunkSize) }, (_, index) => ({
  index: index + 1,
  repositories: entries.slice(index * chunkSize, (index + 1) * chunkSize),
}));
const payload: DeepAuditChunks = {
  generatedAt: new Date().toISOString(),
  chunks,
};

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.info(`已生成 ${chunks.length} 个审计分片，共 ${entries.length} 个仓库：${outputPath}`);
console.info(
  JSON.stringify({
    include: chunks.map((chunk) => ({ chunk: chunk.index })),
  }),
);
