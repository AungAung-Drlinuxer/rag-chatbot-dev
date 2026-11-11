/**
 * Who takes a ticket in this category — and the groups that make that possible.
 *
 * Jira assigns to one person, but support teams are organised as groups. The mapping stores
 * both: users (always offered) and app groups (expanded to their members when a ticket is
 * created). A category with no mapping is not "nobody" — it means no restriction, and the
 * create dialog falls back to the whole assignable directory.
 *
 * Groups are created and staffed here because the `app_groups` table existed with no writer,
 * so every install showed "No groups found" and no way out of it.
 */
import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDomainAssignees, saveDomainAssignees } from "@/features/domains/api";
import type { ClassifierDomainItem } from "@/features/domains/api";
import {
  assignableUsers,
  createGroup,
  deleteGroup,
  listGroups,
  updateGroupMembers,
  type AppGroup,
} from "@/features/users/api";

export function DomainAssigneesDialog({
  domain,
  onClose,
  onToast,
}: {
  domain: ClassifierDomainItem | null;
  onClose: () => void;
  onToast?: (msg: string, tone?: "ok" | "err") => void;
}) {
  const [users, setUsers] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [people, setPeople] = useState<{ username: string; role?: string }[]>([]);
  const [allGroups, setAllGroups] = useState<AppGroup[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!domain) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getDomainAssignees(domain.id),
      assignableUsers().catch(() => ({ users: [] })),
      listGroups().catch(() => ({ groups: [] })),
    ])
      .then(([mapping, pool, groupList]) => {
        if (!alive) return;
        setUsers(mapping.users ?? []);
        setGroups(mapping.groups ?? []);
        setPeople(pool.users ?? []);
        setAllGroups(groupList.groups ?? []);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load the mapping"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [domain]);

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function refreshGroups() {
    const out = await listGroups();
    setAllGroups(out.groups ?? []);
  }

  async function addGroup() {
    const name = newGroup.trim();
    if (!name) return;
    setBusyGroup(name);
    try {
      await createGroup(name);
      await refreshGroups();
      setGroups((prev) => [...prev, name]);
      setExpanded(name);
      setNewGroup("");
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Could not create the group", "err");
    } finally {
      setBusyGroup(null);
    }
  }

  async function toggleMember(group: AppGroup, username: string) {
    setBusyGroup(group.name);
    try {
      const next = group.members.includes(username)
        ? group.members.filter((m) => m !== username)
        : [...group.members, username];
      await updateGroupMembers(group.name, next);
      await refreshGroups();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Could not update members", "err");
    } finally {
      setBusyGroup(null);
    }
  }

  async function removeGroup(group: AppGroup) {
    setBusyGroup(group.name);
    try {
      await deleteGroup(group.name);
      setGroups((prev) => prev.filter((g) => g !== group.name));
      await refreshGroups();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Could not delete the group", "err");
    } finally {
      setBusyGroup(null);
    }
  }

  async function save() {
    if (!domain) return;
    setSaving(true);
    try {
      await saveDomainAssignees(domain.id, { users, groups });
      onToast?.(`Assignees saved for ${domain.display_name}`);
      onClose();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Save failed", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(domain)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Ticket assignees — {domain?.display_name ?? ""}
          </DialogTitle>
          <DialogDescription>
            Choosing this category when creating a ticket limits the assignee list to these
            people and groups. Leave everything unticked to keep the whole directory.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
          </div>
        ) : error ? (
          <p className="py-6 text-xs text-[var(--danger)]">{error}</p>
        ) : (
          <div className="max-h-[56vh] space-y-5 overflow-y-auto pr-1">
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold">Groups</legend>

              <div className="mb-2 flex items-center gap-1.5">
                <input
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addGroup();
                  }}
                  placeholder="New group name (e.g. Network Team)"
                  aria-label="New group name"
                  className="h-8 flex-1 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none focus:border-[var(--primary)]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-[14px]"
                  disabled={!newGroup.trim() || busyGroup === newGroup.trim()}
                  onClick={() => void addGroup()}
                >
                  <Plus className="mr-1 size-3" aria-hidden /> Add
                </Button>
              </div>

              {allGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No groups yet — create one above, then tick its members so it can take tickets.
                </p>
              ) : (
                <div className="space-y-1">
                  {allGroups.map((g) => (
                    <div key={g.name} className="rounded-lg border border-[var(--border)]">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={groups.includes(g.name)}
                          onChange={() => setGroups((prev) => toggle(prev, g.name))}
                          aria-label={`Group ${g.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => setExpanded((v) => (v === g.name ? null : g.name))}
                          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs"
                          aria-expanded={expanded === g.name}
                        >
                          <span className="truncate font-medium">{g.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {g.members.length} member{g.members.length === 1 ? "" : "s"}
                          </span>
                          <ChevronDown
                            className={["ml-auto size-3 transition", expanded === g.name ? "rotate-180" : ""].join(" ")}
                            aria-hidden
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeGroup(g)}
                          aria-label={`Delete group ${g.name}`}
                          className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-[var(--danger)]"
                        >
                          <Trash2 className="size-3" aria-hidden />
                        </button>
                      </div>

                      {expanded === g.name && (
                        <div className="border-t border-[var(--border)] px-3 py-2">
                          {people.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No assignable users yet.</p>
                          ) : (
                            <div className="grid gap-1 sm:grid-cols-2">
                              {people.map((p) => (
                                <label key={p.username} className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    disabled={busyGroup === g.name}
                                    checked={g.members.includes(p.username)}
                                    onChange={() => void toggleMember(g, p.username)}
                                    aria-label={`${p.username} in ${g.name}`}
                                  />
                                  <span className="truncate">{p.username}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold">People</legend>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Individuals assigned directly, on top of any group above.
              </p>
              {people.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No assignable users (admin/agent) yet. Users get a role after LDAP sync or on
                  the Users page.
                </p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {people.map((u) => (
                    <label key={u.username} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={users.includes(u.username)}
                        onChange={() => setUsers((prev) => toggle(prev, u.username))}
                        aria-label={`User ${u.username}`}
                      />
                      <span className="truncate">{u.username}</span>
                      {u.role && <span className="ml-auto text-xs text-muted-foreground">{u.role}</span>}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="rounded-lg text-xs" disabled={saving || loading} onClick={save}>
            {saving ? "Saving…" : "Save assignees"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
