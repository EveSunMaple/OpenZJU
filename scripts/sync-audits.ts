import { resolve } from "node:path";
import { projects } from "../src/data/projects";
import { syncRepositoryAudits } from "../src/infrastructure/audit/sync-repository-audits";
import { readCodeQualitySnapshot } from "../src/infrastructure/code-quality/code-quality-store";
import { readSnapshot } from "../src/infrastructure/github/stats-store";

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const STATS_CACHE_PATH = resolve(process.cwd(), "src/generated/repository-stats.json");
const AUDIT_CACHE_PATH = resolve(process.cwd(), "src/generated/repository-audits.json");
const CODE_QUALITY_CACHE_PATH = resolve(
  process.cwd(),
  "src/generated/repository-code-quality.json",
);
const OFFLINE =
  process.argv.includes("--offline") ||
  process.env.SKIP_GITHUB_SYNC === "1" ||
  process.env.SKIP_GITHUB_SYNC === "true";

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const statsSnapshot = await readSnapshot(STATS_CACHE_PATH);
  const codeQualitySnapshot = await readCodeQualitySnapshot(CODE_QUALITY_CACHE_PATH);

  console.info(`GitHub 项目审计${OFFLINE ? "（离线模式）" : ""}`);

  if (!token && !OFFLINE) {
    console.info("提示：审计需要 GITHUB_TOKEN 读取社区健康度与文件树。");
  }

  const { summary } = await syncRepositoryAudits({
    projects,
    statsSnapshot,
    codeQualitySnapshot,
    cachePath: AUDIT_CACHE_PATH,
    token,
    offline: OFFLINE,
  });

  console.info("");
  console.info(`审计数量：${summary.fetched + summary.cached} / ${summary.total}`);
  console.info(
    `已审计：${summary.fetched} · 缓存回退：${summary.cached} · 跳过：${summary.skipped}`,
  );
  console.info(
    `请求失败：${summary.fetchErrors} 次 · 数据源：${summary.source} · 审计时间：${summary.generatedAt || "尚未审计"}`,
  );
  console.info(`深度代码质量缓存：${Object.keys(codeQualitySnapshot.repositories).length} 个仓库`);
}

main().catch((error: unknown) => {
  console.error("项目审计同步失败，构建将继续使用已有审计缓存。");
  console.error(error);
});
