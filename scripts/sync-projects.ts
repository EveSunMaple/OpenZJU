import { resolve } from "node:path";
import { projects } from "../src/data/projects";
import {
  type SyncSummary,
  syncRepositoryStats,
} from "../src/infrastructure/github/sync-repository-stats";

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const CACHE_PATH = resolve(process.cwd(), "src/generated/repository-stats.json");
const OFFLINE_FLAG = process.argv.includes("--offline");
const OFFLINE =
  OFFLINE_FLAG || process.env.SKIP_GITHUB_SYNC === "1" || process.env.SKIP_GITHUB_SYNC === "true";

function formatSource(source: SyncSummary["source"]): string {
  switch (source) {
    case "github-graphql":
      return "GitHub GraphQL";
    case "github-rest":
      return "GitHub REST / Atom";
    case "mixed":
      return "GitHub + 本地缓存";
    default:
      return "本地缓存";
  }
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  console.info(`GitHub 数据同步${OFFLINE ? "（离线模式）" : ""}`);

  if (!token && !OFFLINE) {
    console.info("提示：设置 GITHUB_TOKEN 可获得更完整的提交频率数据，并避免匿名速率限制。");
  }

  const { summary } = await syncRepositoryStats({
    projects,
    cachePath: CACHE_PATH,
    offline: OFFLINE,
    token,
  });

  console.info("");
  console.info(`数据源：${formatSource(summary.source)}`);
  console.info(`项目数量：${summary.total}`);
  console.info(
    `已更新：${summary.fetched} · 缓存回退：${summary.cached} · 缺失：${summary.missing}`,
  );
  console.info(
    `请求失败：${summary.fetchErrors} 次（其中限流：${summary.rateLimitErrors} 次；失败仓库会尝试回退缓存）`,
  );
  console.info(`同步时间：${summary.generatedAt || "尚未同步"}`);
}

try {
  await main();
} catch (error) {
  console.error("GitHub 数据同步失败，构建将继续使用已有缓存。");
  console.error(error);
}
