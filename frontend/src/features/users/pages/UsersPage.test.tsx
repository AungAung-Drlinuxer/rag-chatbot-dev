/**
 * UsersPage — the account directory, RBAC drawer and pagination.
 *
 * WHY RENDER INSTEAD OF UNIT-TEST HELPERS: the page exports only its component; its
 * load-bearing logic lives in render branches and in two normalisers that are NOT
 * exported — `normalizeRole` (backend "agent"/"admin" → the canonical display role) and
 * the paging window. Both are the kind of thing that breaks silently.
 *
 * The failure this guards: the backend capitalises `role_override` (agent → Agent) while
 * LDAP rows arrive as "IT Support", so an un-normalised role renders as a raw enum or as
 * the wrong badge. A second, quieter one: pagination that says "Showing 1 to 10" while
 * actually rendering every row.
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act() + direct DOM
 * queries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/users/api", () => ({
  listUsers: vi.fn(),
  listDepartments: vi.fn(),
  getUserPermissions: vi.fn(),
  setUserPassword: vi.fn(),
  createUser: vi.fn(),
  resetUserAccess: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserStatus: vi.fn(),
  assignableUsers: vi.fn(),
  getRbacMatrix: vi.fn(),
  putRbacMatrix: vi.fn(),
}));

import * as api from "@/features/users/api";
import Users from "./UsersPage";

const m = api as unknown as Record<string, any>;

const iso = () => new Date().toISOString();

function user(over: Record<string, any>) {
  return {
    id: "u-1", name: "Alice Anderson", username: "alice", email: "alice@corp.com",
    department: "IT Operations", role: "Administrator", status: "Active",
    groups: ["admins"], lastLogin: iso(), joined: iso(), source: "local",
    ...over,
  };
}

const USERS = [
  user({ id: "u-1", name: "Alice Anderson", username: "alice", role: "Administrator", status: "Active" }),
  // Backend enum spelling — must render as the canonical display role.
  user({ id: "u-2", name: "Bob Brown", username: "bob", email: "bob@corp.com", department: "Finance", role: "agent", status: "Inactive", lastLogin: "—", groups: [], source: "ad" }),
  user({ id: "u-3", name: "Carol Clark", username: "carol", email: "carol@corp.com", department: "—", role: "user", status: "Locked", groups: [] }),
  user({ id: "u-4", name: "Dave Diaz", username: "dave", email: "dave@corp.com", department: "IT Operations", role: "knowledge", status: "Active" }),
  user({ id: "u-5", name: "Backup Service", username: "backup-svc", email: "svc@corp.com", department: "Internal", role: "user", status: "Active" }),
  user({ id: "u-6", name: "Eve Evans", username: "eve", email: "eve@corp.com", role: "user" }),
  user({ id: "u-7", name: "Frank Ford", username: "frank", email: "frank@corp.com", role: "user" }),
  user({ id: "u-8", name: "Grace Green", username: "grace", email: "grace@corp.com", role: "user" }),
  user({ id: "u-9", name: "Henry Hall", username: "henry", email: "henry@corp.com", role: "user" }),
  user({ id: "u-10", name: "Ivy Ibarra", username: "ivy", email: "ivy@corp.com", role: "user" }),
  user({ id: "u-11", name: "Jack Jones", username: "jack", email: "jack@corp.com", role: "user" }),
  user({ id: "u-12", name: "Kate Klein", username: "kate", email: "kate@corp.com", role: "user" }),
];

function happyPath() {
  m.listUsers.mockResolvedValue({ users: USERS });
  m.listDepartments.mockResolvedValue({ departments: [{ name: "IT Operations" }, { name: "Finance" }] });
  m.getUserPermissions.mockResolvedValue({
    effective: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: true, manage_users: true, manage_domains: true },
  });
  m.updateUserRole.mockResolvedValue({ ok: true });
  m.updateUserStatus.mockResolvedValue({ status: "Active" });
  m.resetUserAccess.mockResolvedValue({ ok: true });
  m.setUserPassword.mockResolvedValue({ ok: true });
  m.createUser.mockResolvedValue({ ok: true });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Users />); });
  await settle();
  return container;
}

const button = (el: ParentNode, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

async function click(el: Element | undefined | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

const rowCount = (el: ParentNode) => el.querySelectorAll("tbody tr").length;

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("UsersPage — loading and the directory table", () => {
  it("shows skeleton rows while the directory is loading", async () => {
    m.listUsers.mockReturnValue(new Promise(() => {}));
    const el = await mount();
    expect(el.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(7);
  });

  it("renders the first page of users with name, handle and badges", async () => {
    const el = await mount();
    expect(rowCount(el)).toBe(10); // per-page window, not all 12
    const text = el.textContent!;
    expect(text).toContain("Alice Anderson");
    expect(text).toContain("@alice");
    expect(text).toContain("Administrator");
    expect(text).toContain("12 users"); // header badge
  });

  it("normalises backend role enums to the canonical display role", async () => {
    const el = await mount();
    // "agent" is a removed role: it must render as "User", never as a raw token and
    // never as the retired "IT Support" label.
    expect(el.textContent).not.toMatch(/\bagent\b/);
    expect(el.textContent).not.toContain("IT Support");
    expect(el.textContent).toContain("User");
  });

  it("flags a service account with the 'system' chip", async () => {
    const el = await mount();
    expect(el.textContent).toContain("backup-svc");
    expect(el.textContent).toContain("system");
  });

  it("counts total / active / inactive / locked from the loaded users", async () => {
    const el = await mount();
    const text = el.textContent!;
    expect(text).toContain("Total users");
    expect(text).toContain("Active");
    expect(text).toContain("Inactive");
    expect(text).toContain("Locked");
    // 10 active, 1 inactive, 1 locked, 12 total.
    expect(text).toContain("10");
    expect(text).toContain("Require admin action");
  });
});

describe("UsersPage — filtering, empty state and pagination", () => {
  it("filters by a search term across name / username / email", async () => {
    const el = await mount();
    const search = el.querySelector('input[aria-label="Search users"]') as HTMLInputElement;
    await typeInto(search, "carol");
    expect(rowCount(el)).toBe(1);
    expect(el.textContent).toContain("Carol Clark");
  });

  it("filters by status", async () => {
    const el = await mount();
    const select = el.querySelector('select[aria-label="Status"]') as HTMLSelectElement;
    await choose(select, "Locked");
    expect(rowCount(el)).toBe(1);
    expect(el.textContent).toContain("Carol Clark");
  });

  it("shows the empty state (with Clear filters) when nothing matches", async () => {
    const el = await mount();
    const search = el.querySelector('input[aria-label="Search users"]') as HTMLInputElement;
    await typeInto(search, "zzz-no-such-user");
    expect(el.textContent).toContain("No users found");
    const clear = button(el, "Clear filters");
    expect(clear).toBeTruthy();
    await click(clear);
    expect(rowCount(el)).toBe(10);
  });

  it("pages the list and reports the real window", async () => {
    const el = await mount();
    expect(el.textContent).toContain("Showing 1 to 10 of 12 users");
    await click(button(el, "›"));
    expect(el.textContent).toContain("Showing 11 to 12 of 12 users");
    expect(rowCount(el)).toBe(2);
  });
});

/** The detail panel is a Radix dialog now: it renders into a portal on document.body, so the
 *  assertions have to read the dialog node rather than the page container. */
