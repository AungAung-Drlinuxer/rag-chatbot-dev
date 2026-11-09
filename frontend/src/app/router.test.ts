/**
 * URL contract: the app root is `#/`, every other page is `#/<id>`, and anything unknown
 * falls back to chat. Logout must not leave a protected page in the address bar.
 */
import { describe, expect, it } from "vitest";

import { hashToNav, pathForNav } from "@/app/router";

describe("hashToNav", () => {
  it("maps the root and empty hash to chat", () => {
    expect(hashToNav("")).toBe("chat");
    expect(hashToNav("#/")).toBe("chat");
    expect(hashToNav("#")).toBe("chat");
  });

  it("maps a page hash to its id", () => {
    expect(hashToNav("#/settings")).toBe("settings");
    expect(hashToNav("#/users")).toBe("users");
    expect(hashToNav("#/audits")).toBe("audits");
  });

  it("ignores query strings and unknown pages", () => {
    expect(hashToNav("#/sso?code=abc")).toBe("chat");
    expect(hashToNav("#/nope")).toBe("chat");
  });
});

describe("pathForNav", () => {
  it("writes the root for chat and a real path for the rest", () => {
    expect(pathForNav("chat")).toBe("#/");
    expect(pathForNav("settings")).toBe("#/settings");
    expect(pathForNav("bogus")).toBe("#/");
  });

  it("round-trips every page", () => {
    for (const id of ["chat", "dashboard", "articles", "tickets", "domains", "users", "history", "audits", "settings"]) {
      expect(hashToNav(pathForNav(id))).toBe(id);
    }
  });
});
