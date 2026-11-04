import type { CategoryId } from "./category";

export interface ProjectLinks {
  readonly website?: string;
  readonly download?: string;
}

export interface Project {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly repo?: string;
  readonly category: CategoryId;
  readonly tags: readonly string[];
  readonly links?: ProjectLinks;
  readonly featured?: boolean;
}

export interface ProjectValidationIssue {
  readonly slug: string;
  readonly message: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function repositoryUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

export function validateProjects(projects: readonly Project[]): ProjectValidationIssue[] {
  const issues: ProjectValidationIssue[] = [];
  const slugs = new Set<string>();
  const repos = new Set<string>();

  for (const project of projects) {
    if (!SLUG_PATTERN.test(project.slug)) {
      issues.push({ slug: project.slug, message: "slug 必须为小写 kebab-case" });
    }

    if (slugs.has(project.slug)) {
      issues.push({ slug: project.slug, message: "slug 重复" });
    }
    slugs.add(project.slug);

    if (project.name.trim().length < 2) {
      issues.push({ slug: project.slug, message: "name 至少需要 2 个字符" });
    }

    if (project.description.trim().length < 16) {
      issues.push({ slug: project.slug, message: "description 至少需要 16 个字符" });
    }

    if (project.repo) {
      if (!REPO_PATTERN.test(project.repo)) {
        issues.push({ slug: project.slug, message: "repo 必须为 owner/name" });
      }

      if (repos.has(project.repo.toLowerCase())) {
        issues.push({ slug: project.slug, message: "repo 重复" });
      }
      repos.add(project.repo.toLowerCase());
    } else if (!project.links?.website && !project.links?.download) {
      issues.push({ slug: project.slug, message: "至少需要 repo 或一个外部链接" });
    }

    if (project.tags.length === 0) {
      issues.push({ slug: project.slug, message: "至少需要一个标签" });
    }

    if (new Set(project.tags).size !== project.tags.length) {
      issues.push({ slug: project.slug, message: "标签不能重复" });
    }

    for (const [key, value] of Object.entries(project.links ?? {})) {
      if (value && !isValidUrl(value)) {
        issues.push({ slug: project.slug, message: `links.${key} 不是合法 URL` });
      }
    }
  }

  return issues;
}

export function assertValidProjects(projects: readonly Project[]): void {
  const issues = validateProjects(projects);

  if (issues.length > 0) {
    const details = issues.map((issue) => `- ${issue.slug}: ${issue.message}`).join("\n");

    throw new Error(`项目数据校验失败：\n${details}`);
  }
}
