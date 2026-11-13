import {
  AtSign,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock,
  Laptop,
  Mail,
  AlertTriangle,
  Check,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  Shield,
  Trash2,
  UserCheck,
  UserCog,
  Users as UsersIcon,
  UserX,
  X,
} from "lucide-react";

import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import { downloadCsv, printReport as printReportSheet } from "@/shared/report";
import { ReportActions } from "@/shared/ReportActions";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import {
  syncDirectory,
  restoreUser,
  purgeUser,
  listUsers,
  getUserPermissions,
  createUser as createUserApi,
  resetUserAccess,
  updateUserRole,
  updateUserStatus,
} from "@/features/users/api";
import {
  LocalPasswordForm,
  MetaGrid,
  MetaItem,
  NoticeCard,
  PermissionMatrix,
  SectionHeading,
} from "@/features/users/components/UserDetailParts";

/* ============================================================
   TYPES
============================================================ */

type UserStatus = "Active" | "Inactive" | "Locked" | "Disabled" | "Pending";

// v1.1.1 — Domain Manager merged into Knowledge Manager (Knowledge page owns
// both KB articles and the Domains & Routing engine).
type UserRole =
  | "Administrator"
  | "Knowledge Manager"
  | "User";

type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  department: string;
  role: UserRole;
  roleOverride?: string | null;
  status: UserStatus;
  groups: string[];
  lastLogin: string;
  joined: string;
  source?: "ad" | "local";
  /** Directory lifecycle: active | suspended (disabled in AD) | removed (gone from AD). */
  state?: "active" | "suspended" | "removed";
  directoryLinked?: boolean;
  /** Which identity provider owns the account: AD/LDAP, a local password, or Keycloak SSO. */
  identitySource?: "ldap" | "local" | "sso";
  removedAt?: string | null;
};

type PermissionKey =
  | "chatbot"
  | "kb_search"
  | "create_tickets"
  | "manage_kb"
  | "manage_users"
  | "manage_domains";

type PermissionMap = Record<PermissionKey, boolean>;

// v1.3.6 — "Manage routing domains" merged into "Manage knowledge": the Knowledge
// page hosts BOTH article management AND routing-domain management, so one
// capability (manage_kb) governs both. manage_domains stays as a backend alias
// (granted whenever manage_kb is granted) for DB compatibility.
const RBAC_CAPABILITIES: { key: PermissionKey; label: string }[] = [
  { key: "chatbot", label: "Access chatbot" },
  { key: "kb_search", label: "Search knowledge base" },
  { key: "create_tickets", label: "Create tickets" },
  { key: "manage_kb", label: "Manage knowledge & routing domains" },
  { key: "manage_users", label: "Manage users" },
];

const EMPTY_PERMISSIONS: PermissionMap = {
  chatbot: false,
  kb_search: false,
  create_tickets: false,
  manage_kb: false,
  manage_users: false,
  manage_domains: false,
};

/* Role descriptions — shown in the role dropdown so admins pick correctly */
const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Administrator: "Full control: users, KB, domains, tickets, settings",
  "Knowledge Manager": "Chat, search, create tickets, manage KB & routing domains",
  User: "Chat, search the knowledge base, create tickets",
};

/* Normalize any backend/local variant (Agent, Admin, agent, IT Support…) to the
   canonical display role used across the UI. Backend /api/users capitalizes the
   role_override (agent -> Agent, admin -> Admin), LDAP-derived rows may be
   "Knowledge Manager"/"Administrator", and overrides may be raw enum keys. An old
   "IT Support" value is read as User, because that role no longer exists. */
const ROLE_ALIASES: Record<string, UserRole> = {
  // The IT Support role was removed; its accounts are plain users (least privilege).
  "agent": "User",
  "admin": "Administrator",
  "administrator": "Administrator",
  "knowledge": "Knowledge Manager",
  "knowledge manager": "Knowledge Manager",
  // legacy merged role — domain manager == Knowledge Manager
  "domain_manager": "Knowledge Manager",
  "domain manager": "Knowledge Manager",
  "it support": "User",
  "user": "User",
};

function normalizeRole(raw: string | null | undefined): UserRole {
  const key = (raw || "").trim().toLowerCase();
  return ROLE_ALIASES[key] ?? (([ "Administrator", "Knowledge Manager", "User" ].includes(raw || "") ? raw : "User") as UserRole);
}

/* Canonical role → permission defaults (matches backend /api/rbac/matrix) */
const ROLE_DEFAULTS: Record<UserRole, PermissionMap> = {
  Administrator: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: true, manage_users: true, manage_domains: true },
  "Knowledge Manager": { chatbot: true, kb_search: true, create_tickets: true, manage_kb: true, manage_users: false, manage_domains: true },
  User: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: false, manage_users: false, manage_domains: false },
};

/* Avatar tones — a deterministic colour per person, so two rows are told apart
   at a glance. Presentation only; nothing here is derived from account data. */
const AVATAR_TONES = [
  "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
];

