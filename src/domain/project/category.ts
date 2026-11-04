export const CATEGORY_IDS = ["life", "study", "research", "work"] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface Category {
  readonly id: CategoryId;
  readonly index: string;
  readonly label: string;
  readonly labelEn: string;
  readonly description: string;
  readonly icon: string;
}

export const CATEGORIES = [
  {
    id: "life",
    index: "01",
    label: "生活",
    labelEn: "Life",
    description: "校园网络、社区、日常服务与让生活更顺手的工具。",
    icon: "lucide:coffee",
  },
  {
    id: "study",
    index: "02",
    label: "学习",
    labelEn: "Study",
    description: "课程资料、学习工具、论文模板与知识库。",
    icon: "lucide:book-open",
  },
  {
    id: "research",
    index: "03",
    label: "科研",
    labelEn: "Research",
    description: "机器人、三维视觉、自动驾驶与论文开源实现。",
    icon: "lucide:flask-conical",
  },
  {
    id: "work",
    index: "04",
    label: "工作",
    labelEn: "Work",
    description: "开发效率、工程工具、资源导航与职业发展。",
    icon: "lucide:briefcase-business",
  },
] as const satisfies readonly Category[];

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}

export function getCategory(id: CategoryId): Category {
  const category = CATEGORIES.find((item) => item.id === id);

  if (!category) {
    throw new Error(`Unknown project category: ${id}`);
  }

  return category;
}
