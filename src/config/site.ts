export const siteConfig = {
  name: "OpenZJU",
  nameEn: "OpenZJU",
  title: "OpenZJU · 浙江大学开源项目图鉴",
  description:
    "汇集浙江大学师生与校友的开源项目。做新项目之前，先看看有没有人已经做过；使用项目之前，先看看它是否仍在维护。",
  locale: "zh-CN",
  author: "ZJU Open Source Community",
  repositoryUrl: import.meta.env.PUBLIC_REPOSITORY_URL ?? "",
  keywords: ["浙江大学", "ZJU", "开源", "开源项目", "项目导航", "课程资料", "科研开源"],
} as const;
