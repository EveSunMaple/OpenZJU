# 本地开发

## 环境要求

- Node.js >= 22.23.4（推荐 24 LTS）
- pnpm >= 11
- Git

```bash
node --version
pnpm --version
```

项目根目录的 `.nvmrc` 固定为 24：

```bash
nvm use
```

## 安装与启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

开发服务器默认运行在 `http://localhost:4321`。

`.env` 示例：

```dotenv
GITHUB_TOKEN=
SITE_URL=http://localhost:4321
PUBLIC_REPOSITORY_URL=
```

`GITHUB_TOKEN` 只在构建脚本中使用，不会被暴露到浏览器。同步脚本会读取项目根目录的 `.env`；已经存在的环境变量优先级更高。`PUBLIC_REPOSITORY_URL` 会进入客户端可见的配置。

## 常用命令

```bash
pnpm dev                    # 开发服务器
pnpm build                  # 同步统计数据与审计 + 静态构建
pnpm preview                # 预览 dist
pnpm sync:projects          # 只同步 GitHub 数据
pnpm sync:projects:offline  # 只使用统计缓存
pnpm sync:audits            # 只同步项目审计
pnpm sync:audits:offline    # 只使用审计缓存
pnpm deep:prepare           # 生成深度审计分片
pnpm deep:analyze           # 分析一个分片
pnpm deep:merge             # 合并深度审计结果
pnpm check                  # astro check + biome check
pnpm check:ci               # astro check + biome ci
pnpm format                 # Biome 格式化
pnpm lint                   # Biome lint
pnpm test                   # Vitest
```

## 代码组织

```text
src/domain/          纯领域规则，不依赖框架
src/application/     纯应用逻辑，可被页面与浏览器共享
src/infrastructure/  Node / GitHub / 文件系统
src/data/            项目数据源
src/generated/       构建生成数据
src/pages/           Astro 路由页面
src/presentation/    Astro 组件、样式、控制器
scripts/             构建脚本入口
```

新增代码时先判断归属：

- 与项目和分类规则有关：`domain`
- 与目录统计、搜索、排序有关：`application`
- 与 GitHub、文件、缓存有关：`infrastructure`
- 与页面、样式、DOM 有关：`presentation`

## 代码风格

- 使用 Biome 统一格式、lint 与 import 排序。
- 默认双引号、分号、2 空格缩进、100 列宽。
- Astro 文件启用 Biome 的 HTML 实验支持；保存前可运行 `pnpm format`。
- 不引入未使用的依赖；新增依赖前先检查项目是否已有同类工具。
- 组件优先使用语义化 HTML；图标必须带 `aria-hidden` 或可读标签。
- 不添加无意义注释；复杂决策写到 `docs/`。

## 修改项目数据

1. 编辑 `src/data/projects.ts`。
2. 运行 `pnpm sync:projects` 补充该仓库的活动数据。
3. 运行 `pnpm check` 校验类型与格式。
4. 运行 `pnpm test`。
5. 运行 `pnpm build` 或 `pnpm dev` 检查页面。

新增项目后，建议检查：

- 分类是否正确；
- 标签是否与现有标签一致；
- 网站/下载链接是否 404；
- 最新更新日期是否合理；
- 卡片是否因简介过长而显得拥挤。

## 修改维护状态阈值

编辑 `src/domain/project/repository-stats.ts` 中的 `assessMaintenance` 与 `MAINTENANCE_META`，同时更新：

- `src/domain/project/repository-stats.test.ts`
- `docs/data-model.md`
- 关于页中的说明
- README 中的状态表

阈值改变会影响首页「仍在维护」统计与状态筛选数量。

## 修改搜索

搜索纯函数在 `src/application/search.ts`，DOM 控制器在 `src/presentation/scripts/catalog-controller.ts`。

- 修改匹配规则：改 `matchesSearch` 并补测试。
- 修改 URL 参数：改 `restoreFromUrl` / `syncUrl`。
- 新增筛选维度：在卡片上增加 `data-*`，在控制器中读取，并更新 URL 与计数。
- 保持 `data-search` 已经标准化，避免每次按键重复处理长文本。

## 修改样式

全局样式在 `src/presentation/styles/global.css`。

- 优先使用 HeroUI 语义变量与 Tailwind 令牌。
- 分类色与状态色在 `:root` / `.dark` 中定义。
- 新增 HeroUI 组件时，按需增加 `@import "@heroui/styles/components/xxx.css" layer(components);`。
- 修改断点时同时检查 520 / 768 / 1024 三个视口。
- 任何动画都要加 `prefers-reduced-motion` 处理。

## 测试

```bash
pnpm test
pnpm exec vitest
```

测试覆盖：

- 维护状态边界与归档优先；
- 搜索标准化、token 匹配、状态组合；
- 项目数据校验；
- 目录统计、排序与归档沉底。

项目没有把浏览器端到端测试放进 CI。需要本地验证交互时，可使用 Playwright + 系统 Chrome，检查搜索、标签、主题、Swup 与移动端布局。

## 构建数据同步

本地首次构建没有 token 时：

- 会尝试匿名 GitHub API；
- 可能受到速率限制；
- 失败的仓库使用缓存或显示「未知」；
- 构建不会中断。

需要完整数据时：

```bash
GITHUB_TOKEN=ghp_xxx pnpm sync:projects
pnpm build
```

或在 `.env` 中配置 token 后运行。

## 排错

### `pnpm build` 很慢

没有 token 时，REST 同步需要为每个仓库请求元数据与提交历史。配置 token 后会走 GraphQL 批量查询，速度明显更快。

### `src/generated/repository-stats.json` 被修改

构建或同步会更新该文件，这是预期行为。提交前检查 diff 是否只包含同步时间与统计数据变化。

### Astro 图标警告

`src/icons` 目录用于本地 SVG 图标。项目当前只使用 Lucide 图标，保留空目录是为了避免 astro-icon 的扫描警告。

### Biome 与 Astro 格式化冲突

Biome 对 Astro 的支持是实验性的。提交前应同时运行：

```bash
pnpm check
```

确认 `astro check` 与 Biome 都通过。若某段 Astro 模板被格式化后语义变化，优先调整模板结构，而不是关闭检查。

### Swup 后搜索失效

检查 `src/presentation/scripts/app.ts` 是否在 `page:view` 重新挂载了 `CatalogController`。Astro 的页面脚本不会在 Swup 替换内容后自动重新执行。

## 发布前检查清单

- [ ] `pnpm check` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm build` 通过
- [ ] 新增项目链接可访问
- [ ] 首页、四个分类页、关于页、404 页正常
- [ ] 搜索、状态筛选、排序、标签点击正常
- [ ] 明暗主题与系统跟随正常
- [ ] 移动端无横向滚动
- [ ] `SITE_URL` 与 `GITHUB_TOKEN` 已在部署平台配置
- [ ] 定时 Deploy Hook secret 已配置
- [ ] 深度分析工作流可手动运行，且生成缓存已提交
