/**
 * URL contract: the app root is `#/`, every other page is `#/<id>`, and anything unknown
 * falls back to chat. Logout must not leave a protected page in the address bar.
 */
import { describe, expect, it } from "vitest";

import { conversationFromHash, hashToNav, pathForNav, setConversationHash } from "@/app/router";

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

describe("conversation in the hash", () => {
  it("reads the open conversation and still resolves to the chat page", () => {
    expect(conversationFromHash("#/?c=8f14e45f-ceea-467a-9575-8c0f0b1d9a1e")).toBe("8f14e45f-ceea-467a-9575-8c0f0b1d9a1e");
    expect(hashToNav("#/?c=8f14e45f-ceea-467a-9575-8c0f0b1d9a1e")).toBe("chat");
  });

  it("has no conversation on a bare chat or another page", () => {
    expect(conversationFromHash("#/")).toBeNull();
    expect(conversationFromHash("")).toBeNull();
    expect(conversationFromHash("#/settings")).toBeNull();
    expect(conversationFromHash("#/settings?c=abc")).toBeNull();
  });

  it("writes and clears the conversation without growing the history stack", () => {
    window.location.hash = "#/";
    const before = window.history.length;

    setConversationHash("abc-123");
    expect(window.location.hash).toBe("#/?c=abc-123");
    expect(conversationFromHash()).toBe("abc-123");

    setConversationHash(null);
    expect(window.location.hash).toBe("#/");
    expect(conversationFromHash()).toBeNull();
    expect(window.history.length).toBe(before);
  });
});
