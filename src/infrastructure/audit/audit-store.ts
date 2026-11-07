import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RepositoryAuditSnapshot } from "@/domain/project/repository-audit";
import { EMPTY_AUDIT_SNAPSHOT, parseAuditSnapshot } from "@/domain/project/repository-audit";

export { EMPTY_AUDIT_SNAPSHOT, parseAuditSnapshot };

export async function readAuditSnapshot(filePath: string): Promise<RepositoryAuditSnapshot> {
  try {
    return parseAuditSnapshot(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return EMPTY_AUDIT_SNAPSHOT;
  }
}

export function serializeAuditSnapshot(snapshot: RepositoryAuditSnapshot): string {
  const audits = Object.fromEntries(
    Object.entries(snapshot.audits).sort(([a], [b]) => a.localeCompare(b)),
  );

  return `${JSON.stringify({ ...snapshot, audits }, null, 2)}\n`;
}

export async function writeAuditSnapshot(
  filePath: string,
  snapshot: RepositoryAuditSnapshot,
): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, serializeAuditSnapshot(snapshot), "utf8");
  await rename(temporaryPath, filePath);
}
