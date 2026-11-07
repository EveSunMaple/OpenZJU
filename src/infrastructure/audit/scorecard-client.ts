const SCORECARD_API_URL = "https://api.securityscorecards.dev/projects/github.com";
const REQUEST_TIMEOUT_MS = 15_000;

interface ScorecardApiResult {
  date?: string;
  score?: number;
}

export interface ScorecardSignal {
  readonly score: number;
  readonly date: string | null;
}

export class ScorecardClient {
  readonly #fetch: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async fetch(repo: string): Promise<ScorecardSignal | null> {
    try {
      const response = await this.#fetch(`${SCORECARD_API_URL}/${repo}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "zju-open-source-atlas/1.0",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as ScorecardApiResult;

      if (typeof data.score !== "number" || data.score < 0) {
        return null;
      }

      return {
        score: data.score,
        date: typeof data.date === "string" ? data.date : null,
      };
    } catch {
      return null;
    }
  }
}
