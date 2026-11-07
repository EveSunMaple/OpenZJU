import { buildCatalog, type ProjectCatalog, summarizeProjects } from "@/application/catalog";
import { projects } from "@/data/projects";
import { parseAuditSnapshot } from "@/domain/project/repository-audit";
import { parseSnapshot } from "@/domain/project/snapshot";
import repositoryAudits from "@/generated/repository-audits.json";
import repositoryStats from "@/generated/repository-stats.json";

const snapshot = parseSnapshot(repositoryStats);
const auditSnapshot = parseAuditSnapshot(repositoryAudits);
const catalog = buildCatalog(projects, snapshot, new Date(), auditSnapshot);

export function getCatalog(): ProjectCatalog {
  return catalog;
}

export function getCategoryCatalog(categoryId: string) {
  const categoryProjects = catalog.projects.filter((project) => project.category === categoryId);

  return {
    projects: categoryProjects,
    counts: summarizeProjects(categoryProjects),
  };
}
