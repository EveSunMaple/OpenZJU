import { buildCatalog, type ProjectCatalog, summarizeProjects } from "@/application/catalog";
import { projects } from "@/data/projects";
import { parseSnapshot } from "@/domain/project/snapshot";
import repositoryStats from "@/generated/repository-stats.json";

const snapshot = parseSnapshot(repositoryStats);
const catalog = buildCatalog(projects, snapshot);

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