function detailDialog(): HTMLElement {
  return document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
}

describe("UsersPage — the detail dialog", () => {
  it("opens the drawer with account info and effective permissions", async () => {
    const el = await mount();
    await click(button(el, "Alice Anderson"));
    const text = detailDialog().textContent!;
    expect(text).toContain("User details");
    expect(text).toContain("alice@corp.com");
    expect(text).toContain("Account type");
    expect(text).toContain("Local");
    expect(text).toContain("Current: Administrator");
    expect(text).toContain("Manage users");
    expect(m.getUserPermissions).toHaveBeenCalledWith("alice");
  });

  it("previews a role change and saves it through updateUserRole", async () => {
    const el = await mount();
    await click(button(el, "Alice Anderson"));
    const roleSelect = detailDialog().querySelector('select[aria-label="Role"]') as HTMLSelectElement;
    await choose(roleSelect, "User");
    expect(detailDialog().textContent).toContain("Preview: User");
    const save = button(detailDialog(), "Save changes")!;
    await click(save);
    expect(m.updateUserRole).toHaveBeenCalledWith("alice", "User");
    // Saving is the end of the edit: the drawer closes instead of sitting there submitted.
    expect(detailDialog()).toBeNull();
  });

  it("treats a directory-sourced account as AD-managed (no local password form)", async () => {
    const el = await mount();
    await click(button(el, "Bob Brown"));
    const text = detailDialog().textContent!;
    expect(text).toContain("Managed by Active Directory");
    expect(text).not.toContain("Update password");
  });

  it("offers the local password form for a local account and refuses a short password", async () => {
    const el = await mount();
    await click(button(el, "Alice Anderson"));
    expect(detailDialog().textContent).toContain("Update password");
    const pw = detailDialog().querySelector('input[aria-label="New password"]') as HTMLInputElement;
    await typeInto(pw, "short");
    const update = button(detailDialog(), "Update password") as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    await typeInto(pw, "longenough1");
    await click(button(detailDialog(), "Update password"));
    expect(m.setUserPassword).toHaveBeenCalledWith("alice", "longenough1");
  });
});
