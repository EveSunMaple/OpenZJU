# 深度代码质量

卡片状态行里的评分按钮现在以代码质量为主。深度分析每条命令只在 GitHub Actions 中运行，结果写入 `src/generated/repository-code-quality.json`；Vercel 构建只读取缓存，不克隆仓库。

它不是 SonarQube 官方结果，也不包含测试覆盖率。它是一个可解释的静态质量信号，适合发现复杂度、重复代码、lint 问题、密钥和依赖漏洞，而不是判断项目是否“好”。

## 数据流

```text
每日 GitHub Actions
        │
        ├── 读取 projects 与 repository-stats 缓存
        ├── 按仓库分片下载默认分支 tarball
        ├── 运行静态分析工具
        ├── 合并为 repository-code-quality.json
        └── 自动提交 + 触发 Vercel
                        │
                        ▼
Vercel：pnpm build
        ├── sync:projects
        ├── sync:audits（读取统计与代码质量缓存）
        └── astro build
```

深度分析不会安装项目依赖、执行项目脚本或运行测试。小仓库以 tarball 下载；超过约 100 MB 的仓库改用 `git` sparse checkout，只拉取源码、配置和文档扩展名，不下载数据集、PDF 或二进制资产。归档仓库会标记为 `skipped`。

## 工具

| 工具          | 语言/范围                               | 指标                                          |
| ------------- | --------------------------------------- | --------------------------------------------- |
| `lizard`      | C/C++、Python、JS/TS、Java、Go、Rust 等 | 函数数、NLOC、平均/最大圈复杂度、高复杂度函数 |
| `jscpd`       | 多语言                                  | 重复代码比例、重复块数                        |
| `ruff`        | Python                                  | lint 问题                                     |
| `oxlint`      | JavaScript / TypeScript                 | lint 问题                                     |
| `cppcheck`    | C/C++                                   | 警告、错误                                    |
| `gitleaks`    | 全部文件                                | 潜在密钥数量，只保留数量，不保存密钥内容      |
| `osv-scanner` | 已有 lockfile / 依赖清单                | 依赖漏洞数量及严重度                          |

其他语言目前只运行通用的复杂度和重复率分析；没有对应 linter 时会标记为部分分析。

## 总分

有深度数据时：

```text
总分 = 代码质量 × 60%
     + 维护 × 15%
     + 文档 × 10%
     + 安全 × 15%
```

代码质量内部：

```text
复杂度 35% + 重复率 20% + lint 30% + 密钥/漏洞 15%
```

最终按可用组件重新归一化；没有代码分析结果时，回退到原来的四维工程信号评分，并在弹层与文档中标注“未深度分析”。

等级仍为 A/B/C/D/F：

| 等级 | 分数 |
| ---- | ---- |
| A    | ≥ 90 |
| B    | ≥ 75 |
| C    | ≥ 60 |
| D    | ≥ 40 |
| F    | < 40 |

## 指标解释

- **平均复杂度**：`lizard` 统计的圈复杂度平均值。数值越低越好，但不同语言、不同项目类型不能直接横向比较。
- **高复杂度函数**：CCN ≥ 15 的函数数量。它是排查入口，不是缺陷清单。
- **重复率**：`jscpd` 统计的重复行比例。生成代码、示例和模板可能拉高重复率。
- **lint**：`ruff`、`oxlint`、`cppcheck` 等工具的问题数；工具覆盖不到的仓库显示为空。
- **密钥**：`gitleaks` 命中的数量。不会把具体密钥写入生成文件或页面。
- **依赖漏洞**：`osv-scanner` 读取已有依赖文件后的结果；没有依赖文件时不代表安全。

## 置信度

代码质量置信度只描述工具覆盖度：

- **高**：复杂度、重复率、lint、安全发现都有结果。
- **中**：复杂度与重复率可用，但缺少 lint 或安全结果。
- **低**：只有很少的通用指标。

项目审计的总置信度还会结合 Community Profile、根目录内容与 OpenSSF Scorecard。缺少覆盖率不会单独降低代码质量置信度，但会在弹层中明确提示。

## 每日工作流

工作流位于 `.github/workflows/deep-audit.yml`，默认每天 UTC 16:00（北京时间 00:00）运行，也可以手动触发。首次合并后建议先手动运行一次，填充 `repository-code-quality.json`：

1. `prepare`：生成审计分片。
2. `analyze`：按分片并行下载源码（大仓库使用 sparse checkout）、安装工具、运行静态分析，上传 artifact。
3. `merge`：合并分片，更新 `src/generated/repository-code-quality.json`。
4. 自动提交生成文件，并调用 Vercel Deploy Hook。

自动提交使用仓库的 `GITHUB_TOKEN`，需要 `contents: write` 权限。如果分支保护不允许 bot push，工作流会失败，需要允许 GitHub Actions 或改成 PR 流程。

### 只构建一次

Vercel 的 Git 自动部署和 Deploy Hook 同时开启会导致同一天两次构建。推荐在 Vercel 关闭 Git 自动部署，让 `deep-audit.yml` 统一触发一次；原来的 `refresh-deployment.yml` 已改为手动兜底。

如果保留 Vercel 自动部署，请不要再从工作流调用 Hook，避免重复部署。

## 本地运行

需要本地安装 `lizard`、`jscpd`、`ruff`、`oxlint`、`cppcheck`、`gitleaks`、`osv-scanner` 中需要的工具，并配置 `GITHUB_TOKEN`。

```bash
pnpm deep:prepare --output deep-audit-chunks.json
pnpm deep:analyze --chunks deep-audit-chunks.json --chunk 1 --output artifacts/chunk-1.json
pnpm deep:merge --inputs artifacts --output src/generated/repository-code-quality.json
```

然后重新生成审计缓存并构建：

```bash
pnpm sync:audits
SKIP_GITHUB_SYNC=1 pnpm build
```

`deep:analyze` 的工具缺失或单个仓库失败不会中断整个分片，该仓库会显示为 `skipped`。

## 限制

- 不运行测试，因此没有覆盖率、运行时错误或真实技术债。
- 不能替代 SonarQube、CodeQL 或人工审查；SonarQube Cloud 还需要仓库所有者导入项目。
- 复杂度阈值和 lint 严重度在不同语言间不完全可比。
- 生成代码、课程模板、示例目录和压缩产物可能造成误报。
- 公开仓库的下载与静态解析仍受 GitHub 速率、仓库大小和工具版本影响；超大仓库会走 sparse checkout，仍可能因网络或工具超时被标记。

## 相关文件

- `src/domain/project/repository-code-quality.ts`：数据结构和缓存解析。
- `src/application/code-quality.ts`：代码质量评分。
- `src/infrastructure/code-quality/code-quality-store.ts`：缓存读写。
- `scripts/deep-audit/prepare.ts`：分片准备。
- `scripts/deep-audit/analyze.ts`：下载与静态分析。
- `scripts/deep-audit/merge.ts`：合并缓存。
- `.github/workflows/deep-audit.yml`：每日工作流。
- `src/generated/repository-code-quality.json`：生成缓存。
