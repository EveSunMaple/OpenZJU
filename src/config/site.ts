const repositoryUrl = (
  import.meta.env.PUBLIC_REPOSITORY_URL || "https://github.com/EveSunMaple/OpenZJU"
).replace(/\/+$/, "");

export const siteConfig = {
  name: "OpenZJU",
  nameEn: "OpenZJU",
  title: "OpenZJU · 浙江大学开源项目图鉴",
  description:
    "浙江大学师生与校友的开源项目索引：按生活、学习、科研、工作归类，标注每个项目最近一次提交与维护状态，支持全文检索与筛选。",
  locale: "zh-CN",
  author: "EveSunMaple",
  authorUrl: "https://github.com/EveSunMaple",
  repositoryUrl,
  newProjectIssueUrl: `${repositoryUrl}/issues/new?template=project-suggestion.yml`,
  keywords: ["浙江大学", "ZJU", "开源", "开源项目", "项目导航", "课程资料", "科研开源"],
} as const;
