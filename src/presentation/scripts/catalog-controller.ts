import { matchesSearch } from "@/application/search";

const SORT_MODES = ["recent", "stars", "name"] as const;

type SortMode = (typeof SORT_MODES)[number];

function isSortMode(value: string | null): value is SortMode {
  return SORT_MODES.includes(value as SortMode);
}

function readCardNumber(card: HTMLElement, key: string): number {
  const value = Number.parseInt(card.dataset[key] ?? "", 10);

  return Number.isNaN(value) ? -1 : value;
}

export class CatalogController {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement | null;
  private readonly clearButton: HTMLButtonElement | null;
  private readonly grid: HTMLElement | null;
  private readonly cards: HTMLElement[];
  private readonly emptyState: HTMLElement | null;
  private readonly resultsCount: HTMLElement | null;
  private readonly statusButtons: HTMLButtonElement[];
  private readonly statusCounts: Map<HTMLButtonElement, HTMLElement | null>;
  private readonly sortSelect: HTMLSelectElement | null;
  private readonly abortController = new AbortController();

  private query = "";
  private status = "all";
  private sort: SortMode = "recent";
  private composing = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.input = root.querySelector<HTMLInputElement>("[data-search-input]");
    this.clearButton = root.querySelector<HTMLButtonElement>("[data-search-clear]");
    this.grid = root.querySelector<HTMLElement>("[data-project-grid]");
    this.cards = this.grid
      ? Array.from(this.grid.querySelectorAll<HTMLElement>("[data-project-card]"))
      : [];
    this.emptyState = root.querySelector<HTMLElement>("[data-empty-state]");
    this.resultsCount = root.querySelector<HTMLElement>("[data-results-count]");
    this.statusButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>("[data-status-filter]"),
    );
    this.statusCounts = new Map(
      this.statusButtons.map((button) => [
        button,
        button.querySelector<HTMLElement>("[data-status-count]"),
      ]),
    );
    this.sortSelect = root.querySelector<HTMLSelectElement>("[data-sort]");
  }

  init(): void {
    this.restoreFromUrl();
    this.bindEvents();
    this.sortCards();
    this.applyFilters();
  }

  destroy(): void {
    this.abortController.abort();
  }

  focusSearch(): void {
    if (!this.input) {
      return;
    }

    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);

    if (this.input.getBoundingClientRect().top < 0) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      this.root.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  private bindEvents(): void {
    const { signal } = this.abortController;

    this.input?.addEventListener(
      "input",
      () => {
        if (this.composing) {
          return;
        }

        this.query = this.input?.value ?? "";
        this.applyFilters();
      },
      { signal },
    );

    this.input?.addEventListener(
      "compositionstart",
      () => {
        this.composing = true;
      },
      { signal },
    );

    this.input?.addEventListener(
      "compositionend",
      () => {
        this.composing = false;
        this.query = this.input?.value ?? "";
        this.applyFilters();
      },
      { signal },
    );

    this.clearButton?.addEventListener(
      "click",
      () => {
        this.query = "";
        if (this.input) {
          this.input.value = "";
          this.input.focus();
        }
        this.applyFilters();
      },
      { signal },
    );

    this.input?.addEventListener(
      "keydown",
      (event) => {
        if (event.isComposing || event.key !== "Escape") {
          return;
        }

        event.preventDefault();

        if (this.input && this.input.value.length > 0) {
          this.query = "";
          this.input.value = "";
          this.applyFilters();
        } else {
          this.input?.blur();
        }
      },
      { signal },
    );

    for (const button of this.statusButtons) {
      button.addEventListener(
        "click",
        () => {
          this.status = button.dataset.statusFilter ?? "all";
          this.applyFilters();
        },
        { signal },
      );
    }

    this.sortSelect?.addEventListener(
      "change",
      () => {
        const value = this.sortSelect?.value ?? "recent";
        this.sort = isSortMode(value) ? value : "recent";
        this.sortCards();
        this.syncUrl();
      },
      { signal },
    );

    this.root.addEventListener(
      "click",
      (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
          return;
        }

        const tagButton = target.closest<HTMLElement>("[data-search-tag]");

        if (!tagButton) {
          return;
        }

        const tag = tagButton.dataset.searchTag ?? "";

        if (!tag) {
          return;
        }

        event.preventDefault();
        this.query = tag;
        this.status = "all";

        if (this.input) {
          this.input.value = tag;
        }

        this.applyFilters();
        this.focusSearch();
      },
      { signal },
    );
  }

  private restoreFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") ?? "";
    const status = params.get("status") ?? "all";
    const sort = params.get("sort");

    this.query = query;
    this.status = this.statusButtons.some((button) => button.dataset.statusFilter === status)
      ? status
      : "all";
    this.sort = isSortMode(sort) ? sort : "recent";

    if (this.input) {
      this.input.value = query;
    }

    if (this.sortSelect) {
      this.sortSelect.value = this.sort;
    }
  }

  private matchesCard(card: HTMLElement): boolean {
    return matchesSearch(card.dataset.search ?? "", this.query);
  }

  private applyCardFilter(card: HTMLElement, queryMatches: Map<string, number>): boolean {
    const queryMatch = this.matchesCard(card);
    const status = card.dataset.status ?? "unknown";
    const isVisible = queryMatch && (this.status === "all" || status === this.status);

    card.hidden = !isVisible;

    if (queryMatch) {
      queryMatches.set(status, (queryMatches.get(status) ?? 0) + 1);
    }

    return isVisible;
  }

  private renderResults(visible: number): void {
    const total = this.cards.length;

    if (this.resultsCount) {
      this.resultsCount.textContent =
        visible === total ? `共 ${total} 个项目` : `显示 ${visible} / ${total} 个项目`;
    }

    if (this.emptyState) {
      this.emptyState.hidden = visible !== 0;
    }
  }

  private statusCount(value: string, queryMatches: Map<string, number>): number {
    if (value === "all") {
      return [...queryMatches.values()].reduce((total, count) => total + count, 0);
    }

    return queryMatches.get(value) ?? 0;
  }

  private renderStatusCounts(queryMatches: Map<string, number>): void {
    for (const button of this.statusButtons) {
      const value = button.dataset.statusFilter ?? "all";
      const countElement = this.statusCounts.get(button);

      if (countElement) {
        countElement.textContent = String(this.statusCount(value, queryMatches));
      }

      button.setAttribute("aria-pressed", String(value === this.status));
    }
  }

  private applyFilters(): void {
    const queryMatches = new Map<string, number>();
    let visible = 0;

    for (const card of this.cards) {
      if (this.applyCardFilter(card, queryMatches)) {
        visible += 1;
      }
    }

    this.renderResults(visible);
    this.renderStatusCounts(queryMatches);

    if (this.clearButton) {
      this.clearButton.hidden = this.query.length === 0;
    }

    this.syncUrl();
  }

  private sortCards(): void {
    if (!this.grid) {
      return;
    }

    const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
    const sorted = [...this.cards].sort((a, b) => {
      const aArchived = a.dataset.archived === "true";
      const bArchived = b.dataset.archived === "true";

      if (aArchived !== bArchived) {
        return aArchived ? 1 : -1;
      }

      if (this.sort === "name") {
        return collator.compare(a.dataset.name ?? "", b.dataset.name ?? "");
      }

      if (this.sort === "stars") {
        return (
          readCardNumber(b, "stars") - readCardNumber(a, "stars") ||
          collator.compare(a.dataset.name ?? "", b.dataset.name ?? "")
        );
      }

      return (
        readCardNumber(b, "updated") - readCardNumber(a, "updated") ||
        readCardNumber(b, "stars") - readCardNumber(a, "stars") ||
        collator.compare(a.dataset.name ?? "", b.dataset.name ?? "")
      );
    });

    this.grid.append(...sorted);
  }

  private syncUrl(): void {
    const params = new URLSearchParams(window.location.search);

    if (this.query.trim().length > 0) {
      params.set("q", this.query.trim());
    } else {
      params.delete("q");
    }

    if (this.status !== "all") {
      params.set("status", this.status);
    } else {
      params.delete("status");
    }

    if (this.sort !== "recent") {
      params.set("sort", this.sort);
    } else {
      params.delete("sort");
    }

    const search = params.toString();
    const query = search ? `?${search}` : "";
    const nextUrl = `${window.location.pathname}${query}${window.location.hash}`;

    window.history.replaceState({}, "", nextUrl);
  }
}
