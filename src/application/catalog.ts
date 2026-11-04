import { type Category, type CategoryId, getCategory } from "@/domain/project/category";
import {
  assertValidProjects,
  type Project,
  type ProjectLinks,
  repositoryUrl,
} from "@/domain/project/project";
import {
  assessMaintenance,
  latestActivityAt,
  MAINTENANCE_STATUSES,
  type MaintenanceAssessment,
  type MaintenanceStatus,
  type RepositoryStats,
  type RepositoryStatsSnapshot,
} from "@/domain/project/repository-stats";

export type SortMode = "recent" | "stars" | "name";

export interface ProjectView extends Project {
  readonly categoryInfo: Category;
  readonly links: ProjectLinks;
  readonly repoUrl: string | null;
  readonly primaryUrl: string;
  readonly stats: RepositoryStats | undefined;
  readonly maintenance: MaintenanceAssessment;
  readonly updatedAt: string | null;
  readonly searchText: string;
}

export interface CatalogCounts {
  readonly total: number;
  readonly maintained: number;
  readonly totalStars: number;
  readonly byCategory: Readonly<Record<CategoryId, number>>;
  readonly byStatus: Readonly<Record<MaintenanceStatus, number>>;
}

export interface ProjectCatalog {
  readonly projects: readonly ProjectView[];
  readonly counts: CatalogCounts;
  readonly syncedAt: string | null;
  readonly source: RepositoryStatsSnapshot["source"] | null;
}

function buildSearchText(project: Project, category: Category, stats: RepositoryStats | undefined) {
  return [
    project.name,
    project.description,
    project.repo ?? "",
    category.label,
    category.labelEn,
    ...project.tags,
    stats?.description ?? "",
    stats?.language ?? "",
    stats?.license ?? "",
    ...(stats?.topics ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

export function sortProjectViews(
  projects: readonly ProjectView[],
  mode: SortMode = "recent",
): ProjectView[] {
  const sorted = [...projects];
  const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

  sorted.sort((a, b) => {
    if (a.maintenance.status === "archived" && b.maintenance.status !== "archived") {
      return 1;
    }

    if (a.maintenance.status !== "archived" && b.maintenance.status === "archived") {
      return -1;
    }

    if (mode === "name") {
      return collator.compare(a.name, b.name) || collator.compare(a.repo ?? "", b.repo ?? "");
    }

    if (mode === "stars") {
      return (b.stats?.stars ?? -1) - (a.stats?.stars ?? -1) || collator.compare(a.name, b.name);
    }

    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;

    return (
      bTime - aTime ||
      (b.stats?.stars ?? -1) - (a.stats?.stars ?? -1) ||
      collator.compare(a.name, b.name)
    );
  });

  return sorted;
}

export function summarizeProjects(projects: readonly ProjectView[]): CatalogCounts {
  const byCategory: Record<CategoryId, number> = {
    life: 0,
    study: 0,
    research: 0,
    work: 0,
  };

  const byStatus = Object.fromEntries(MAINTENANCE_STATUSES.map((status) => [status, 0])) as Record<
    MaintenanceStatus,
    number
  >;

  let totalStars = 0;

  for (const project of projects) {
    byCategory[project.category] += 1;
    byStatus[project.maintenance.status] += 1;
    totalStars += project.stats?.stars ?? 0;
  }

  return {
    total: projects.length,
    maintained: byStatus.active + byStatus.maintained,
    totalStars,
    byCategory,
    byStatus,
  };
}

export function buildCatalog(
  projects: readonly Project[],
  snapshot: RepositoryStatsSnapshot,
  now: Date = new Date(),
): ProjectCatalog {
  assertValidProjects(projects);

  const statsByRepo = new Map(
    Object.entries(snapshot.repositories).map(([repo, stats]) => [repo.toLowerCase(), stats]),
  );

  const views = projects.map((project): ProjectView => {
    const categoryInfo = getCategory(project.category);
    const stats = project.repo ? statsByRepo.get(project.repo.toLowerCase()) : undefined;
    const maintenance = assessMaintenance(stats, now);
    const repoUrl = project.repo ? repositoryUrl(project.repo) : null;
    const links = project.links ?? {};
    const primaryUrl = links.website ?? links.download ?? repoUrl ?? "";

    return {
      ...project,
      categoryInfo,
      links,
      repoUrl,
      primaryUrl,
      stats,
      maintenance,
      updatedAt: latestActivityAt(stats),
      searchText: buildSearchText(project, categoryInfo, stats),
    };
  });

  return {
    projects: sortProjectViews(views, "recent"),
    counts: summarizeProjects(views),
    syncedAt: snapshot.generatedAt || null,
    source: snapshot.source || null,
  };
}
