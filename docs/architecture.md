# 架构

## 目标与约束

求是开源要解决的是一个信息发现问题：浙大开源项目分散、重叠、维护状态不透明。站点需要：

- 以静态站点形式部署，不运行 SSR；
- 每次构建时刷新 GitHub 仓库状态；
- 在浏览器端完成搜索、筛选、排序和主题切换；
- 支持移动端、明暗主题、可访问性与平滑路由过渡；
- 在没有网络或 GitHub 速率受限时仍然可以构建。

## 技术栈

| 层       | 选择                         | 用途                                            |
| -------- | ---------------------------- | ----------------------------------------------- |
| 构建     | Astro 7                      | 静态生成、文件路由、组件与构建时数据读取        |
| 样式     | Tailwind CSS v4              | 原子类、响应式与设计令牌桥接                    |
| 组件样式 | HeroUI v3 `@heroui/styles`   | BEM 组件类、主题变量、SearchField、Card、Button |
| 图标     | Lucide + astro-icon          | 构建时内联 SVG                                  |
| 交互     | 原生 TypeScript              | 搜索、筛选、排序、主题控制                      |
| 路由过渡 | Swup 4                       | 页面切换、head 更新、预加载、滚动与可访问性     |
| 质量     | Biome + Astro Check + Vitest | 格式、lint、类型检查、单元测试                  |
| 部署     | Vercel                       | 静态托管与构建时数据刷新                        |

## DDD 分层

```text
src/
├── domain/           领域层：纯规则与类型
│   └── project/
│       ├── project.ts
│       ├── category.ts
│       ├── repository-stats.ts
│       └── snapshot.ts
├── application/      应用层：编排纯逻辑
│   ├── catalog.ts
│   └── search.ts
├── infrastructure/   基础设施层：外部世界
│   └── github/
│       ├── github-client.ts
│       ├── sync-repository-stats.ts
│       └── stats-store.ts
├── data/             数据源
│   └── projects.ts
├── pages/            Astro 路由页面
└── presentation/     表现层：Astro 与浏览器
    ├── components/
    ├── layouts/
    ├── scripts/
    ├── lib/
    └── styles/
```

依赖方向：

```text
presentation ──> application ──> domain
      │               │
      └───────────────┴──> infrastructure（仅构建时脚本使用）
```

- `domain` 不导入 Astro、Node、GitHub 或浏览器 API。
- `application` 只做纯函数组装与计算，可以同时被构建时页面和浏览器控制器使用。
- `infrastructure` 读取 GitHub 与文件系统，只在 Node 构建阶段运行。
- `presentation` 读取构建结果，并把纯函数打包进浏览器脚本。

## MVC 映射

前端项目里的 MVC 不是后端框架意义上的 Controller，而是职责映射：

| MVC        | 本项目                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Model      | `domain`、`application`、`data`、`generated`                               |
| View       | `pages`、`presentation/components`、`layouts`、`styles`                    |
| Controller | `presentation/scripts` 中的 `CatalogController`、主题控制器、Swup 生命周期 |

`CatalogController` 只操作 DOM 和 URL，不承载领域规则。查询匹配与状态过滤的纯函数来自 `application/search.ts`，分类与维护状态来自 `domain`。

## 构建时数据流

```text
src/data/projects.ts
        │
        ├── owner/repo 列表
        ▼
scripts/sync-projects.ts
        │
        ├── GitHub GraphQL（有 token，批量）
        ├── GitHub REST + commits（回退）
        ├── GitHub Atom feed（提交接口失败时）
        └── src/generated/repository-stats.json（最终回退）
        ▼
src/generated/repository-stats.json
        │
        ▼
buildCatalog(projects, snapshot)
        │
        ├── 合并仓库状态
        ├── 判定维护状态
        ├── 生成搜索文本
        └── 计算统计与排序
        ▼
Astro 页面 ──> dist/（纯静态 HTML/CSS/JS）
```

## 浏览器端数据流

```text
静态 HTML（所有项目卡片已渲染）
        │
        ▼
CatalogController
        ├── 读取 URL 参数 q / status / sort
        ├── 绑定输入、清空、状态、排序、标签点击
        ├── 根据 data-search 与 data-status 过滤 DOM
        ├── 更新结果计数、状态计数、空状态
        └── history.replaceState 同步 URL
```

搜索不请求接口，不需要索引文件，也不会因为 JavaScript 延迟而阻塞首屏内容。禁用 JavaScript 时，全部项目仍然可见。

