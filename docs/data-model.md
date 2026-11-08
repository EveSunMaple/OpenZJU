# 数据模型

## 数据源

项目基础信息只有一个来源：

```text
src/data/projects.ts
```

仓库活动信息由构建脚本从 GitHub 获取，写入：

```text
src/generated/repository-stats.json
```

项目审计由 `pnpm sync:audits` 单独获取，写入：

```text
src/generated/repository-audits.json
```

审计依赖仓库状态、社区健康度、根目录文件与 OpenSSF Scorecard。评分结构、AI 风险启发式与局限见 [项目审计](./audit.md)。

深度代码质量由每日工作流写入：

```text
src/generated/repository-code-quality.json
```

它包含复杂度、重复率、lint、密钥、依赖漏洞和工具版本；不入库源码或密钥内容。字段、评分与工作流见 [深度代码质量](./code-quality.md)。

页面不会在运行时请求 GitHub，也不会从第三方接口读取项目信息。

## Project

```ts
interface Project {
  slug: string;
  name: string;
  description: string;
  repo?: string;
  category: "life" | "study" | "research" | "work";
  tags: string[];
  links?: {
    website?: string;
    download?: string;
  };
  featured?: boolean;
}
```

| 字段             | 必填 | 规则                                         |
| ---------------- | ---- | -------------------------------------------- |
| `slug`           | 是   | 小写 kebab-case，全站唯一                    |
| `name`           | 是   | 至少 2 个字符                                |
| `description`    | 是   | 中文简介，至少 16 个字符                     |
| `repo`           | 否   | `owner/name`；提供时全站唯一（大小写不敏感） |
| `category`       | 是   | 必须是四个分类之一                           |
| `tags`           | 是   | 至少一个，不能重复                           |
| `links.website`  | 否   | 必须是 `http` 或 `https` URL                 |
| `links.download` | 否   | 必须是 `http` 或 `https` URL                 |
| `featured`       | 否   | 显示编辑推荐图标                             |

校验入口：

```ts
validateProjects(projects); // 返回问题列表
assertValidProjects(projects); // 有错误时抛异常
```

构建时 `buildCatalog` 会调用 `assertValidProjects`。新增数据后建议运行：

```bash
pnpm check
```

## 分类

分类定义在 `src/domain/project/category.ts`：

| id         | 中文 | English  | 索引 |
| ---------- | ---- | -------- | ---- |
| `life`     | 生活 | Life     | 01   |
| `study`    | 学习 | Study    | 02   |
| `research` | 科研 | Research | 03   |
| `work`     | 工作 | Work     | 04   |

分类同时携带图标名与描述。新增分类需要同步更新 `CATEGORY_IDS`、`CATEGORIES` 和 CSS 中的 `--cat-*` 颜色变量。分类页面由 `src/pages/categories/[category].astro` 自动生成。

## RepositoryStats

```ts
interface RepositoryStats {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  archived: boolean;
  defaultBranch: string | null;
  lastCommitAt: string | null;
  pushedAt: string | null;
  commitsLast90Days: number | null;
  commitsLast90DaysCapped: boolean;
  commitsLastYear: number | null;
  homepageUrl: string | null;
  topics: string[];
  fetchedAt: string;
}
```

| 字段                      | 展示     | 说明                 |
| ------------------------- | -------- | -------------------- |
| `stars`                   | 卡片信号 | 累计 Stars           |
| `language`                | 卡片信号 | GitHub 主语言        |
| `lastCommitAt`            | 卡片顶部 | 默认分支最近提交时间 |
| `pushedAt`                | 回退     | 没有提交日期时使用   |
| `commitsLast90Days`       | 卡片信号 | 最近 90 天提交数量   |
| `commitsLast90DaysCapped` | 卡片信号 | `true` 时显示 `N+`   |
| `archived`                | 维护状态 | 归档优先于更新时间   |
| `license`                 | 搜索文本 | 可被搜索             |
| `topics`                  | 搜索文本 | 可被搜索             |

`commitsLastYear` 只在 GraphQL 路径中提供；REST/Atom 路径可能为 `null`。页面目前只展示最近 90 天提交数。

## 维护状态算法

实现位置：`assessMaintenance(stats, now)`。

```text
if 没有 stats            -> unknown
if archived              -> archived
if 没有活动时间          -> unknown
else if days <= 90       -> active
else if days <= 365      -> maintained
else if days <= 730      -> low
else                     -> dormant
```

- 活动时间优先取 `lastCommitAt`，回退到 `pushedAt`。
- 状态在构建时计算，构建时间即为判定基准。
- 已归档仓库无论多新都标记为 `archived`。
- 首页的「仍在维护」统计为 `active + maintained`。

阈值定义在 `MAINTENANCE_META`，修改后需要同步更新文案与测试。

## 快照

```ts
interface RepositoryStatsSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  source: "github-graphql" | "github-rest" | "mixed" | "cache";
  repositories: Record<string, RepositoryStats>;
}
```

