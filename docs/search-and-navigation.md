# 搜索与导航

## 静态搜索

搜索不请求接口，也不生成单独索引文件。构建时，每个项目卡片都会写入：

```html
<article
  class="card project-card"
  data-project-card
  data-category="research"
  data-status="active"
  data-search="ego-planner 面向四旋翼无人机的... 科研 research 无人机 轨迹规划 机器人 c++ gpl-3.0"
  data-updated="..."
  data-stars="2727"
  data-name="ego-planner"
  data-archived="false"
>
```

`data-search` 由以下内容拼接并标准化：

- 项目名称；
- 项目简介；
- 仓库全名；
- 分类中英文名称；
- 标签；
- 主语言；
- License；
- GitHub Topics。

文本标准化使用 `normalizeSearchText`：

```ts
value.normalize("NFKC").toLocaleLowerCase("zh-CN").replaceAll(/\s+/g, " ").trim();
```

查询按空白拆分为 token，所有 token 都命中才算匹配：

```ts
matchesSearch(haystack, "无人机 机器人"); // 两个词都要出现
```

这让搜索同时支持中文、英文、大小写混写和全角字符。

## 控制器

实现：`src/presentation/scripts/catalog-controller.ts`。

`CatalogController` 在初始化时收集：

- 搜索输入框；
- 清空按钮；
- 项目网格与全部卡片；
- 结果计数、空状态；
- 状态筛选按钮；
- 排序下拉框。

随后：

1. 从 URL 读取 `q`、`status`、`sort`；
2. 绑定输入、点击、键盘和标签事件；
3. 排序 DOM；
4. 应用过滤并更新 UI；
5. 将状态写回 URL。

`destroy()` 使用 `AbortController` 一次性移除所有监听器。Swup 每次页面切换都会销毁旧控制器、挂载新控制器，避免重复绑定。

## 过滤与排序

### 维护状态

状态按钮使用 `data-status-filter`，值为：

```text
all | active | maintained | low | dormant | archived | unknown
```

按钮的 `aria-pressed` 表示当前选中状态。每次过滤时会重新计算「当前查询下各状态的数量」，因此搜索结果变化时状态按钮上的计数也会实时变化。

### 排序

排序值：

- `recent`：默认。按最近更新、Stars、名称排序。
- `stars`：按 Stars 降序。
- `name`：使用 `Intl.Collator("zh-Hans-CN")` 按名称排序。
- 所有排序模式都会先把已归档项目沉底，再应用具体排序规则。

排序通过重新 append DOM 节点实现，不重新渲染卡片。

## URL 状态

搜索、状态和排序会同步到当前页面的查询字符串：

```text
/?q=无人机&status=active&sort=stars
```

- 默认值不会写入 URL：空查询、`status=all`、`sort=recent` 会被删除。
- 使用 `history.replaceState`，不会为每次按键创建历史记录。
- 页面切换后 Swup 更新 URL，新页面重新读取参数。
- 分享带参数的链接可以恢复相同的筛选结果。

## 标签点击

卡片标签是 `<button data-search-tag="无人机">`。点击时：

1. 将搜索框设置为该标签；
2. 将状态重置为 `all`；
3. 应用过滤；
4. 聚焦搜索框，并在必要时滚动到目录区域。

标签按钮不使用链接，因此不会触发 Swup 导航。

## 键盘

| 按键           | 行为                       |
| -------------- | -------------------------- |
| `/`            | 聚焦搜索框（非输入状态时） |
| `Cmd/Ctrl + K` | 聚焦搜索框                 |
| `Escape`       | 有内容时清空；为空时失焦   |

输入框本身使用原生 `type="search"`，清空按钮有 `aria-label`。

## 结果反馈

- `[data-results-count]` 是 `aria-live="polite"` 区域，显示「共 N 个项目」或「显示 X / N 个项目」。
- 没有结果时显示 `[data-empty-state]`，并提供更短关键词或切换状态的提示。
- `noscript` 提示搜索需要 JavaScript，但全部项目仍然可见。

## Swup 生命周期

实现：`src/presentation/scripts/app.ts`。

```ts
const swup = new Swup({
  containers: ["#swup"],
  animationSelector: ".transition-main",
  plugins: [
    new SwupA11yPlugin(),
    new SwupHeadPlugin({ persistAssets: true, awaitAssets: true }),
    new SwupPreloadPlugin(),
    new SwupScrollPlugin(),
  ],
});
```

页面结构：

```html
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <div id="swup">
    <header>...</header>
    <main id="main" class="transition-main">...</main>
    <footer>...</footer>
  </div>
  <script type="module" src="..."></script>
</body>
```

关键点：

- Swup 只替换 `#swup`，主题类保存在 `<html>` 上，因此切页不会丢失主题。
- `page:view` 后先销毁旧 `CatalogController`，再挂载新控制器并同步主题按钮状态。
- 不在 `visit:start` 立即销毁，这样同页锚点或失败的导航不会让当前页搜索失效。
- Head 插件更新标题、meta 与样式资源；`persistAssets: true` 避免误删公共资源。
- A11y 插件负责页面播报与聚焦；滚动插件负责回到顶部/恢复历史位置。
- 全局 `/` 与 `Cmd/Ctrl + K` 监听只绑定一次。

## 页面过渡

CSS 位于 `global.css`：

```css
html.is-changing .transition-main {
  transition:
    opacity 220ms var(--ease-out),
    transform 220ms var(--ease-out);
}

html.is-animating .transition-main {
  opacity: 0;
  transform: translateY(8px);
}
```

- 只动画 `main`，避免导航与页脚闪烁。
- `prefers-reduced-motion: reduce` 下禁用所有过渡。
- 页面内容在 HTML 中已经存在，动画不是内容可见性的必要条件。

## 已知限制

- 搜索范围是当前页面渲染的项目。首页覆盖全部项目，分类页只覆盖当前分类。
- 没有模糊匹配或拼音匹配；当前使用子串 + 多 token AND。
- 项目规模达到数千时，DOM 过滤成本会上升，应改用预生成索引与虚拟列表。
- 标签点击会重置状态筛选，这是为了让结果可预期；如果希望保留状态，可修改 `CatalogController` 的标签分支。