## 构建流程

`pnpm build` 等价于：

1. `pnpm sync:projects`：由 `tsx` 执行 `scripts/sync-projects.ts`。
2. 同步脚本调用 `syncRepositoryStats`，写入 `src/generated/repository-stats.json`。
3. Astro 构建所有静态路由，页面在模块加载时读取快照并组装目录。
4. `@astrojs/sitemap` 生成 sitemap。
5. `src/pages/robots.txt.ts` 生成 robots.txt。
6. 输出到 `dist/`。

任何一步失败都会尽量降级而不是中断：

- 单个仓库失败：使用该仓库的上一次缓存；没有缓存则标记为未知。
- 网络整体失败：保留旧快照，构建继续。
- 缓存文件缺失：生成空快照，页面仍可构建。

## 关键设计决策

### 为什么不用 `@heroui/react`

HeroUI v3 将样式包 `@heroui/styles` 与行为包 `@heroui/react` 分离。React 组件依赖 React Aria，需要 hydration。站点同时使用 Swup：Swup 会替换 `#swup` 容器内的 HTML，而 Astro 的 React island 不会在每次页面替换后自动重新 hydrate。

因此本项目采用：

- `@heroui/styles` 的 BEM 类与主题变量，获得 HeroUI 的视觉与设计系统；
- 原生语义化 HTML 与少量 TypeScript 控制器，获得行为；
- Astro 组件负责静态渲染。

这带来更小的 JS、更稳定的 Swup 兼容性，并且保留了 HeroUI 的核心设计语言。若未来需要复杂弹层、日期选择器等 React Aria 行为，应单独评估是否引入 island 与重新 hydrate 机制。

### 为什么搜索在 DOM 上做

项目数量在几十到几百的量级，全部卡片在构建时渲染，搜索只需要读取每个卡片的 `data-search` 字符串。这样：

- 不需要额外请求；
- 不需要在客户端重复渲染卡片；
- 关键词、状态、排序可以和 URL 参数自然组合；
- 无 JavaScript 时仍有完整内容。

当项目规模显著增大时，可以替换为预生成 JSON 索引与虚拟列表，但当前阶段没有必要。

### 为什么缓存要提交

Vercel 构建环境可能临时无法访问 GitHub，或者 token 未配置/限额。将 `src/generated/repository-stats.json` 纳入版本控制可以：

- 让新克隆的仓库离线也能构建；
- 让 CI 失败时仍能产出可浏览的站点；
- 保留最近一次成功同步的维护状态。

缓存由脚本生成，不建议手工编辑。同步成功后会覆盖。

### 为什么把 GitHub 同步放在构建前

Astro 静态页面需要同步数据来决定排序、状态和统计。把同步放在 `astro build` 之前，可以让页面读取普通 JSON 模块，不需要在 Astro 生命周期里处理异步外部请求，也让同步逻辑可以独立运行、测试与降级。

## 扩展点

- **新增分类**：修改 `domain/project/category.ts` 与 `CATEGORIES`，分类路由会自动生成。
- **新增页面**：在 `src/pages` 添加 Astro 页面，使用 `BaseLayout` 即可获得导航、主题、Swup 和页脚。
- **新增数据源**：实现新的 infrastructure 模块，产出同样的 `RepositoryStatsSnapshot`。
- **修改状态算法**：只改 `domain/project/repository-stats.ts`，页面和卡片会自动反映。
- **替换搜索**：保持 `data-search` 与 `data-status` 契约，替换 `CatalogController` 的内部实现即可。

## 测试策略

- `domain` 与 `application` 使用 Vitest 做纯函数测试。
- `astro check` 覆盖 Astro 与 TypeScript 类型。
- `biome ci` 覆盖格式、lint 与 import 组织。
- `pnpm build` 在 CI 中执行，验证数据、路由、图标、样式与静态产物。
- 本地可用 Playwright + 系统 Chrome 做交互冒烟检查，但不作为 CI 依赖。

## 已知限制

- 维护状态只依据默认分支提交与仓库归档，不分析代码质量、依赖健康度或 issue 活跃度。
- 未配置 token 时，REST 速率限制会影响一次性刷新全部仓库的完整性。
- 搜索只针对当前页面已渲染的项目；分类页搜索不会跨分类。
- Swup 与 Astro island 的兼容性未在本项目中启用，因为当前没有 React island。
