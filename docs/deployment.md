# 部署

站点是纯静态产物，推荐部署到 Vercel。GitHub 数据在构建时刷新，因此不需要 SSR。

## 前置条件

- 一个 Vercel 账号；
- 一个 GitHub 仓库（本站源码）；
- 一个可读取公开仓库的 GitHub Token；
- 一个生产域名（可使用 Vercel 分配的域名）。

## 环境变量

在 Vercel 项目设置的 Environment Variables 中配置：

| 变量                    | 必填 | 说明                                     |
| ----------------------- | ---- | ---------------------------------------- |
| `GITHUB_TOKEN`          | 推荐 | 读取公开仓库元数据与提交记录；服务端专用 |
| `SITE_URL`              | 推荐 | 生产地址，用于 canonical、OG 与 sitemap  |
| `PUBLIC_REPOSITORY_URL` | 可选 | 页脚与关于页的源码链接                   |

注意：

- `GITHUB_TOKEN` **不要**加 `PUBLIC_` 前缀，否则会被打包进客户端。
- 只需要公开仓库读取权限。Fine-grained token 可以只授予 Public repositories 的只读访问；classic token 不勾选额外 scope 通常也可读取公开数据。
- Token 过期后，构建仍会继续，但会退回匿名 API 或缓存。

## Vercel 项目设置

1. 导入仓库。
2. Framework Preset 选择 **Astro**。
3. Build Command：`pnpm build`。
4. Install Command：`pnpm install --frozen-lockfile`。
5. Output Directory：`dist`。
6. Node.js Version：24.x（项目要求 >= 22.23.4）。
7. 配置环境变量后点击 Deploy。

仓库中的 `vercel.json` 已经声明：

```json
{
  "framework": "astro",
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install --frozen-lockfile"
}
```

并附带基础安全响应头与静态资源缓存头。

## 数据刷新机制

Vercel 不会自动按计划重新构建静态站点。推荐使用 **Deploy Hook + GitHub Actions**：

1. 在 Vercel 项目 **Settings → Git → Deploy Hooks** 创建一个 hook，名称例如 `daily-refresh`，分支选择生产分支。
2. 复制生成的 URL。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 新建 secret：
   - 名称：`VERCEL_DEPLOY_HOOK_URL`
   - 值：上一步的 URL
4. `.github/workflows/deep-audit.yml` 每天先运行深度代码质量分析、自动提交缓存，再 POST 该 hook，触发一次生产构建。
5. `.github/workflows/refresh-deployment.yml` 保留为手动兜底，不再单独定时，避免重复构建。
6. 在 Vercel 关闭 Git 自动部署，否则自动提交和 Deploy Hook 可能各触发一次构建。

深度分析工作流使用 UTC cron：

```yaml
schedule:
  - cron: "0 16 * * *"
```

对应北京时间每天 00:00（UTC+8）。GitHub Actions 的定时任务可能延迟数分钟到数十分钟。

## 持续集成

`.github/workflows/ci.yml` 在每次 push 与 pull request 时执行：

```bash
pnpm install --frozen-lockfile
pnpm check:ci
pnpm test
pnpm build
```

其中：

- `pnpm check:ci` = `astro check` + `biome ci .`
- `pnpm test` = Vitest 单元测试
- `pnpm build` 会使用 workflow 注入的 `GITHUB_TOKEN` 刷新统计数据与项目审计，并读取已提交的代码质量缓存

CI 的构建产物不会提交回仓库，只用于验证。

## 缓存文件

`src/generated/repository-stats.json` 已纳入版本控制：

- 首次克隆后即使不联网也能构建；
- Vercel 构建失败或 GitHub 限流时有兜底；
- 每次成功同步会覆盖。

如果希望每次构建都强制使用网络数据并忽略缓存，可以删除该文件后再构建；不推荐在 CI 中这样做，因为任何网络波动都会导致数据缺失。

## 自定义域名

1. 在 Vercel 添加域名并完成 DNS 验证。
2. 将 `SITE_URL` 更新为最终地址，例如 `https://zju-open-source.example.com`。
3. 重新部署，使 canonical、OG 与 sitemap 使用新域名。

`sitemap-index.xml` 与 `robots.txt` 会基于 `SITE_URL` 生成。

## 故障排查

### 构建成功但数据都是「未知」

- 检查 `GITHUB_TOKEN` 是否配置在 **Production** 环境。
- 检查 token 是否过期或权限不足。
- 查看 Vercel 构建日志中 `GitHub 数据同步` 部分。
- 本地运行 `GITHUB_TOKEN=... pnpm sync:projects` 验证。

### 构建日志出现 403 / rate limit

- 未认证 API 限额很低，配置 token。
- 如果使用 token 仍然限流，检查是否在短时间反复触发 Deploy Hook。
- 失败时构建会使用缓存，不会中断。

### 页面没有更新

- Vercel 的静态构建需要重新部署才会更新数据。
- 检查 Deploy Hook workflow 是否成功运行。
- GitHub Actions 的 schedule 在仓库长时间无活动后可能被暂停，需要在 Actions 页面手动启用。

### `pnpm install` 被 esbuild 构建脚本阻塞

pnpm 11 默认可能忽略依赖的 postinstall。项目的 `pnpm-workspace.yaml` 已允许 `esbuild` 构建：

```yaml
allowBuilds:
  esbuild: true
```

如果本地仍提示，运行：

```bash
pnpm approve-builds
```

并允许 esbuild。

### Node 版本不满足

Astro 7 要求 Node >= 22.23.4。Vercel 项目设置中选择 24.x；本地使用 `.nvmrc`：

```bash
nvm use
```

## 其他平台

静态产物可以部署到任何支持静态托管的平台（Cloudflare Pages、Netlify、GitHub Pages 等）。需要保证：

- 构建命令为 `pnpm build`；
- 输出目录为 `dist`；
- 构建环境可访问 GitHub 并配置 `GITHUB_TOKEN`；
- 如需定时刷新，使用各平台的 Deploy Hook / 构建钩子。

GitHub Pages 需要额外处理 base path（如果部署在子路径），并调整 `SITE_URL` 与 `astro.config.mjs` 的 `base`。本项目默认假定部署在域名根路径。