function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/* ============================================================
   PAGE

   Layout follows the Workspace / Users mockup: breadcrumb + eyebrow + H1,
   secondary/secondary/PRIMARY action row, four equal summary cards, then ONE
   "Workspace members" panel (heading + count badge, search/filter toolbar, the
   directory table, a range + pager footer) and a muted note underneath.

   Colours are the app's design tokens (--primary #0048F0, --border, --accent,
   --muted) rather than the mockup's literal hexes: the mockup is dark-only and
   this page has to work in both themes.
============================================================ */

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<User | null>(null);
  const [purging, setPurging] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  function notify(msg: string, kind: "ok" | "err" = "ok") {
    setNotice({ msg, kind });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* v0.21.80 — responsive pagination (real, not decorative) */
  const [page, setPage] = useState(1);
  /* Ten per page, fixed: the same unit as Conversations and the Audit log. A page-size
     selector made three lists that could not be compared page for page. */
  const perPage = 10;

  async function loadUsers(showRefresh = false, includeRemoved = statusFilter === "Removed") {
    if (showRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await listUsers(includeRemoved);
      setUsers(((data.users ?? data ?? []) as User[]).map((u) => ({ ...u, role: normalizeRole(u.role as string) })));
    } catch (err: any) {
      // A swallowed failure used to render the EMPTY state, which says "no users
      // exist" when the truth is "the directory could not be read".
      console.warn("users fetch failed:", err);
      setError(err?.message || "Could not reach the user directory.");
      setUsers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        // "Removed" is the only view that needs tombstoned rows; every other view keeps
        // them out so the head count matches what people expect to see.
        const data = await listUsers(statusFilter === "Removed");
        if (mounted) setUsers(((data.users ?? data ?? []) as User[]).map((u) => ({ ...u, role: normalizeRole(u.role as string) })));
      } catch (err: any) {
        console.warn("users fetch failed:", err);
        if (mounted) setError(err?.message || "Could not reach the user directory.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [statusFilter]);

  /* Every figure below is counted from the list this page already loaded —
     nothing is fetched twice and nothing is estimated. */
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.status === "Active").length;
  const adminUsers = users.filter((u) => u.role === "Administrator").length;
  const inactiveUsers = users.filter((u) => u.status !== "Active").length;
  const lockedUsers = users.filter((u) => u.status === "Locked").length;

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.name.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "Removed"
        ? user.state === "removed"
        : statusFilter === "All" || user.status === statusFilter;
      const matchesRole = roleFilter === "All" || user.role === roleFilter;
      const matchesDepartment = departmentFilter === "All" || user.department === departmentFilter;
      return matchesSearch && matchesStatus && matchesRole && matchesDepartment;
    });
  }, [users, search, statusFilter, roleFilter, departmentFilter]);

  // Options come from the users actually listed. They used to be merged with an
  // admin-managed departments table, which could offer a filter that matched nobody.
  const departmentOptions = useMemo(() => {
    const values = users
      .map((user) => user.department)
      .filter((department) => department && department !== "—" && department !== "Internal");
    return ["All", ...Array.from(new Set(values))];
  }, [users]);

  const reportColumns = [
    { key: "name", label: "Name", width: "18%" },
    { key: "username", label: "Username", width: "14%" },
    { key: "email", label: "Email", width: "22%" },
    { key: "department", label: "Department", width: "14%" },
    { key: "role", label: "Role", width: "10%" },
    { key: "status", label: "Status", width: "8%" },
    { key: "lastLogin", label: "Last login", width: "8%" },
    { key: "joined", label: "Joined", width: "6%" },
  ];

  const reportRows = filteredUsers.map((u) => ({
    name: u.name,
    username: `@${u.username}`,
    email: u.email,
    department: u.department || "—",
    role: u.role,
    status: u.status,
    lastLogin: formatDateTime(u.lastLogin),
    joined: formatDate(u.joined),
  }));

  function exportCsv() {
    downloadCsv(`users-report-${new Date().toISOString().slice(0, 10)}.csv`, reportColumns, reportRows);
  }

  function printReport() {
    const ok = printReportSheet({
      title: "Users report",
      subtitle: "Workspace · Directory",
      columns: reportColumns,
      rows: reportRows,
      meta: [
        `Users: ${reportRows.length}`,
        search ? `Search: "${search}"` : "",
        statusFilter !== "All" ? `Status: ${statusFilter}` : "",
        roleFilter !== "All" ? `Role: ${roleFilter}` : "",
        departmentFilter !== "All" ? `Department: ${departmentFilter}` : "",
      ].filter(Boolean),
    });
    if (!ok) window.alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  }

  function resetFilters() {
    setSearch(""); setStatusFilter("All"); setRoleFilter("All"); setDepartmentFilter("All");
  }

  async function toggleUser(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    const shouldEnable = user.status === "Disabled" || user.status === "Inactive" || user.status === "Pending";
    try {
      const response = await updateUserStatus(user.username, shouldEnable);
      const newStatus = response.status as UserStatus;
      setUsers((current) => current.map((item) =>
        item.id === userId ? { ...item, status: newStatus } : item));
      setSelectedUser((current) =>
        current && current.id === userId ? { ...current, status: newStatus } : current);
    } catch (error) {
      console.warn("toggle user failed:", error);
    }
  }

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / perPage));
  const pagedUsers = useMemo(
    () => filteredUsers.slice((page - 1) * perPage, page * perPage),
    [filteredUsers, page, perPage]
  );
  useEffect(() => { setPage(1); }, [search, statusFilter, roleFilter, departmentFilter]);

  const hasFilters = Boolean(search || statusFilter !== "All" || roleFilter !== "All" || departmentFilter !== "All");
  const rangeStart = filteredUsers.length === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, filteredUsers.length);

  async function restoreSelected() {
    if (!selectedUser) return;
    try {
      await restoreUser(selectedUser.username);
      notify(`${selectedUser.name} can sign in again`, "ok");
      setSelectedUser(null);
      await loadUsers(true);
    } catch (err: any) {
      notify(err?.message || "Restore failed", "err");
    }
  }

  async function purgeSelected() {
    if (!purgeTarget) return;
    setPurging(true);
    try {
      await purgeUser(purgeTarget.username);
      notify(`${purgeTarget.name} was removed from the workspace`, "ok");
      setPurgeTarget(null);
      setSelectedUser(null);
      await loadUsers(true);
    } catch (err: any) {
      notify(err?.message || "Purge failed", "err");
    } finally {
      setPurging(false);
    }
  }

  async function runDirectorySync() {
    setSyncing(true);
    try {
      const out = await syncDirectory(false);
      if (!out.ran) {
        notify(out.reason || "Directory sync skipped", "err");
      } else {
        const bits = [
          out.restored ? `${out.restored} restored` : "",
          out.suspended ? `${out.suspended} suspended` : "",
          out.removed ? `${out.removed} removed` : "",
          out.missing_once ? `${out.missing_once} missing once` : "",
        ].filter(Boolean);
        notify(
          bits.length
            ? `Directory synced · ${bits.join(" · ")}`
            : `Directory synced · ${out.directory_active} accounts in AD, nothing changed`,
          out.skipped_removal ? "err" : "ok",
        );
      }
      await loadUsers(true);
    } catch (err: any) {
      notify(err?.message || "Directory sync failed", "err");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <PageShell>
      <div>
        <PageHeader
          breadcrumbs={["Workspace", "Users"]}
          eyebrow="Administration"
          icon={<UsersIcon className="size-5" />}
          title="Users"
          badge={`${totalUsers} users`}
          description="Manage workspace members and their access."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* Refresh and the printable report keep their behaviour; they are
                  icon-only so the row reads as the mockup's "one primary action". */}
              <button type="button" onClick={() => loadUsers(true)} disabled={refreshing}
                aria-label="Refresh users" title="Refresh users"
                className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card text-foreground transition hover:bg-[var(--muted)] disabled:opacity-50">
                <RefreshCw className={["size-3.5", refreshing ? "animate-spin" : ""].join(" ")} />
              </button>
              <button type="button" onClick={runDirectorySync} disabled={syncing}
                title="Reconcile with Active Directory now"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-2.5 text-xs font-medium transition hover:bg-[var(--muted)] disabled:opacity-50">
                <Shield className={["size-3.5", syncing ? "animate-pulse" : ""].join(" ")} />
                {syncing ? "Syncing…" : "Sync directory"}
              </button>
              <ReportActions
                onPrint={printReport}
                onExport={exportCsv}
                disabled={filteredUsers.length === 0}
                title={`Export ${filteredUsers.length} users as CSV`}
              />
              <button type="button" onClick={() => setShowAddUser(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90">
                <Plus className="size-4" />
                Add user
              </button>
            </div>
          }
        />

        {notice && (
          <div
            role="status"
            className={[
              "mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
              notice.kind === "err"
                ? "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
                : "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]",
            ].join(" ")}
          >
            {notice.msg}
          </div>
        )}

        <main className="grid items-start gap-5">
        <div className="min-w-0 space-y-4">
        {/* summary cards — label left, icon right, big number, muted caption */}
        <div className="kpi-row grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={<UsersIcon className="size-4" />} label="Total users"
            value={totalUsers} caption="Members in this workspace" />
          <SummaryCard icon={<UserCheck className="size-4" />} label="Active users"
            value={activeUsers} caption="Enabled accounts" />
          <SummaryCard icon={<Shield className="size-4" />} label="Administrators"
            value={adminUsers} caption="Full workspace control" />
          <SummaryCard icon={<UserX className="size-4" />} label="Inactive"
            value={inactiveUsers}
            caption={lockedUsers > 0 ? `Disabled or pending · ${lockedUsers} locked` : "Disabled, locked or pending"} />
        </div>

        <section data-slot="card" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Workspace members</h2>
              <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                {filteredUsers.length === totalUsers
                  ? `${totalUsers} users`
                  : `${filteredUsers.length} of ${totalUsers} users`}
              </span>
            </div>
            <p className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground">
              {/* On a phone the toolbar is one line shorter than the sentence: "Sorted by
                  name" was clipping to "Sorted b…", which reads as a bug. */}
              <span className="hidden sm:inline">
                {filteredUsers.length === totalUsers ? "Sorted by name" : `${filteredUsers.length} shown`}
              </span>
              <span className="sm:hidden" title={filteredUsers.length === totalUsers ? "Sorted by name" : "Filtered"}>
                {filteredUsers.length === totalUsers ? "A–Z" : `${filteredUsers.length} shown`}
              </span>
            </p>
          </div>

          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, username or email…"
                aria-label="Search users"
                className="h-10 w-full min-w-[220px] rounded-xl border border-[var(--border)] bg-background pl-9 pr-9 text-xs outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-[var(--muted)] hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </div>
            {/* Status offers Locked/Disabled as well as the mockup's three: the
                backend really does return those states, and a filter that cannot
                reach a state the table shows is worse than no filter. */}
            <FilterSelect label="Status" allLabel="All statuses" value={statusFilter} onChange={setStatusFilter}
              options={["All", "Active", "Inactive", "Locked", "Disabled", "Removed"]} />
            <FilterSelect label="Role" allLabel="All roles" value={roleFilter} onChange={setRoleFilter}
              options={["All", "Administrator", "Knowledge Manager", "User"]} />
            <FilterSelect label="Department" allLabel="All departments" value={departmentFilter} onChange={setDepartmentFilter}
              options={departmentOptions} />
            <button type="button" onClick={resetFilters} disabled={!hasFilters}
              className="h-9 rounded-lg border border-[var(--border)] bg-card px-3 text-xs font-medium transition hover:bg-[var(--muted)] disabled:opacity-40">
              Reset
            </button>
          </div>

          <div className="table-scroll hidden overflow-x-auto md:block">
            {/* Fixed layout: the table obeys the panel instead of the panel obeying the
                longest email it happens to hold (that is what forced a sideways scroll). */}
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[8%]" />
                <col className="hidden w-[11%] lg:table-column" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="hidden w-[11%] 2xl:table-column" />
                <col className="hidden w-[9%] min-[1800px]:table-column" />
                <col className="w-[14%]" />
              </colgroup>
              <thead className="bg-[var(--muted)]/40">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <Th>User</Th>
                  <Th>Type</Th>
                  <Th className="hidden lg:table-cell">Department</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th className="hidden 2xl:table-cell">Last login</Th>
                  <Th className="hidden min-[1800px]:table-cell">Joined</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  Array.from({ length: 7 }).map((_, index) => (
                    <tr key={"sk" + index} className="border-b border-[var(--border)]">
                      <td colSpan={8} className="px-5 py-4"><Skeleton className="h-9 w-full" /></td>
                    </tr>
                  ))
                )}
                {!loading && pagedUsers.map((user) => (
                  <UserRow key={user.id} user={user}
                    onSelect={() => setSelectedUser(user)}
                    onToggle={() => toggleUser(user.id)}
                    onDelete={() => setPurgeTarget(user)} />
                ))}
                {!loading && error && (
                  <tr>
                    <td colSpan={8}>
                      <ErrorState
                        compact
                        title="Could not load workspace members"
                        detail={error}
                        onRetry={() => loadUsers(true)}
                      />
                    </td>
                  </tr>
                )}
                {!loading && !error && filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      {/* Two different situations, two different messages: an empty
                          directory is a normal state, "nothing matches your filters"
                          is something the user can undo. */}
                      {users.length === 0 ? (
                        <EmptyState
                          icon={<UsersIcon className="size-5" />}
                          title="No workspace members yet"
                          description="Members appear here as they are created locally or synchronized from Active Directory."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No users found"
                          description="Try changing your search or filters."
                          actionLabel="Clear filters"
                          onAction={resetFilters}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ---------- mobile: the same rows as cards ----------
              Eight columns cannot be read at 390px, and the row actions were shrinking to
              14px. Below md each member becomes a card with 44px actions instead. */}
          <div className="divide-y divide-[var(--border)] md:hidden">
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <div key={"mksk" + i} className="px-4 py-4"><Skeleton className="h-16 w-full" /></div>
            ))}
            {!loading && pagedUsers.map((u) => (
              <UserCard key={"mc" + u.id} user={u}
                onSelect={() => setSelectedUser(u)}
                onToggle={() => toggleUser(u.id)}
                onDelete={() => setPurgeTarget(u)} />
            ))}
            {!loading && !error && filteredUsers.length === 0 && (
              <div className="p-4">
                {users.length === 0 ? (
                  <EmptyState icon={<UsersIcon className="size-5" />} title="No workspace members yet"
                    description="Members appear here as they are created locally or synchronized from Active Directory." />
                ) : (
                  <EmptyState icon={<SearchX className="size-5" />} title="No users found"
                    description="Try changing your search or filters." actionLabel="Clear filters" onAction={resetFilters} />
                )}
              </div>
            )}
          </div>

          {/* range + pager footer */}
          {!loading && !error && filteredUsers.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {rangeStart} to {rangeEnd} of {filteredUsers.length} users
              </span>
              <div className="flex items-center gap-1.5">
                <PaginationButton label="‹" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
                {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => (
                  <PaginationButton key={i} label={String(i + 1)} active={page === i + 1}
                    onClick={() => setPage(i + 1)} />
                ))}
                {totalPages > 5 && <span className="px-1 text-xs text-muted-foreground">… {totalPages}</span>}
                <PaginationButton label="›" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
                <span className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1 text-2xs text-muted-foreground">10 / page</span>
              </div>
            </div>
          )}
        </section>

        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-1 text-2xs text-muted-foreground">
          <span>
            Counts are computed from the {totalUsers} member{totalUsers === 1 ? "" : "s"} returned by{" "}
            <code className="font-mono">/api/users</code> — no separate totals are fetched.
            {lockedUsers > 0 && (
              <span className="text-[var(--warn)]">
                {" "}{lockedUsers} locked account{lockedUsers === 1 ? "" : "s"} — Require admin action.
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <IntegrationLogo providerKey="ldap" name="Active Directory" size="sm" className="size-3 inline" />
            Directory (AD) accounts are read from LDAP; only local accounts can have their password set here.
          </span>
        </p>
        </div>

        </main>

        {purgeTarget && (
          <ConfirmDialog
            open
            destructive
            busy={purging}
            title={purgeTarget.state === "removed" ? `Purge ${purgeTarget.name}?` : `Delete ${purgeTarget.name}?`}
            description={purgeTarget.state === "removed"
              ? "The local record, its password entry and its group memberships are deleted. Chat history keeps the username, but this account cannot be restored from here."
              : "The local account, its password entry and its group memberships are deleted. Chat history keeps the username, and the person can be re-created later."}
            confirmLabel={purgeTarget.state === "removed" ? "Purge account" : "Delete account"}
            onCancel={() => setPurgeTarget(null)}
            onConfirm={purgeSelected}
          />
        )}

        {selectedUser && (
          <UserDrawer
            user={selectedUser}
            onRestore={restoreSelected}
            onPurge={() => setPurgeTarget(selectedUser)}
            onClose={() => setSelectedUser(null)}
            onUserUpdated={(updatedUser) => {
              setUsers((current) => current.map((item) => item.id === updatedUser.id ? updatedUser : item));
              setSelectedUser((current) => current && current.id === updatedUser.id ? { ...updatedUser, role: normalizeRole(updatedUser.role as string) } : current);
            }}
          />
        )}

        {showAddUser && <AddUserModal onClose={() => { setShowAddUser(false); loadUsers(); }} />}
      </div>
    </PageShell>
  );
}

