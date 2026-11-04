export const THEME_STORAGE_KEY = "zju-atlas-theme";

export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

const MODE_LABELS: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "白天模式",
  dark: "黑夜模式",
};

const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

function isThemeMode(value: string | null): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

export function getThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    return isThemeMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return darkMedia.matches ? "dark" : "light";
  }

  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    document.documentElement.dataset.themeMode = mode;
  }

  applyTheme(mode);
  syncThemeToggle();
}

export function syncThemeToggle(): void {
  const mode = getThemeMode();
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-theme-option]");

  for (const button of buttons) {
    const option = button.dataset.themeOption;

    if (!option || !isThemeMode(option)) {
      continue;
    }

    const isActive = option === mode;
    const label = MODE_LABELS[option];

    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", isActive ? `${label}（当前）` : label);
    button.setAttribute("title", label);
  }
}

export function initTheme(): void {
  applyTheme(getThemeMode());

  document.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const option = target.closest<HTMLElement>("[data-theme-option]")?.dataset.themeOption;

    if (option && isThemeMode(option)) {
      event.preventDefault();
      setThemeMode(option);
    }
  });

  const handleSystemChange = () => {
    if (getThemeMode() === "system") {
      applyTheme("system");
      syncThemeToggle();
    }
  };

  darkMedia.addEventListener("change", handleSystemChange);

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY) {
      applyTheme(getThemeMode());
      syncThemeToggle();
    }
  });

  syncThemeToggle();
}