- 键是仓库全名的小写形式，例如 `zju-cc98/forum`。
- `generatedAt` 是最近一次成功获取新数据的时间。
- 全部使用缓存时为 `cache`；部分新数据 + 部分缓存，或 GraphQL + REST 混合时为 `mixed`。
- 页面页脚会展示数据源、同步时间与作者。

快照解析器 `parseSnapshot` 做最小结构校验；损坏的条目会被丢弃，缺失字段会回退到空快照。

## GitHub 同步策略

入口：

```bash
pnpm sync:projects
pnpm sync:projects:offline
```

实现：

- `GitHubClient` 封装 GraphQL、REST 与 Atom。
- `syncRepositoryStats` 负责编排、降级、合并缓存与统计。
- `stats-store` 负责读取、序列化和原子写入。

### 路径一：GraphQL（推荐）

条件：配置了 `GITHUB_TOKEN` 或 `GH_TOKEN`。

- 每 10 个仓库一批。
- 一次查询获取 Stars、Forks、Open Issues、主语言、License、归档状态、默认分支、最近提交日期、最近 90 天与一年提交数、Topics。
- 查询失败时继续尝试 REST。

### 路径二：REST + commits

条件：GraphQL 不可用，或没有 token。

- `GET /repos/{owner}/{repo}` 获取元数据。
- `GET /repos/{owner}/{repo}/commits?since=90天前&per_page=100` 获取最近提交。
- 提交数达到 100 时设置 `commitsLast90DaysCapped = true`。
- 未认证请求受 GitHub 速率限制（约 60 次/小时）。脚本在剩余额度不足时跳过提交请求。

### 路径三：Atom

条件：REST 提交接口不可用或返回空。

- 请求 `https://github.com/{owner}/{repo}/commits/{branch}.atom`。
- 解析最近 20 条提交日期。
- 最近 90 天提交数上限为 20，超过时标记为 capped。
- 这是非官方接口，只作为降级路径。

### 路径四：缓存

任何仓库获取失败时，使用 `src/generated/repository-stats.json` 中该仓库的旧数据。没有旧数据时，该仓库在页面上显示为「未知」。

### 写入

- 先写临时文件，再原子重命名。
- 写入前按仓库名排序，方便 git diff。
- 缓存文件已提交到仓库，是离线构建与 CI 的兜底。

### 同步统计口径

`SyncSummary` 区分数据状态和请求状态：

| 字段              | 含义                                     |
| ----------------- | ---------------------------------------- |
| `fetched`         | 本次成功获取新数据的仓库数               |
| `cached`          | 请求失败但成功使用旧缓存的仓库数         |
| `missing`         | 请求失败且没有缓存、最终没有数据的仓库数 |
| `fetchErrors`     | 仓库级抓取失败次数                       |
| `rateLimitErrors` | 其中由 403/429 限流造成的次数            |

因此「缺失 0」不等于「请求失败 0」：没有 token 时，匿名 API 限额耗尽后，大量仓库可能请求失败并回退到缓存。

## 环境变量

| 变量                    | 用途                                                |
| ----------------------- | --------------------------------------------------- |
| `GITHUB_TOKEN`          | GitHub API token；服务端使用，不要加 `PUBLIC_` 前缀 |
| `GH_TOKEN`              | `GITHUB_TOKEN` 的备用名                             |
| `SKIP_GITHUB_SYNC`      | 设为 `1` 或 `true` 时跳过网络同步                   |
| `SITE_URL`              | Astro `site` 与 canonical / sitemap 的基地址        |
| `PUBLIC_REPOSITORY_URL` | 可选，默认指向本仓库；页脚与 Issue 入口的链接       |

## 添加项目

1. 确认项目是公开可访问的 GitHub 仓库或网页/脚本，且与浙江大学有关；没有 GitHub 仓库时至少提供一个外部链接。
2. 在 `src/data/projects.ts` 的数组末尾添加记录。
3. 选择一个最接近的分类，不要为了曝光重复收录。
4. 标签建议使用 2 到 4 个，优先使用站内已有标签，便于交叉检索。
5. 运行：

```bash
pnpm sync:projects
pnpm check
pnpm test
pnpm build
```

6. 检查卡片上的维护状态与链接是否符合预期。

## 移除或修正

- 仓库迁移：更新 `repo`，旧快照会在下一次同步时失效。
- 项目失效：删除 `projects.ts` 中的记录；快照中的孤立条目会在下一次同步时被裁掉。
- 分类调整：修改 `category`，分类页与首页统计会自动更新。
- 网站或下载地址失效：更新 `links`。

## 版权与隐私

本站只存储项目名称、简介、链接和 GitHub 公开元数据，不复制项目代码或课程资料内容。没有 GitHub 仓库的脚本或网页工具同样会显示为「未知」维护状态。项目版权归各自作者所有。课程资料类仓库可能涉及教师、助教或同学的版权与隐私，收录前请确认仓库本身是公开的，并在贡献时遵守学术诚信要求。
