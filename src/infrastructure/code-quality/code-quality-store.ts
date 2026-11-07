import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type CodeQualitySnapshot,
  EMPTY_CODE_QUALITY_SNAPSHOT,
  parseCodeQualitySnapshot,
} from "@/domain/project/repository-code-quality";

export { EMPTY_CODE_QUALITY_SNAPSHOT, parseCodeQualitySnapshot };

export async function readCodeQualitySnapshot(filePath: string): Promise<CodeQualitySnapshot> {
  try {
    return parseCodeQualitySnapshot(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return EMPTY_CODE_QUALITY_SNAPSHOT;
  }
}

export function serializeCodeQualitySnapshot(snapshot: CodeQualitySnapshot): string {
  const repositories = Object.fromEntries(
    Object.entries(snapshot.repositories).sort(([a], [b]) => a.localeCompare(b)),
  );

  return `${JSON.stringify({ ...snapshot, repositories }, null, 2)}\n`;
}

export async function writeCodeQualitySnapshot(
  filePath: string,
  snapshot: CodeQualitySnapshot,
): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, serializeCodeQualitySnapshot(snapshot), "utf8");
  await rename(temporaryPath, filePath);
}
