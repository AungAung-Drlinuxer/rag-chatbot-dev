import { describe, it, expect } from "vitest";
import { denied } from "./acl";

/** A plain user's permission map, as /api/me returns it. */
const USER = {
  chatbot: true, kb_search: true, create_tickets: false,
  manage_kb: false, manage_users: false, manage_domains: false,
};
const ADMIN = {
  chatbot: true, kb_search: true, create_tickets: true,
  manage_kb: true, manage_users: true, manage_domains: true,
};

describe("page ACL", () => {
  it("blocks the admin pages for a plain user", () => {
    for (const nav of ["users", "history", "audits", "domains"]) {
      expect(denied(nav, USER)?.cap).toBeTruthy();
    }
  });

  it("names the capability that is missing, not the page", () => {
    expect(denied("users", USER)).toEqual({
      cap: "manage_users", label: "Manage users, roles & settings",
    });
    expect(denied("domains", USER)?.cap).toBe("manage_domains");
  });

  it("lets an administrator through", () => {
    for (const nav of ["users", "history", "audits", "domains"]) {
      expect(denied(nav, ADMIN)).toBeNull();
    }
  });

  it("never blocks a page that needs no capability", () => {
    for (const nav of ["chat", "dashboard", "articles", "tickets", "settings"]) {
      expect(denied(nav, USER)).toBeNull();
    }
  });

  it("does not block while permissions are still loading", () => {
    // /api/me has not answered yet: undefined must mean "unknown", not "denied" —
    // otherwise every reload flashes Access restricted before the page appears.
    expect(denied("users", undefined)).toBeNull();
    expect(denied("users", {})).toBeNull();
    expect(denied("users", { manage_users: true })).toBeNull();
  });

  it("knows the knowledge manager keeps domains but not user management", () => {
    const KM = { ...USER, manage_kb: true, manage_domains: true };
    expect(denied("domains", KM)).toBeNull();
    expect(denied("users", KM)?.cap).toBe("manage_users");
  });
});
