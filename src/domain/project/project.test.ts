import { describe, expect, it } from "vitest";
import { type Project, validateProjects } from "./project";

const validProject: Project = {
  slug: "example-project",
  name: "Example Project",
  description: "一个用于测试的浙江大学开源项目。",
  repo: "owner/repo",
  category: "study",
  tags: ["课程", "工具"],
  links: {
    website: "https://example.com",
    download: "https://example.com/download",
  },
};

describe("validateProjects", () => {
  it("accepts a valid project", () => {
    expect(validateProjects([validProject])).toEqual([]);
  });

  it("rejects duplicate slugs and repositories", () => {
    const issues = validateProjects([
      validProject,
      { ...validProject, slug: "example-project", repo: "OWNER/REPO" },
    ]);

    expect(issues.some((issue) => issue.message === "slug 重复")).toBe(true);
    expect(issues.some((issue) => issue.message === "repo 重复")).toBe(true);
  });

  it("accepts an external-only project with a website link", () => {
    const issues = validateProjects([
      { ...validProject, repo: undefined, links: { website: "https://example.com" } },
    ]);

    expect(issues).toEqual([]);
  });

  it("rejects an external-only project without any link", () => {
    const issues = validateProjects([{ ...validProject, repo: undefined, links: {} }]);

    expect(issues.some((issue) => issue.message.includes("外部链接"))).toBe(true);
  });

  it("rejects invalid identifiers, descriptions, tags and URLs", () => {
    const issues = validateProjects([
      {
        ...validProject,
        slug: "Bad Slug",
        description: "太短",
        tags: [],
        links: { website: "javascript:alert(1)" },
      },
    ]);

    expect(issues.some((issue) => issue.message.includes("slug"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("description"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("标签"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("links.website"))).toBe(true);
  });
});
