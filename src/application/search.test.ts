import { describe, expect, it } from "vitest";
import { matchesDocument, matchesSearch, normalizeSearchText, tokenizeQuery } from "./search";

describe("normalizeSearchText", () => {
  it("normalizes width, case and whitespace", () => {
    expect(normalizeSearchText("  ＺＪＵ   Open   Source  ")).toBe("zju open source");
  });
});

describe("tokenizeQuery", () => {
  it("splits on whitespace and removes empty tokens", () => {
    expect(tokenizeQuery("  无人机   轨迹  ")).toEqual(["无人机", "轨迹"]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("matches every token against the haystack", () => {
    const haystack = "EGO-Planner 无人机 轨迹规划 机器人";

    expect(matchesSearch(haystack, "无人机")).toBe(true);
    expect(matchesSearch(haystack, "无人机 机器人")).toBe(true);
    expect(matchesSearch(haystack, "无人机 数据库")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesSearch("anything", "")).toBe(true);
  });
});

describe("matchesDocument", () => {
  const document = {
    searchText: "ZJU Connect RVPN 校园网 Go",
    status: "active",
  };

  it("combines query and status filters", () => {
    expect(matchesDocument(document, "rvpn", "active")).toBe(true);
    expect(matchesDocument(document, "rvpn", "dormant")).toBe(false);
    expect(matchesDocument(document, "rvpn", "all")).toBe(true);
  });
});
