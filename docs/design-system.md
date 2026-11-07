# 设计系统

## 视觉方向

站点借用「地图 / 索引 / 档案」的隐喻，而不是常见的 SaaS 仪表盘：

- 大字号衬线中文标题，像一份可翻阅的目录；
- 等宽字体的编号、同步时间和元数据，强化索引感；
- 细网格背景、十字准星与分类编号，呼应「坐标」；
- 克制的浙大蓝作为主强调色，四个分类各自拥有低饱和色相；
- 卡片密集但有呼吸感，信息以「状态、动作、标签」三层呈现。

整体目标是让页面看起来像一份认真编辑过的公开资料，而不是自动生成的列表。

## 字体

```css
--font-body:
  -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
  "Microsoft YaHei", "Noto Sans SC", sans-serif;

--font-display:
  "Iowan Old Style", "Palatino Linotype", "Songti SC", "Noto Serif SC",
  "Source Han Serif SC", Georgia, serif;

--font-code:
  "SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace;
```

- 标题、分类大标题、统计数字使用 `--font-display`。
- 正文、卡片描述、按钮使用 `--font-body`。
- 编号、日期、标签、页脚元数据使用 `--font-code`。
- 不加载远程字体，避免阻塞与隐私问题；不同平台的字体有差异，但回退链保证可读性。

## 颜色

### 主色

HeroUI 默认主题提供语义变量，本项目覆盖：

```css
:root {
  --accent: oklch(0.48 0.15 253);
  --accent-hover: oklch(0.43 0.16 253);
  --accent-foreground: oklch(0.99 0 0);
  --link: var(--accent);
}

.dark,
[data-theme="dark"] {
  --accent: oklch(0.76 0.12 247);
  --accent-hover: oklch(0.82 0.11 247);
  --accent-foreground: oklch(0.17 0.025 255);
}
```

### 分类色

```css
--cat-life: oklch(0.58 0.14 157);
--cat-study: oklch(0.53 0.16 255);
--cat-research: oklch(0.56 0.17 305);
--cat-work: oklch(0.65 0.15 61);
```

黑夜模式使用更高的明度与略低的彩度。分类色只用于：

- 分类 badge 与圆点；
- 分类索引行的 hover；
- 分类页标题强调；
- 卡片 hover 边框与顶部高光。

不把分类色用于大面积背景，避免页面变成色块拼贴。

### 维护状态色

```css
--status-active: oklch(0.6 0.16 150);
--status-maintained: oklch(0.58 0.14 248);
--status-low: oklch(0.7 0.15 78);
--status-dormant: oklch(0.62 0.17 36);
--status-archived: oklch(0.55 0.01 260);
--status-unknown: oklch(0.62 0.01 260);
```

- 状态色只出现在状态圆点、状态胶囊、审计圆环与 AI 风险标签中。
- 文本始终保留足够对比度；颜色不是唯一信息，徽标同时包含文字。
- 已归档与未知使用中性灰，避免与「危险」混淆。

## HeroUI 的使用方式

本项目使用 `@heroui/styles`，不使用 `@heroui/react`：

```css
@import "tailwindcss";
@import "@heroui/styles/utilities";
@import "@heroui/styles/variants";
@import "@heroui/styles/themes/default" layer(theme);
@import "@heroui/styles/base" layer(base);
@import "@heroui/styles/components/button.css" layer(components);
@import "@heroui/styles/components/card.css" layer(components);
@import "@heroui/styles/components/search-field.css" layer(components);
```

实际使用的 HeroUI BEM：

- `.search-field` / `.search-field__group` / `.search-field__input`：搜索框结构与交互态；
- `.card`：卡片基础容器与阴影；
- `.button` / `.button--primary` / `.button--outline`：Hero 与 404 的主要动作；

样式覆盖尽量使用语义变量，不复制组件内部 CSS。需要局部调整时，用本项目自己的 `.project-card`、`.catalog-search` 等类覆盖。

## 布局

- 全局最大宽度：`90rem`。
- 页面左右内边距：`clamp(1rem, 4vw, 3rem)`。
- 顶部导航高度：`4.25rem`，移动端 `3.8rem`。
- 项目网格：`repeat(auto-fill, minmax(min(100%, 19.5rem), 1fr))`。
- 卡片圆角：`1.2rem`；按钮/过滤器圆角更小，形成层级。
- 断点：
  - `1024px`：Hero 与文档双栏变单栏；
  - `768px`：导航换行、页脚单栏、工具条重新排布；
  - `520px`：单列卡片、Hero 标题缩放。

## 项目卡片

结构从上到下：

1. **Top**：左侧分类 badge（链接到分类页）与最新更新日期，右侧项目审计圆环。
2. **Body**：项目名（外链、hover 箭头、可选编辑推荐图标）+ 最多三行简介。
3. **Signals**：维护状态、Stars、语言、最近 90 天提交数、启发式 AI 风险。
4. **Audit popover**：代码质量主导的维度条、深度指标、工程护栏、AI 风险与 OpenSSF 状态。
5. **Footer**：网站/下载/GitHub 动作 + 可点击标签。

设计约束：

- 卡片不作为整体链接，避免与标签、分类链接冲突。
- 标题外链使用 `target="_blank"` 与 `rel="noopener noreferrer"`。
- 卡片等高由 Grid 拉伸与 `margin-top: auto` 保证。
- 状态色、分类色只做局部强调。
- 标签是按钮而不是链接，点击后进入搜索状态。

## 主题

主题模式：

- `system`：默认，跟随 `prefers-color-scheme`；
- `light`：显式白天；
- `dark`：显式黑夜。

实现：

- `<head>` 内联脚本在首次绘制前读取 `localStorage` 并设置 `<html class>`、`data-theme`、`data-theme-mode`、`color-scheme`。
- 主题控件是三个按钮的 `fieldset`，使用 `aria-pressed` 与分组标签。
- 切换时写入 `localStorage`，并监听系统主题变化与跨标签页 `storage` 事件。
- Swup 不替换 `<html>`，所以主题在路由切换时保持不变。

## 动效

- 页面切换：220ms 透明度 + 8px 位移；
- 卡片 hover：3px 上浮、分类色边框、顶部细光；
- 按钮与标签：150–220ms 颜色/边框过渡；
- 所有动画都在 `prefers-reduced-motion: reduce` 下关闭。
- 不使用视差、自动播放或大面积持续动画。

## 可访问性

- 跳过链接：`跳到主要内容`。
- 语义结构：`header`、`nav`、`main`、`section`、`article`、`footer`。
- 搜索有可见关联提示与 `aria-live` 结果计数。
- 状态筛选使用 `fieldset` + `legend`，按钮使用 `aria-pressed`。
- 外链与图标按钮有可读的 `aria-label` / `title`。
- 焦点环使用 `:focus-visible` 与高对比度颜色。
- 装饰图标全部 `aria-hidden="true"`。
- 颜色不是唯一信息载体；状态有文字标签。
- Swup A11y 插件负责页面切换播报与焦点恢复。
- 键盘快捷键 `/`、`Cmd/Ctrl + K`、`Escape` 可用。

## 资源

- `public/favicon.svg`：站点图标；
- `public/icon-192.png`、`public/icon-512.png`、`public/apple-touch-icon.png`：PWA 与移动端图标；
- `public/og.png`：1200 × 630 社交预览图；
- `public/site.webmanifest`：PWA 清单。

图标由 Lucide 提供，通过 `astro-icon` 在构建时内联。每页只输出实际使用的符号，重复使用通过 `<use>` 引用。
