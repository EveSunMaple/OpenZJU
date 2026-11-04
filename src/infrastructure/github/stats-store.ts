import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RepositoryStatsSnapshot } from "@/domain/project/repository-stats";
import { EMPTY_SNAPSHOT, parseSnapshot } from "@/domain/project/snapshot";

export { EMPTY_SNAPSHOT, parseSnapshot };

export async function readSnapshot(filePath: string): Promise<RepositoryStatsSnapshot> {
  try {
    return parseSnapshot(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function serializeSnapshot(snapshot: RepositoryStatsSnapshot): string {
  const repositories = Object.fromEntries(
    Object.entries(snapshot.repositories).sort(([a], [b]) => a.localeCompare(b)),
  );

  return `${JSON.stringify({ ...snapshot, repositories }, null, 2)}\n`;
}

export async function writeSnapshot(
  filePath: string,
  snapshot: RepositoryStatsSnapshot,
): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, serializeSnapshot(snapshot), "utf8");
  await rename(temporaryPath, filePath);
}