/* ============================================================
   SUMMARY CARD
============================================================ */

function SummaryCard({ icon, label, value, caption }: {
  icon: ReactNode; label: string; value: number; caption: string;
}) {
  return (
    <div data-slot="summary-card" className="h-full rounded-2xl border border-[var(--border)] bg-card px-4 py-3.5 shadow-xs sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-foreground)]" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{value}</span>
        <span className="text-2xs text-muted-foreground">{value === 1 ? "user" : "users"}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">{caption}</p>
    </div>
  );
}

/* ============================================================
   TABLE HEADER
============================================================ */

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th className={["border-y border-[var(--border)] px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground", className].join(" ")}>
      {children}
    </th>
  );
}

/* ============================================================
   USER ROW
============================================================ */

function UserRow({ user, onSelect, onToggle, onDelete }: {
  user: User; onSelect: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const isDirectory = user.source === "ad" || Boolean(user.directoryLinked);
  const canDelete = !isDirectory || user.state === "removed";
  const hasDepartment = Boolean(user.department) && user.department !== "—";
  const hasLogin = Boolean(user.lastLogin) && user.lastLogin !== "—";
  const hasJoined = Boolean(user.joined) && user.joined !== "—";
  const isActive = user.status === "Active";

  return (
    <tr className="border-b border-[var(--border)] transition hover:bg-[var(--muted)]/40">
      <td className="px-4 py-3.5">
        {/* w-full + flex-1: without it the name block kept its 26ch max-width inside a
            narrower fixed cell and painted the email over the Department column. */}
        <button type="button" onClick={onSelect} className="flex w-full min-w-0 items-center gap-3 text-left">
          <Avatar name={user.name} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold" title={user.name}>{user.name}</span>
              {user.username.endsWith("-svc") && (
                <span
                  title="Service account — used by system components, not a human user"
                  className="shrink-0 rounded border border-[var(--border)] bg-[var(--muted)] px-1 py-px text-3xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  system
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground" title={user.email}>
              <span className="truncate">@{user.username} · {user.email}</span>
              {user.state === "removed" && (
                <span className="shrink-0 rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-1 py-px text-3xs font-semibold uppercase tracking-wide text-[var(--danger)]">
                  Removed
                </span>
              )}
              {user.state === "suspended" && (
                <span className="shrink-0 rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-1 py-px text-3xs font-semibold uppercase tracking-wide text-[var(--warn)]">
                  Suspended
                </span>
              )}
            </span>
          </span>
        </button>
      </td>
      <td className="px-4 py-3.5">
        {isDirectory ? (
          <span
            title="Managed in Active Directory / LDAP — sign-in and lifecycle follow the directory"
            className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <Shield className="size-2.5" /> Directory
          </span>
        ) : (
          <span
            title="Local account — lives only in this app, password and lifecycle managed here"
            className="inline-flex items-center gap-1 rounded border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-[var(--accent-foreground)]"
          >
            Local
          </span>
        )}
      </td>
      <td className="hidden px-4 py-3.5 lg:table-cell">
        {hasDepartment ? (
          <span className="block max-w-[14ch] truncate text-2xs" title={user.department}>{user.department}</span>
        ) : (
          <span className="text-2xs text-muted-foreground" title="No department assigned">—</span>
        )}
      </td>
      <td className="px-4 py-3.5"><RoleBadge role={user.role} /></td>
      <td className="px-4 py-3.5"><StatusBadge status={user.status} /></td>
      <td className="hidden px-4 py-3.5 2xl:table-cell">
        {hasLogin ? (
          <span className="text-2xs text-muted-foreground" title={user.lastLogin}>{formatDateTime(user.lastLogin)}</span>
        ) : (
          <span className="text-2xs text-muted-foreground" title="This account has never signed in">Never logged in</span>
        )}
      </td>
      <td className="hidden px-4 py-3.5 min-[1800px]:table-cell">
        {/* Local accounts carry no join date at all (the endpoint returns "—"),
            so the column says so rather than guessing at a sync source. */}
        {hasJoined ? (
          <span className="text-2xs text-muted-foreground" title={user.joined}>{formatDate(user.joined)}</span>
        ) : (
          <span className="text-2xs text-muted-foreground" title="No join date recorded by the directory">—</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={onSelect}
            className="rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-2xs font-semibold transition hover:bg-[var(--muted)]">
            Edit
          </button>
          <button type="button" onClick={onToggle}
            title={isActive ? "Disable user" : user.status === "Pending" ? "Approve registration" : "Enable user"}
            aria-label={isActive ? "Disable user" : "Enable user"}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--muted)] hover:text-foreground lg:size-7">
            {isActive ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
          </button>
          <button type="button" onClick={onDelete} disabled={!canDelete}
            title={canDelete
              ? user.state === "removed" ? "Purge this removed account" : "Delete this local account"
              : "Managed in Active Directory — disable the account there and the sync will remove it here"}
            aria-label={`Delete ${user.name}`}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition enabled:hover:bg-[var(--danger)]/10 enabled:hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-35 lg:size-7">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/** The mobile member row: identity, the three facts that matter, then 44px actions. */
function UserCard({ user, onSelect, onToggle, onDelete }: {
  user: User; onSelect: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const isDirectory = user.source === "ad" || Boolean(user.directoryLinked);
  const canDelete = !isDirectory || user.state === "removed";
  const isActive = user.status === "Active";
  return (
    <div className="px-4 py-4" data-slot="user-card">
      <button type="button" onClick={onSelect} className="flex w-full min-w-0 items-center gap-3 text-left">
        <Avatar name={user.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{user.name}</span>
          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">@{user.username}</span>
        </span>
      </button>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <RoleBadge role={user.role} />
        <StatusBadge status={user.status} />
        <span className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
          {isDirectory ? "Directory" : "Local"}
        </span>
        {user.state === "removed" && (
          <span className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-[var(--danger)]">Removed</span>
        )}
        {user.state === "suspended" && (
          <span className="rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-[var(--warn)]">Suspended</span>
        )}
      </div>
      {user.email && <p className="mt-2 truncate text-2xs text-muted-foreground">{user.email}</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={onSelect}
          className="h-11 rounded-xl border border-[var(--border)] bg-card text-xs font-semibold transition active:bg-[var(--muted)]">
          Edit
        </button>
        <button type="button" onClick={onToggle}
          className="h-11 rounded-xl border border-[var(--border)] bg-card text-xs font-semibold transition active:bg-[var(--muted)]">
          {isActive ? "Disable" : "Enable"}
        </button>
        <button type="button" onClick={onDelete} disabled={!canDelete}
          className="h-11 rounded-xl border border-[var(--danger)]/35 bg-[var(--danger)]/8 text-xs font-semibold text-[var(--danger)] transition active:bg-[var(--danger)]/15 disabled:border-[var(--border)] disabled:bg-card disabled:text-muted-foreground disabled:opacity-50">
          Delete
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   AVATAR / ROLE BADGE / STATUS BADGE
============================================================ */

function Avatar({ name }: { name: string }) {
  return (
    <span className={["grid size-9 shrink-0 place-items-center rounded-full text-2xs font-bold", avatarTone(name)].join(" ")}>
      {getInitials(name)}
    </span>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  // v1.5.6 — distinct role colors: Administrator=violet, IT Support=sky, KM=teal, User=slate
  const styles: Record<UserRole, string> = {
    Administrator: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
    "Knowledge Manager": "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300",
    User: "border-[var(--border)] bg-[var(--muted)] text-muted-foreground",
  };
  return <span className={["inline-flex items-center rounded-md border px-2 py-0.5 text-3xs font-semibold", styles[role]].join(" ")}>{role}</span>;
}

function StatusBadge({ status }: { status: UserStatus }) {
  const config: Record<UserStatus, { className: string; dot: string }> = {
    Active: { className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
    Pending: { className: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300", dot: "bg-sky-500" },
    Inactive: { className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
    Locked: { className: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300", dot: "bg-red-500" },
    Disabled: { className: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", dot: "bg-amber-500" },
  };
  const item = config[status];
  return (
    <span className={["inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-3xs font-semibold", item.className].join(" ")}>
      <span className={["size-1.5 rounded-full", item.dot].join(" ")} />
      {status}
    </span>
  );
}

/* ============================================================
   FILTER SELECT / PAGINATION
============================================================ */

function FilterSelect({ value, onChange, options, label, allLabel }: {
  value: string; onChange: (value: string) => void; options: string[]; label: string; allLabel: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
      className="h-9 min-w-[132px] rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15">
      {options.map((option) => (
        <option key={option} value={option}>{option === "All" ? allLabel : option}</option>
      ))}
    </select>
  );
}

function PaginationButton({ label, active, disabled, onClick }: {
  label: string; active?: boolean; disabled?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={["grid size-8 place-items-center rounded-lg border border-[var(--border)] text-2xs font-medium transition",
        active ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "bg-card hover:bg-[var(--muted)]",
        disabled ? "cursor-not-allowed opacity-40" : ""].join(" ")}>
      {label}
    </button>
  );
}

/* ============================================================
   CONFIRM DIALOG — every destructive action goes through this
============================================================ */

function ConfirmDialog({ open, title, description, confirmLabel, destructive, busy, onConfirm, onCancel }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string;
  destructive?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} disabled={busy}
            onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ============================================================
   USER DRAWER

   The overlay the mockup is really about: person header, workspace role with a
   LIVE capability preview, the directory provenance, a source-specific security
   callout, and the account actions.

   HONESTY NOTES (checked against backend/app/api/users.py + admin_ops.py):
   - Role changes are a REAL write (PATCH /api/users/{u}/role → role_override);
     it applies on the user's next sign-in, which the panel says out loud.
   - The capability list is the role's DEFAULTS while a new role is picked, and
     the account's EFFECTIVE permissions (GET /api/users/{u}/permissions) when
     the selection is unchanged. The panel labels which of the two it is showing
     instead of presenting a guess as the saved state.
   - Local passwords are a REAL write (PUT /api/users/{u}/password) and the
     backend refuses LDAP-sourced accounts, so the AD branch has no form at all.
============================================================ */

function UserDrawer({ user, onClose, onUserUpdated, onRestore, onPurge }: {
  user: User; onClose: () => void; onUserUpdated?: (user: User) => void;
  onRestore?: () => void; onPurge?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [permissions, setPermissions] = useState<PermissionMap>(EMPTY_PERMISSIONS);
  // The permissions endpoint also returns the account's EXPLICIT per-user grants
  // (`overrides`). The preview needs those — the role matrix alone is not a grant.
  const [overrides, setOverrides] = useState<Partial<PermissionMap>>({});
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaved, setRoleSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<null | "disable" | "reset">(null);

  useEffect(() => {
    let mounted = true;
    async function loadPermissions() {
      setLoadingPermissions(true);
      try {
        const data = await getUserPermissions(user.username);
        if (!mounted) return;
        const eff = { ...EMPTY_PERMISSIONS, ...(data.effective ?? {}) };
        setPermissions({ ...eff, manage_domains: eff.manage_kb }); // v1.3.6 merged capability
        setOverrides((data.overrides ?? {}) as Partial<PermissionMap>);
      } catch (err: any) {
        if (mounted) setPermissions(EMPTY_PERMISSIONS);
        console.warn("Failed to load user permissions:", err);
      } finally {
        if (mounted) setLoadingPermissions(false);
      }
    }
    loadPermissions();
    return () => { mounted = false; };
  }, [user.username]);

  /* v0.21.80 — instant preview: while picking a role, show that role's default permissions
     (from ROLE_DEFAULTS + the account's explicit per-user grants). Saves re-fetch effective perms.
     v1.0.2 — the merge used the EFFECTIVE matrix as if it were an explicit grant, so the preview
     did not move for any account that had ever had its role changed (every such row carries a
     role_override). It now merges the `overrides` map the permissions endpoint returns, which is
     what an explicit grant actually is. */
  const previewPerms: PermissionMap = useMemo(() => {
    const defaults = ROLE_DEFAULTS[selectedRole] ?? EMPTY_PERMISSIONS;
    let base: PermissionMap;
    if (selectedRole === user.role) {
      base = permissions;
    } else {
      // merge: role defaults + the explicit per-user grants this account already holds
      const merged = { ...defaults } as PermissionMap;
      (Object.keys(merged) as PermissionKey[]).forEach((k) => {
        if (!merged[k] && overrides[k]) merged[k] = true; // keep explicit grants
      });
      base = merged;
    }
    // v1.3.6 — merged capability: manage_domains follows manage_kb (one switch in UI)
    return { ...base, manage_domains: base.manage_kb };
  }, [selectedRole, permissions, overrides, user.role]);

  const roleChanged = selectedRole !== user.role;

  async function saveRole() {
    if (!roleChanged) return;
    setSavingRole(true); setError(null); setRoleSaved(false);
    try {
      await updateUserRole(user.username, selectedRole);
      const updatedUser: User = { ...user, role: selectedRole, roleOverride: selectedRole.toLowerCase() };
      onUserUpdated?.({ ...updatedUser, role: normalizeRole(updatedUser.role as string) });
      setRoleSaved(true);
      window.setTimeout(() => setRoleSaved(false), 2500);
      try {
        getUserPermissions(user.username)
          .then((data) => setPermissions({ ...EMPTY_PERMISSIONS, ...(data.effective ?? {}) }))
          .catch(() => { /* Keep existing permission display. */ });
      } catch { /* Keep existing permission display. */ }
    } catch (err: any) {
      setError(err?.message || "Failed to update user role.");
    } finally {
      setSavingRole(false);
    }
  }

  async function handleResetAccess() {
    setBusy(true); setError(null);
    try {
      await resetUserAccess(user.username);
      onUserUpdated?.({ ...user, status: "Active" });
    } catch (err: any) {
      setError(err?.message || "Failed to reset user access.");
    } finally { setBusy(false); }
  }

  async function handleStatusChange() {
    setBusy(true); setError(null);
    const enabling = user.status === "Disabled" || user.status === "Inactive";
    try {
      const response = await updateUserStatus(user.username, enabling);
      onUserUpdated?.({ ...user, status: response.status as UserStatus });
    } catch (err: any) {
      setError(err?.message || "Failed to update account status.");
    } finally { setBusy(false); }
  }

  const isAdUser = user.source === "ad" || user.id?.startsWith("ad:");
  // AD accounts say so; a local password says local; anything else signed in through SSO.
  const identity: "ldap" | "local" | "sso" =
    user.identitySource ?? (isAdUser ? "ldap" : "local");

  const roleLabel = user.role;
  const deactivated = user.status === "Disabled" || user.status === "Inactive";

  const permissionRows = RBAC_CAPABILITIES.map((capability) => {
    const enabled = !!previewPerms[capability.key];
    return {
      key: capability.key,
      label: capability.label,
      enabled,
      changed: roleChanged && enabled !== !!permissions[capability.key],
    };
  });

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[min(86dvh,calc(100dvh-1.5rem))] w-[94vw] max-w-[min(960px,94vw)] flex-col gap-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 shadow-2xl sm:max-w-[min(960px,94vw)]"
        >
          {/* ---- header: who this is, at a glance ---- */}
          <div className="flex items-start gap-3 border-b border-[var(--border)] px-6 pb-4 pt-5">
            <span className={["grid size-12 shrink-0 place-items-center rounded-2xl text-sm font-bold", avatarTone(user.name)].join(" ")} aria-hidden>
              {getInitials(user.name)}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">User details</p>
              <DialogTitle className="mt-0.5 truncate text-lg font-bold leading-tight tracking-tight text-foreground" title={user.name}>
                {user.name}
              </DialogTitle>
              <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground" title={user.email}>
                @{user.username} · {user.email}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={user.status} />
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-muted/50 px-2 py-1 text-2xs font-medium">
                  <Shield className="size-3 text-muted-foreground" aria-hidden />
                  {roleLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-muted/50 px-2 py-1 text-2xs font-medium text-muted-foreground">
                  {identity === "ldap" ? (
                    <IntegrationLogo providerKey="ldap" name="Active Directory" size="sm" className="size-3" />
                  ) : identity === "sso" ? (
                    <IntegrationLogo providerKey="keycloak" name="Keycloak SSO" size="sm" className="size-3" />
                  ) : (
                    <Laptop className="size-3" aria-hidden />
                  )}
                  {identity === "ldap" ? "Active Directory" : identity === "sso" ? "Keycloak SSO" : "Local account"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ---- body: the decision on the left, the facts on the right ---- */}
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5 lg:grid-cols-12">
            <div className="space-y-5 lg:col-span-7">
              {/* ---------- role + permissions ---------- */}
            <section aria-labelledby="access-heading">
              <SectionHeading
                icon={<Shield className="size-3.5" />}
                title="Workspace role"
                hint="One role decides the default capabilities; explicit grants can extend them."
              />

              <div className="rounded-xl border border-[var(--border)] bg-background/40 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label htmlFor="user-role" className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Role
                  </label>
                  {roleChanged ? (
                    <span className="rounded-full border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                      Preview: {selectedRole}
                    </span>
                  ) : (
                    <span className="rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Current: {user.role}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <select
                    id="user-role"
                    value={selectedRole}
                    onChange={(event) => { setSelectedRole(event.target.value as UserRole); setRoleSaved(false); }}
                    aria-label="Role"
                    className="h-10 w-full appearance-none rounded-lg border border-[var(--border)] bg-background pl-3 pr-9 text-xs font-medium outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                  >
                    <option value="Administrator">Administrator</option>
                    <option value="Knowledge Manager">Knowledge Manager</option>
                    <option value="User">User</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </div>
                <p className="mt-1.5 text-2xs leading-4 text-muted-foreground">{ROLE_DESCRIPTIONS[selectedRole]}</p>

                {roleChanged && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/8 px-2 py-1.5">
                    <span className="text-2xs text-muted-foreground">Changing from {user.role} to {selectedRole}</span>
                    <button
                      type="button"
                      onClick={() => { setSelectedRole(user.role); setRoleSaved(false); }}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)]"
                    >
                      <RotateCcw className="size-3" aria-hidden /> Undo
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</h4>
                  <span className="text-2xs text-muted-foreground">
                    {roleChanged ? "Preview — nothing saved yet" : "Effective from the permissions API"}
                  </span>
                </div>
                <PermissionMatrix rows={permissionRows} loading={loadingPermissions} />
                <p className="mt-2 text-2xs leading-4 text-muted-foreground">
                  {roleChanged
                    ? "Role defaults plus this account's explicit grants. Apply below to persist."
                    : "Reported by the permissions endpoint for this account."}
                </p>
              </div>
            </section>
            </div>

            <div className="space-y-5 lg:col-span-5">
              {(user.state === "removed" || user.state === "suspended") && (
                <section
                  role="alert"
                  className={[
                    "rounded-xl border px-3 py-2.5",
                    user.state === "removed"
                      ? "border-[var(--danger)]/40 bg-[var(--danger)]/8"
                      : "border-[var(--warn)]/40 bg-[var(--warn)]/8",
                  ].join(" ")}
                >
                  <p className="text-xs font-semibold text-foreground">
                    {user.state === "removed" ? "Removed from the directory" : "Disabled in Active Directory"}
                  </p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                    {user.state === "removed"
                      ? "Active Directory no longer has this account, so it cannot sign in. Restore re-enables it here; purge deletes the local record for good."
                      : "The account still exists in Active Directory but is disabled, so sign-in is blocked."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={onRestore}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-2.5 text-2xs font-semibold transition hover:bg-muted">
                      Restore access
                    </button>
                    {user.state === "removed" && (
                      <button type="button" onClick={onPurge}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/8 px-2.5 text-2xs font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)]/15">
                        Purge local record
                      </button>
                    )}
                  </div>
                </section>
              )}
              {/* ---------- account metadata ---------- */}
            <section aria-labelledby="account-heading">
              <SectionHeading
                icon={<UsersIcon className="size-3.5" />}
                title="Account"
                hint="Identity and source of record."
              />
              <MetaGrid>
                <MetaItem icon={<Mail className="size-3" aria-hidden />} label="Email" value={user.email} title={user.email} />
                <MetaItem icon={<Building2 className="size-3" aria-hidden />} label="Department" value={user.department || "—"} />
                <MetaItem
                  icon={isAdUser ? <Building2 className="size-3" aria-hidden /> : <Laptop className="size-3" aria-hidden />}
                  label="Account type"
                  value={isAdUser ? "Active Directory" : "Local"}
                />
                <MetaItem icon={<AtSign className="size-3" aria-hidden />} label="Username" value={user.username} mono />
                <MetaItem icon={<CalendarDays className="size-3" aria-hidden />} label="Joined" value={formatDateTime(user.joined)} />
                <MetaItem icon={<Clock className="size-3" aria-hidden />} label="Last login" value={formatDateTime(user.lastLogin)} />
              </MetaGrid>
            </section>
              {/* ---------- directory ---------- */}
            <section aria-labelledby="directory-heading">
              <SectionHeading
                icon={<UserCog className="size-3.5" />}
                title="Directory"
                hint={isAdUser ? "Groups and identity come from Active Directory." : "This account is not linked to a directory."}
              />
              {isAdUser ? (
                <NoticeCard
                  tone="warning"
                  icon={<Building2 className="size-3.5" />}
                  title="Managed by Active Directory"
                  footer={
                    <p className="rounded-lg bg-card/60 px-2 py-1.5 text-2xs leading-4 text-muted-foreground">
                      Change the account in AD, then run a directory sync. Local edits here are overwritten on the
                      next sync.
                    </p>
                  }
                >
                  Name, group membership and password are owned by AD. This drawer can change the workspace role only.
                </NoticeCard>
              ) : (
                <NoticeCard tone="info" icon={<Laptop className="size-3.5" />} title="Local account">
                  Created and stored by this application. Nothing here is synchronised to a directory.
                </NoticeCard>
              )}

              <div className="mt-2">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Groups ({user.groups.length})
                </p>
                {user.groups.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {user.groups.map((group) => (
                      <span
                        key={group}
                        className="rounded-md border border-[var(--border)] bg-muted/50 px-2 py-1 font-mono text-2xs text-foreground"
                      >
                        {group}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-2xs text-muted-foreground">
                    No directory groups assigned.
                  </p>
                )}
              </div>
            </section>
              {/* ---------- security ---------- */}
            <section aria-labelledby="security-heading">
              <SectionHeading icon={<KeyRound className="size-3.5" />} title="Security" hint="Password and access recovery." />
              {isAdUser ? (
                <NoticeCard
                  tone="warning"
                  icon={<KeyRound className="size-3.5" />}
                  title="Managed by Active Directory"
                  footer={
                    <button
                      type="button"
                      disabled
                      title="Passwords are changed in Active Directory"
                      className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-2xs font-semibold text-muted-foreground opacity-70"
                    >
                      <KeyRound className="size-3" aria-hidden /> Password changes happen in AD
                    </button>
                  }
                >
                  This password is managed in Active Directory and cannot be changed here. Use Reset access to force a
                  fresh sign-in after an AD change.
                </NoticeCard>
              ) : (
                <div className="space-y-2">
                  <NoticeCard tone="info" icon={<Laptop className="size-3.5" />} title="Local account">
                    This password is stored by this application — a change below is applied immediately.
                  </NoticeCard>
                  <LocalPasswordForm username={user.username} />
                </div>
              )}
            </section>
              {(roleSaved || error) && (
              <div
                role="status"
                className={[
                  "flex items-start gap-2 rounded-xl border px-3 py-2 text-2xs",
                  error
                    ? "border-[var(--danger)]/35 bg-[var(--danger)]/8 text-[var(--danger)]"
                    : "border-[var(--ok)]/35 bg-[var(--ok)]/8 text-[var(--ok)]",
                ].join(" ")}
              >
                {error ? <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> : <Check className="mt-px size-3.5 shrink-0" aria-hidden />}
                <span className="min-w-0 break-words">{error ?? "Access updated"}</span>
              </div>
            )}
            </div>
          </div>

          {/* ---- footer actions: destructive left, routine right ---- */}
          <div className="border-t border-[var(--border)] bg-card px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={busy}
              onClick={() => { if (deactivated) { void handleStatusChange(); } else { setConfirmKind("disable"); } }}
              className={[
                "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-2xs font-semibold transition disabled:opacity-50",
                deactivated
                  ? "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)] hover:bg-[var(--ok)]/15"
                  : "border-[var(--danger)]/40 bg-[var(--danger)]/8 text-[var(--danger)] hover:bg-[var(--danger)]/15",
              ].join(" ")}
            >
              {deactivated ? <UserCheck className="size-3.5" aria-hidden /> : <UserX className="size-3.5" aria-hidden />}
              {deactivated ? "Reactivate account" : "Deactivate account"}
            </button>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmKind("reset")}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-3 text-2xs font-semibold transition hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className="size-3.5" aria-hidden /> Reset access
              </button>
              <button
                type="button"
                onClick={saveRole}
                disabled={savingRole || !roleChanged}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 text-2xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="size-3.5" aria-hidden />
                {savingRole ? "Saving…" : "Save access changes"}
              </button>
            </div>
          </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground sm:text-left">
            {roleChanged
              ? `Unsaved role change: ${user.role} → ${selectedRole}`
              : "Role changes take effect the next time this user signs in."}
          </p>
        
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivation revokes access immediately (the backend invalidates the token);
            reset-access forces a fresh sign-in — both ask first. */}
        <ConfirmDialog
          open={confirmKind === "disable"}
          destructive
          busy={busy}
          title={`Deactivate ${user.name}?`}
          description="They are signed out straight away and cannot sign in again until an administrator reactivates the account."
          confirmLabel="Deactivate account"
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => { setConfirmKind(null); void handleStatusChange(); }}
        />
        <ConfirmDialog
          open={confirmKind === "reset"}
          busy={busy}
          title={`Force ${user.name} to sign in again?`}
          description="This invalidates their refresh tokens so the next request needs a fresh sign-in, and the account status is set back to Active."
          confirmLabel="Reset access"
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => { setConfirmKind(null); void handleResetAccess(); }}
        />
    </>
  );
}

/* ============================================================
   ADD USER MODAL
============================================================ */

function AddUserModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState<UserRole>("User");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createUser() {
    if (!username.trim() || !displayName.trim() || !email.trim()) {
      setError("Username, display name and email are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSaving(true); setError(null);
    try {
      await createUserApi({ username: username.trim(), name: displayName.trim(), email: email.trim(), department: department.trim(), role, password });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create user.");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]">
      <div data-slot="card" className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Add user</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">Create a local account or provision an account for directory access.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-[var(--muted)]">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <InputField label="Username" value={username} onChange={setUsername} placeholder="e.g. john.smith" />
          <InputField label="Display name" value={displayName} onChange={setDisplayName} placeholder="John Smith" />
          <InputField label="Email" value={email} onChange={setEmail} placeholder="john.smith@company.com" type="email" />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Department" value={department} onChange={setDepartment} placeholder="IT Operations" />
            <div>
              <label className="mb-1.5 block text-2xs font-semibold">Role</label>
              <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none" aria-label="Role">
                <option value="User">User</option>
                <option value="Knowledge Manager">Knowledge Manager</option>
                <option value="Administrator">Administrator</option>
              </select>
            </div>
          </div>
          <InputField label="Password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" type="password" />
          <div className="rounded-xl bg-[var(--accent)] p-3 text-2xs leading-4 text-[var(--accent-foreground)]">
            <div className="flex gap-2">
              <IntegrationLogo providerKey="ldap" name="Active Directory" size="sm" className="mt-0.5 size-3.5 shrink-0" />
              <span>LDAP / AD users should normally be synchronized from Active Directory. Their passwords are managed by AD.</span>
            </div>
          </div>
          {error && (
            <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-2xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-2xs font-semibold hover:bg-[var(--muted)]">Cancel</button>
          <button type="button" onClick={createUser} disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-2xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-40">
            {saving ? "Creating..." : "Create user"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   INPUT FIELD / HELPERS
============================================================ */

function InputField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-semibold">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-[var(--primary)]" />
    </label>
  );
}

function getInitials(name: string) {
  return name.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
