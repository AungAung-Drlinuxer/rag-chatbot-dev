import { afterEach, describe, expect, it } from "vitest";
import { loadMeSync, saveMeCache } from "./client";

/**
 * The identity/capability cache exists for one reason: the sidebar is drawn from
 * `permissions`, and on refresh it used to be drawn from an empty object first — every
 * menu entry appeared, then the role's restriction landed a second later.
 *
 * These tests pin the contract the first paint depends on: what was saved is what is
 * read back, and anything malformed reads as "nothing cached" (which renders a smaller
 * menu, never a permissive one).
 */
describe("me cache", () => {
  afterEach(() => sessionStorage.clear());

  const ME = {
    role: "user",
    displayRole: "User",
    permissions: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: false },
  };

  it("round-trips exactly what was saved", () => {
    saveMeCache(ME);
    expect(loadMeSync()).toEqual(ME);
  });

  it("returns null when nothing is cached", () => {
    expect(loadMeSync()).toBeNull();
  });

  it("treats malformed JSON as no cache", () => {
    sessionStorage.setItem("me", "{not json");
    expect(loadMeSync()).toBeNull();
  });

  it("treats a payload without permissions as no cache", () => {
    // A permissive fallback here would re-create the flash for a corrupted entry.
    sessionStorage.setItem("me", JSON.stringify({ role: "admin" }));
    expect(loadMeSync()).toBeNull();
  });
});
