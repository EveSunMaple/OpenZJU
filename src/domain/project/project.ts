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

function pushIssue(issues: ProjectValidationIssue[], slug: string, message: string): void {
  issues.push({ slug, message });
}

function validateSlug(
  project: Project,
  slugs: Set<string>,
  issues: ProjectValidationIssue[],
): void {
  if (!SLUG_PATTERN.test(project.slug)) {
    pushIssue(issues, project.slug, "slug 必须为小写 kebab-case");
  }

  if (slugs.has(project.slug)) {
    pushIssue(issues, project.slug, "slug 重复");
  }

  slugs.add(project.slug);
}

function validateBasics(project: Project, issues: ProjectValidationIssue[]): void {
  if (project.name.trim().length < 2) {
    pushIssue(issues, project.slug, "name 至少需要 2 个字符");
  }

  if (project.description.trim().length < 16) {
    pushIssue(issues, project.slug, "description 至少需要 16 个字符");
  }

  if (project.tags.length === 0) {
    pushIssue(issues, project.slug, "至少需要一个标签");
  }

  if (new Set(project.tags).size !== project.tags.length) {
    pushIssue(issues, project.slug, "标签不能重复");
  }
}

function validateRepo(
  project: Project,
  repos: Set<string>,
  issues: ProjectValidationIssue[],
): void {
  if (!project.repo) {
    if (!project.links?.website && !project.links?.download) {
      pushIssue(issues, project.slug, "至少需要 repo 或一个外部链接");
    }

    return;
  }

  if (!REPO_PATTERN.test(project.repo)) {
    pushIssue(issues, project.slug, "repo 必须为 owner/name");
  }

  if (repos.has(project.repo.toLowerCase())) {
    pushIssue(issues, project.slug, "repo 重复");
  }

  repos.add(project.repo.toLowerCase());
}

function validateLinks(project: Project, issues: ProjectValidationIssue[]): void {
  for (const [key, value] of Object.entries(project.links ?? {})) {
    if (value && !isValidUrl(value)) {
      pushIssue(issues, project.slug, `links.${key} 不是合法 URL`);
    }
  }
}

export function validateProjects(projects: readonly Project[]): ProjectValidationIssue[] {
  const issues: ProjectValidationIssue[] = [];
  const slugs = new Set<string>();
  const repos = new Set<string>();

  for (const project of projects) {
    validateSlug(project, slugs, issues);
    validateBasics(project, issues);
    validateRepo(project, repos, issues);
    validateLinks(project, issues);
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
