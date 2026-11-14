import SwupA11yPlugin from "@swup/a11y-plugin";
import SwupHeadPlugin from "@swup/head-plugin";
import SwupPreloadPlugin from "@swup/preload-plugin";
import SwupScrollPlugin from "@swup/scroll-plugin";
import { inject } from "@vercel/analytics";
import Swup from "swup";
import { CatalogController } from "./catalog-controller";
import { initSiteNav, syncSiteNav } from "./site-nav";
import { initTheme, syncThemeToggle } from "./theme";

let catalogController: CatalogController | null = null;

function mountCatalog(): void {
  catalogController?.destroy();

  const root = document.querySelector<HTMLElement>("[data-catalog]");
  catalogController = root ? new CatalogController(root) : null;
  catalogController?.init();
}

function handleSearchJump(event: MouseEvent): void {
  const target = event.target;

  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(target instanceof Element)
  ) {
    return;
  }

  if (!target.closest("[data-search-jump]")) {
    return;
  }

  const catalog = document.querySelector<HTMLElement>("[data-catalog]");
  const input = catalog?.querySelector<HTMLInputElement>("[data-search-input]");

  if (!catalog || !input) {
    return;
  }

  event.preventDefault();
  catalogController?.focusSearch();
}

function handleSearchShortcut(event: KeyboardEvent): void {
  if (event.isComposing) {
    return;
  }

  const target = event.target;
  const isEditable =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT");

  const isSlash = event.key === "/" && !isEditable;
  const isCommandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

  if (!isSlash && !isCommandK) {
    return;
  }

  event.preventDefault();
  catalogController?.focusSearch();
}

initTheme();
mountCatalog();
syncThemeToggle();
initSiteNav();

// 仅在构建产物里注入：开发服务器不会请求 /_vercel/insights/script.js。
if (import.meta.env.PROD) {
  inject({ mode: "production" });
}

document.addEventListener("keydown", handleSearchShortcut);
document.addEventListener("click", handleSearchJump);

const swup = new Swup({
  containers: ["#swup"],
  animationSelector: ".transition-main",
  plugins: [
    new SwupA11yPlugin(),
    new SwupHeadPlugin({
      persistAssets: true,
      awaitAssets: true,
    }),
    new SwupPreloadPlugin(),
    new SwupScrollPlugin(),
  ],
});

swup.hooks.on("page:view", () => {
  mountCatalog();
  syncThemeToggle();
  syncSiteNav();
});
