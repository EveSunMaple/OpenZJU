const NAV_SELECTOR = ".site-nav";
const LINK_SELECTOR = ".site-nav__link";
const INDICATOR_SELECTOR = ".site-nav__indicator";
const ACTIVE_SELECTOR = `${LINK_SELECTOR}[aria-current="page"]`;

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function syncActiveLink(nav: HTMLElement): void {
  const currentPath = normalizePath(window.location.pathname);

  for (const link of nav.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)) {
    const href = link.getAttribute("href") ?? "/";
    const linkPath = normalizePath(new URL(href, window.location.href).pathname);

    if (linkPath === currentPath) {
      link.setAttribute("aria-current", "page");
      continue;
    }

    link.removeAttribute("aria-current");
  }
}

function placeIndicator(nav: HTMLElement, animate: boolean): void {
  const indicator = nav.querySelector<HTMLElement>(INDICATOR_SELECTOR);
  const activeLink = nav.querySelector<HTMLElement>(ACTIVE_SELECTOR);

  if (!indicator) {
    return;
  }

  if (!activeLink) {
    indicator.style.opacity = "0";
    return;
  }

  const navRect = nav.getBoundingClientRect();
  const linkRect = activeLink.getBoundingClientRect();

  if (!animate) {
    // Reposition without transitions (first paint, resize, font swap).
    indicator.style.transition = "none";
  }

  indicator.style.setProperty("--nav-indicator-x", `${linkRect.left - navRect.left}px`);
  indicator.style.setProperty("--nav-indicator-width", `${linkRect.width}px`);
  indicator.style.opacity = "1";

  if (!animate) {
    void nav.offsetWidth;
    indicator.style.removeProperty("transition");
  }
}

export function syncSiteNav(animate = true): void {
  const nav = document.querySelector<HTMLElement>(NAV_SELECTOR);

  if (!nav) {
    return;
  }

  syncActiveLink(nav);
  placeIndicator(nav, animate);
}

export function initSiteNav(): void {
  // The header lives outside the swup container, so the indicator survives navigation
  // and only has to slide from the previous item to the new one.
  syncSiteNav(false);

  window.addEventListener("resize", () => syncSiteNav(false));
  window.addEventListener("orientationchange", () => syncSiteNav(false));

  void document.fonts.ready.then(() => syncSiteNav(false));
}
