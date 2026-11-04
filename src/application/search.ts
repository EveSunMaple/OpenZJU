export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replaceAll(/\s+/g, " ").trim();
}

export function tokenizeQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);

  return normalized.length === 0 ? [] : normalized.split(" ");
}

export function matchesSearch(haystack: string, query: string): boolean {
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) {
    return true;
  }

  const normalizedHaystack = normalizeSearchText(haystack);

  return tokens.every((token) => normalizedHaystack.includes(token));
}

export interface SearchableDocument {
  readonly searchText: string;
  readonly status: string;
}

export function matchesDocument(
  document: SearchableDocument,
  query: string,
  status = "all",
): boolean {
  if (status !== "all" && document.status !== status) {
    return false;
  }

  return matchesSearch(document.searchText, query);
}
