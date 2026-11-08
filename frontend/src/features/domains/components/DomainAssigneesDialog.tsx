/**
 * Who takes a ticket in this category.
 *
 * Jira assigns to one person, but support teams are organised as groups, so the mapping stores
 * both: users (always offered) and app groups (expanded to their members when a ticket is
 * created). An empty mapping is not "nobody" — it means no restriction, and the create dialog
 * falls back to the whole assignable directory.
 */
import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";

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
import { assignableUsers, listUsers } from "@/features/users/api";

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
  const [knownGroups, setKnownGroups] = useState<string[]>([]);
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
      listUsers().catch(() => ({ users: [] })),
    ])
      .then(([mapping, pool, directory]) => {
        if (!alive) return;
        setUsers(mapping.users ?? []);
        setGroups(mapping.groups ?? []);
        setPeople(pool.users ?? []);
        const seen = new Set<string>();
        for (const u of directory.users ?? []) {
          for (const g of u.groups ?? []) if (g) seen.add(g);
        }
        for (const g of mapping.groups ?? []) seen.add(g);
        setKnownGroups([...seen].sort());
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
      <DialogContent className="max-w-lg rounded-2xl">
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
          <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold">Groups</legend>
              {knownGroups.length === 0 ? (
                <p className="text-2xs text-muted-foreground">
                  No groups found in the directory yet — add one from the Users page.
                </p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {knownGroups.map((g) => (
                    <label key={g} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={groups.includes(g)}
                        onChange={() => setGroups((prev) => toggle(prev, g))}
                        aria-label={`Group ${g}`}
                      />
                      <span className="truncate">{g}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold">People</legend>
              {people.length === 0 ? (
                <p className="text-2xs text-muted-foreground">
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
                      {u.role && <span className="ml-auto text-2xs text-muted-foreground">{u.role}</span>}
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
