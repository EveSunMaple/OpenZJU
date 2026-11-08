import SwupA11yPlugin from "@swup/a11y-plugin";
import SwupHeadPlugin from "@swup/head-plugin";
import SwupPreloadPlugin from "@swup/preload-plugin";
import SwupScrollPlugin from "@swup/scroll-plugin";
import Swup from "swup";
import { CatalogController } from "./catalog-controller";
import { initSiteNav, syncSiteNav } from "./site-nav";
import { initTheme, syncThemeToggle } from "./theme";
import { loadViewCounter } from "./view-counter";

let catalogController: CatalogController | null = null;

function mountCatalog(): void {
  catalogController?.destroy();

  const root = document.querySelector<HTMLElement>("[data-catalog]");
  catalogController = root ? new CatalogController(root) : null;
  catalogController?.init();
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
loadViewCounter();

document.addEventListener("keydown", handleSearchShortcut);

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
  loadViewCounter();
});
