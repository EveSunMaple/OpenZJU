const COUNTER_ENDPOINT = "https://busuanzi.ibruce.info/busuanzi";

interface BusuanziPayload {
  site_pv?: number;
  site_uv?: number;
}

let callbackSequence = 0;

function applyPayload(root: HTMLElement, payload: BusuanziPayload): void {
  const items: Array<[string, number | undefined]> = [
    ["[data-view-pv]", payload.site_pv],
    ["[data-view-uv]", payload.site_uv],
  ];

  for (const [selector, value] of items) {
    const target = root.querySelector<HTMLElement>(selector);

    if (!target || typeof value !== "number") {
      continue;
    }

    target.textContent = value.toLocaleString("zh-CN");
    target.closest<HTMLElement>("[data-view-item]")?.removeAttribute("hidden");
  }
}

/**
 * 不蒜子的公开 JSONP 接口：每次请求都会记一次浏览量，并按第三方 cookie 计算访客。
 * 每个页面视图请求一次，所以 Swup 的站内跳转也会被计入。
 */
export function loadViewCounter(): void {
  const root = document.querySelector<HTMLElement>("[data-view-counter]");

  if (!root) {
    return;
  }

  const callbackName = `BusuanziCallback_${Math.floor(
    Math.random() * 1_099_511_627_776,
  )}${callbackSequence++}`;
  const registry = window as unknown as Record<string, unknown>;
  const script = document.createElement("script");

  const cleanup = (): void => {
    script.remove();
    delete registry[callbackName];
  };

  registry[callbackName] = (payload: BusuanziPayload) => {
    applyPayload(root, payload);
    cleanup();
  };

  script.src = `${COUNTER_ENDPOINT}?jsonpCallback=${callbackName}`;
  script.async = true;
  script.addEventListener("error", cleanup, { once: true });
  document.head.append(script);
}
