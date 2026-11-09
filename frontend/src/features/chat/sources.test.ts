import { describe, expect, it } from "vitest";

import { toSources } from "./sources";

/** The answer card once showed sources with no link at all, because it read `url`
 *  while the API sends `source_url`, and a "0.5% match" that was really the raw
 *  relevance 0.5 read as a percentage. These are the two facts that must hold. */
describe("toSources", () => {
  it("maps the API's source_url to url so the card can link out", () => {
    const [s] = toSources([
      {
        page_id: "98592",
        title: "VPN Connection Failure",
        source_url: "https://example.atlassian.net/wiki/spaces/IHKB/pages/98592",
        relevance: 0.687,
      },
    ]);
    expect(s.url).toBe("https://example.atlassian.net/wiki/spaces/IHKB/pages/98592");
    expect(s.page_id).toBe("98592");
  });

  it("turns a 0..1 relevance into a whole percentage", () => {
    const [s] = toSources([{ title: "A", relevance: 0.687 }]);
    expect(s.relevance).toBe(69);
  });

  it("accepts a 0..1 score as well (widget payloads)", () => {
    const [s] = toSources([{ title: "A", score: 0.92 }]);
    expect(s.relevance).toBe(92);
  });

  it("leaves relevance null when the retriever sent no score", () => {
    const [s] = toSources([{ title: "A", relevance: null }]);
    expect(s.relevance).toBeNull();
  });

  it("survives junk without throwing", () => {
    expect(toSources(undefined)).toEqual([]);
    expect(toSources("nope")).toEqual([]);
    const [s] = toSources([{}]);
    expect(s.title).toBe("Knowledge source");
    expect(s.url).toBeNull();
  });
});
