import {
  BellRing,
  BookOpen,
  Bot,
  Check,
  Archive,
  Monitor,
  Plug,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  XCircle,
} from "lucide-react";
import { IntegrationLogo } from "../components/IntegrationLogo";
import { useEffect, useState } from "react";
import { PageShell, PageHeader, ErrorState } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useSectionParam } from "@/features/settings/useSectionParam";
import { Panel, Row, Segmented } from "../components/SettingsKit";

import { dashHealth } from "@/features/dashboard/api";
import { IntegrationsConfig } from "../components/IntegrationsConfig";
import { DataRetentionSettings } from "../components/DataRetentionSettings";
import NotificationSettings from "../components/NotificationSettings";
import SetupChecklist from "../components/SetupChecklist";
import { BrandingSettings, fetchBranding } from "../components/BrandingSettings";
import { refreshBrandingCache } from "@/app/useBranding";
import { apiFetch, authHeaders, BASE } from "@/shared/api/client";
import { AiServiceSettings } from "../components/AiServiceSettings";
import { EmailServerSettings } from "../components/EmailServerSettings";
import { Image as ImageIcon } from "lucide-react";
import {
  getMySettings, updateMySettings, getIntegrationSettings,
} from "@/features/settings/api";
import { applyThemeChoice } from "@/app/theme";

/* v1.6.90 — Settings re-skinned to the workspace mockup:
   breadcrumb + H1 + right-aligned access badge, a horizontal TAB row that
   switches between the four groups (Preferences / Integrations / AI service /
   Email server), a two-column body (content + 260px right rail) and a sticky
   footer bar. All live logic is preserved: server load/save, instant theme
   side-effects, RAG runtime knobs (admin), the Integrations status cards +
   editor tabs + System health checks, and write-only credentials. */

/* ============================================================
   SHARED ROW COMPONENTS (reference style)
============================================================ */

/** The single switch used across Preferences — same geometry as every other panel. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked ? "border-transparent bg-[var(--primary)]" : "border-[var(--border)] bg-muted"}`}
    >
      <span className={`size-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
    </button>
  );
}

function ToggleRow({ checked, onChange, title, description }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; description?: string;
}) {
  return (
    <Row title={title} hint={description}>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </Row>
  );
}

/* Grouped settings navigation (v1.6.75). The four groups are the four TABS the
 * mockup renders as a horizontal row. Only panels that HAVE content are listed:
 * this app has no settings behind Extensions / Developer / Plugins, and an empty
 * page is worse than an absent one. The service-status block lives inside
 * Integrations. */
const SECTION_IDS = ["general", "integrations", "skills", "notifications", "retention"] as const;

const SETTINGS_NAV: { group: string; items: { id: string; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Workspace",
    items: [
      { id: "general", label: "Preferences", icon: <Monitor className="size-4" /> },
    ],
  },
  {
    group: "Connections",
    items: [
      { id: "integrations", label: "Integrations", icon: <Plug className="size-4" /> },
      { id: "skills", label: "AI service", icon: <BookOpen className="size-4" /> },
      /* One tab, not two: both answer "how does this workspace tell me things". */
      { id: "notifications", label: "Email & Notifications", icon: <BellRing className="size-4" /> },
    ],
  },
  {
    group: "Governance",
    items: [
      /* Administrator-only: how long conversations and audit rows are kept. */
      { id: "retention", label: "Data retention", icon: <Archive className="size-4" /> },
    ],
  },
];

/** One accent per group, so the rail is scannable before it is read. */
const GROUP_ACCENT: Record<string, string> = {
  Workspace: "bg-[var(--brand-solid)]",
  Connections: "bg-[var(--accent-blue)]",
  Governance: "bg-emerald-500",
};

/** Live count of the four external systems — the rail states it once, not four times. */
function useIntegrationLive() {
  const [live, setLive] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getIntegrationSettings("confluence"),
      getIntegrationSettings("jira"),
      getIntegrationSettings("ldap"),
      getIntegrationSettings("keycloak"),
    ]).then((vals) => {
      if (cancelled) return;
      const ready = [
        Boolean((vals[0] as any)?.settings?.base_url ?? (vals[0] as any)?.base_url),
        Boolean((vals[1] as any)?.settings?.base_url ?? (vals[1] as any)?.base_url),
        Boolean((vals[2] as any)?.settings?.host ?? (vals[2] as any)?.host),
        Boolean((vals[3] as any)?.settings?.issuer ?? (vals[3] as any)?.issuer),
      ];
      setLive(ready.filter(Boolean).length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return live;
}

/**
 * Left rail: three groups, one accent bar each, and the only navigation on the page.
 *
 * The horizontal tab strip it replaces gave every section the same weight and pushed the
 * content down; a rail keeps the sections visible while you work, groups them by intent
 * (what the workspace looks like / what it talks to / what it keeps), and has room for the
 * one number that matters — how many of the four connections are live.
 */
function SettingsRail({ visible, active, onSelect, environment, roleLabel }: {
  visible: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  environment: string;
  roleLabel: string;
}) {
  const live = useIntegrationLive();
  const allowed = new Set(visible.map((v) => v.id));

  const item = (it: { id: string; label: string; icon: React.ReactNode }, compact: boolean) => {
    const on = active === it.id;
    return (
      <button
        key={it.id}
        type="button"
        onClick={() => onSelect(it.id)}
        aria-current={on ? "page" : undefined}
        className={[
          "group flex w-full items-center gap-2.5 rounded-xl text-left transition",
          compact ? "shrink-0 px-3 py-2 text-xs" : "px-2.5 py-2 text-xs",
          on
            ? "bg-card font-semibold text-foreground shadow-xs ring-1 ring-[var(--border)]"
            : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
        ].join(" ")}
      >
        <span aria-hidden className={on ? "text-[var(--primary)]" : "opacity-70"}>{it.icon}</span>
        <span className="truncate">{it.label}</span>
        {it.id === "integrations" && live > 0 && (
          <span
            className="ml-auto shrink-0 rounded-full bg-[var(--ok)]/12 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--ok)]"
            title={`${live} of 4 connections configured`}
          >
            {live}/4
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Desktop: sticky rail */}
      <aside className="hidden shrink-0 lg:block lg:w-[224px] lg:sticky lg:top-6">
        <nav aria-label="Settings sections" className="space-y-5">
          {SETTINGS_NAV.map((g) => {
            const items = g.items.filter((it) => allowed.has(it.id));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <p className="mb-1.5 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <span className={`h-[3px] w-4 rounded-full ${GROUP_ACCENT[g.group] ?? "bg-[var(--border)]"}`} aria-hidden />
                  {g.group}
                </p>
                <div className="space-y-0.5">{items.map((it) => item(it, false))}</div>
              </div>
            );
          })}
        </nav>

        <div className="mt-5 rounded-xl border border-[var(--border)] bg-card px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Signed in as</p>
          <p className="mt-1 text-2xs font-semibold text-foreground">{roleLabel}</p>
          <p className="text-2xs text-muted-foreground">{environment} build</p>
        </div>
      </aside>

      {/* Phone / tablet: one native picker.
          A scrolling strip put three of five sections off the right edge with nothing to say
          they were there; wrapping chips fixed the hiding but stacked five rows of sticky
          chrome on top of a 812px screen. A select is one row, reaches every section, works
          with a screen reader and with the OS picker. */}
      <div className="sticky top-0 z-20 -mx-1 border-b border-[var(--border)] bg-background/85 px-1 py-2 backdrop-blur lg:hidden">
        <label htmlFor="settings-section" className="sr-only">Settings section</label>
        <select
          id="settings-section"
          value={active}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full appearance-none rounded-xl border border-[var(--border)] bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus-visible:border-[var(--primary)]"
          aria-label="Settings section"
        >
          {SETTINGS_NAV.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.filter((it) => visible.some((v) => v.id === it.id)).map((it) => (
                <option key={it.id} value={it.id}>{it.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </>
  );
}

/* Shape of the real page — two cards of fields — so the layout does not jump when the fetch
   lands. Not a spinner: the reader sees where the controls will be. */
function PrefsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your preferences">
      {[0, 1].map((card) => (
        <div key={card} className="rounded-2xl border border-[var(--border)] bg-card">
          <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
            <Skeleton className="mt-0.5 size-4 rounded" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4 last:border-0">
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SectionCard({ icon, title, description, children }: {
  icon: React.ReactNode; iconTone?: string; title: string; description: string; children: React.ReactNode;
}) {
  // Delegates to the shared Panel so every section in Settings has one header anatomy.
  return (
    <Panel icon={icon} title={title} description={description}>
      {children}
    </Panel>
  );
}

/* The preview writes through the theme engine, so the choice is remembered for the
   signed-out login page too. It used to set the attribute directly and lose it. */
function applyThemeNow(dark: boolean, dense: boolean, anim: boolean, fontSize: number) {
  applyThemeChoice({ dark, dense, animations: anim, fontSize });
}

/** The exact payload the preferences Save writes, and the shape the dirty check
 *  compares against. Kept in one place so "dirty" and "what gets saved" can never
 *  drift apart. */
type PrefValues = {
  theme: "light" | "dark";
  density: "comfortable" | "compact";
  compact: boolean;
  animations: boolean;
  chat_font_size: number;
  show_rag_sources: boolean;
  show_token_usage: boolean;
  markdown_rendering: boolean;
};

/* ============================================================
   PAGE
============================================================ */

export default function Settings({ role }: { role?: string }) {
  /* The open section is part of the address (`#/settings?tab=retention`), so a refresh or a
     pasted link lands where it says. */
  const [active, setActive] = useSectionParam(SECTION_IDS, "general", "settings");
  // v0.21.90 — role gating: user/IT Support/Knowledge Manager only see Preferences,
  // AI Assistant, Notifications. Integrations + Mail are admin-only.
  const isAdmin = role === "admin";

  const [saved, setSaved] = useState(false);

  // Personal preferences backed by typed user_settings fields where available.
  const [darkMode, setDarkMode] = useState(false);
  const [compact, setCompact] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [chatFontSize, setChatFontSize] = useState(16);
  const [sourceCitations, setSourceCitations] = useState(true);
  const [showTokenUsage, setShowTokenUsage] = useState(true);
  const [markdownRendering, setMarkdownRendering] = useState(true);

  /* Branding is an administrator's preference too, so it rides in this form: the name is
     staged here and written by the SAME Save button as everything else (it used to have a
     "Save name" button of its own, which made the page have two ideas of "saved"). */
  const [brandName, setBrandName] = useState<string | null>(null);
  const [brandBaseline, setBrandBaseline] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* Loading is a state the reader can see: before the fetch lands the controls used to show
     defaults (Light, 16px, everything on) that looked exactly like stored values, and Save was
     live — one click wrote those defaults over the account's real settings. */
  const [prefsState, setPrefsState] = useState<"loading" | "ready" | "error">("loading");
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // v1.6.90 — the last values known to be stored server-side. `dirty` is derived by
  // comparing the live form to this baseline, so the sticky footer can tell the truth
  // about whether there is anything to save, and Discard can restore it exactly.
  const [baseline, setBaseline] = useState<PrefValues | null>(null);

  const currentValues: PrefValues = {
    theme: darkMode ? "dark" : "light",
    density: compact ? "compact" : "comfortable",
    compact,
    animations,
    chat_font_size: chatFontSize,
    show_rag_sources: sourceCitations,
    show_token_usage: showTokenUsage,
    markdown_rendering: markdownRendering,
  };
  const dirty = baseline !== null && (
    JSON.stringify(currentValues) !== JSON.stringify(baseline)
    || (isAdmin && brandName !== brandBaseline)
  );

  // The API returns a flat preference object (older servers may wrap it).
  useEffect(() => {
    let mounted = true;
    getMySettings()
      .then((s) => {
        if (!mounted) return;
        const dark = s.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : s.theme ? s.theme === "dark" : !!s.darkMode;
        const dense = typeof s.compact === "boolean" ? s.compact : s.density === "compact";
        const fontSize = typeof s.chat_font_size === "number" ? s.chat_font_size : 14;
        const anim = s.animations !== false;
        const showSources = typeof s.show_rag_sources === "boolean" ? s.show_rag_sources : true;
        const showTokens = typeof s.show_token_usage === "boolean" ? s.show_token_usage : true;
        const mdRender = typeof s.markdown_rendering === "boolean" ? s.markdown_rendering : true;
        setDarkMode(dark);
        setCompact(dense);
        setAnimations(anim);
        setChatFontSize(fontSize);
        setSourceCitations(showSources);
        setShowTokenUsage(showTokens);
        setMarkdownRendering(mdRender);
        setBaseline({
          theme: dark ? "dark" : "light",
          density: dense ? "compact" : "comfortable",
          compact: dense,
          animations: anim,
          chat_font_size: fontSize,
          show_rag_sources: showSources,
          show_token_usage: showTokens,
          markdown_rendering: mdRender,
        });
        applyThemeNow(dark, dense, anim, fontSize);
        setPrefsState("ready");
      })
      .catch((e) => {
        if (!mounted) return;
        setPrefsState("error");
        setPrefsError(e?.message || "Could not load saved settings");
      });

    // The brand name is part of this form for an administrator, so it loads with it.
    if (isAdmin) {
      fetchBranding()
        .then((b) => { if (!mounted) return; setBrandName(b.appName ?? ""); setBrandBaseline(b.appName ?? ""); })
        .catch(() => {});
    }
    return () => { mounted = false; };
  }, [reloadKey]);

  function retryPrefs() {
    setPrefsState("loading");
    setPrefsError(null);
    setReloadKey((k) => k + 1);
  }

  async function saveSettings() {
    setSaving(true); setSaveError(null);
    const payload = currentValues;
    try {
      await updateMySettings(payload);
      // One Save: the brand name rides with the preferences (admin only, and only when it
      // actually changed — the endpoint is administrator-gated).
      if (isAdmin && brandName !== brandBaseline) {
        const r = await apiFetch(`${BASE}/api/admin/branding/app-name`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ appName: brandName ?? "" }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.detail || `Brand name was not saved (HTTP ${r.status})`);
        }
        const b = await fetchBranding();
        refreshBrandingCache(b);
        setBrandName(b.appName ?? "");
        setBrandBaseline(b.appName ?? "");
      }
      applyThemeNow(darkMode, compact, animations, chatFontSize);
      window.dispatchEvent(new CustomEvent("ith:settings-saved", { detail: payload }));
      setBaseline(currentValues);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || "Save failed");
    } finally { setSaving(false); }
  }

  /* Theme is an appearance choice, not a form field. It used to live only in React state
     until "Save changes" was pressed, so picking Dark and leaving the page — or signing out
     and back in — came back light. Save it the moment it is picked. */
  async function chooseTheme(dark: boolean) {
    setDarkMode(dark);
    applyThemeNow(dark, compact, animations, chatFontSize);
    const theme = dark ? "dark" : "light";
    try {
      await updateMySettings({ theme });
      setBaseline((b) => (b ? { ...b, theme } : b));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      window.dispatchEvent(new CustomEvent("ith:theme-changed", { detail: { theme } }));
    } catch (err: any) {
      setSaveError(err?.message || "Could not save the theme");
    }
  }

  /** Restore the form to the last stored values and re-apply the theme. */
  function discardChanges() {
    if (!baseline) return;
    const dark = baseline.theme === "dark";
    setDarkMode(dark);
    setCompact(baseline.compact);
    setAnimations(baseline.animations);
    setChatFontSize(baseline.chat_font_size);
    setSourceCitations(baseline.show_rag_sources);
    setShowTokenUsage(baseline.show_token_usage);
    setMarkdownRendering(baseline.markdown_rendering);
    if (isAdmin && brandBaseline !== null) setBrandName(brandBaseline);
    applyThemeNow(dark, baseline.compact, baseline.animations, baseline.chat_font_size);
    setSaveError(null);
  }

  /* A deep link can name a section this role cannot see (an IT-support user opening an
     administrator's `?tab=retention`). Land on Preferences rather than an empty page. */
  useEffect(() => {
    const allowed = SETTINGS_NAV.flatMap((g) => g.items)
      .filter((item) => isAdmin || item.id === "general" || item.id === "notifications")
      .map((item) => item.id);
    if (!allowed.includes(active)) setActive("general");
  }, [active, isAdmin, setActive]);

  const visibleItems = SETTINGS_NAV
    .flatMap((group) => group.items)
    // Everyone gets their own notification preferences; the rest is administrator work.
    .filter((item) => isAdmin || item.id === "general" || item.id === "notifications");

  // Right-rail facts. Both are the app's real values, not decoration: the access
  // level is the signed-in role and the environment is the build mode the app runs.
  const roleLabel = isAdmin ? "Administrator" : role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member";
  const buildMode = import.meta.env.MODE || "production";
  const environment = buildMode.charAt(0).toUpperCase() + buildMode.slice(1);

  return (
    <PageShell>
      <div className="flex min-h-full flex-col">
        <PageHeader
          breadcrumbs={["Workspace", "Settings"]}
          icon={<SettingsIcon className="size-5" />}
          title="Settings"
          description="Manage your workspace, connections, and preferences."
          actions={
            <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-2xs font-medium text-muted-foreground">
              {isAdmin ? "Administrator" : "Personal settings"}
            </span>
          }
        />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
          <SettingsRail
            visible={visibleItems}
            active={active}
            onSelect={setActive}
            environment={environment}
            roleLabel={roleLabel}
          />

          {/* Two-column body inside the rail: content on the left, the 340px aside right.
              Below xl the aside folds under the content and the column keeps full width. */}
          <main className="flex min-w-0 flex-1 items-start gap-8">
            <div className="min-w-0 flex-1 space-y-4">

            {/* The form is only shown once the stored values are known: painting defaults in
                the meantime is how a user ends up saving Light/16px over their real settings. */}
            {active === "general" && prefsState === "loading" && <PrefsSkeleton />}
            {active === "general" && prefsState === "error" && (
              <div className="rounded-2xl border border-[var(--border)] bg-card">
                <ErrorState
                  title="Could not load your preferences"
                  detail={prefsError}
                  onRetry={retryPrefs}
                />
                <p className="px-5 pb-4 text-xs text-muted-foreground">
                  Nothing has been changed on this account. The controls stay hidden until the
                  stored values load, so a save cannot overwrite them with defaults.
                </p>
              </div>
            )}
            {active === "general" && prefsState === "ready" && (
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
            {/* ---- Answers: every control here changes how a message is rendered. ---- */}
            {active === "general" && (
              <SectionCard
                icon={<Bot className="size-4.5" />}
                title="Chat"
                description="Choose how answers appear in your desktop app."
              >
                <Row title="Chat font size" hint="Text size used throughout the conversation.">
                  <Segmented
                    label="Chat font size"
                    value={String(chatFontSize)}
                    options={[
                      { value: "12", label: "12" },
                      { value: "14", label: "14" },
                      { value: "16", label: "16" },
                      { value: "18", label: "18" },
                    ]}
                    onChange={(v) => {
                      const size = Number(v);
                      setChatFontSize(size);
                      applyThemeNow(darkMode, compact, animations, size);
                    }}
                  />
                </Row>
                <ToggleRow checked={sourceCitations} onChange={setSourceCitations}
                  title="Show source citations"
                  description="Show referenced knowledge articles with assistant answers." />
                <ToggleRow checked={showTokenUsage} onChange={setShowTokenUsage}
                  title="Show token usage"
                  description="Show input and output token counts below assistant answers." />
                <ToggleRow checked={markdownRendering} onChange={setMarkdownRendering}
                  title="Format Markdown"
                  description="Render headings, lists, tables, links, and code blocks in answers." />
              </SectionCard>
            )}

            {/* ==================== APPEARANCE ==================== */}
            {active === "general" && (
              <SectionCard
                icon={<Monitor className="size-4.5" />}
                title="Appearance"
                description="Customize how the application looks."
              >
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">Theme mode</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Choose between light and dark interface</p>
                    </div>
                    <div className="flex gap-2" role="group" aria-label="Theme mode">
                      {(["light", "dark"] as const).map((option) => {
                        const on = (option === "dark") === darkMode;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => void chooseTheme(option === "dark")}
                            aria-pressed={on}
                            className={[
                              "w-[104px] rounded-xl border p-1.5 text-left transition",
                              on
                                ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                                : "border-[var(--border)] hover:border-[var(--primary)]/40",
                            ].join(" ")}
                          >
                            {/* miniature of the actual workspace chrome, so the choice is visible
                                before it is applied rather than described in words */}
                            <span
                              className={[
                                "flex h-12 w-full gap-1 overflow-hidden rounded-lg border p-1",
                                option === "dark"
                                  ? "border-[#2A253A] bg-[#09090F]"
                                  : "border-[#E3E1EA] bg-[#F7F8FC]",
                              ].join(" ")}
                              aria-hidden
                            >
                              <span className={["w-3 rounded-sm", option === "dark" ? "bg-[#11111B]" : "bg-gradient-to-b from-[#7C3AED] to-[#5B21B6]"].join(" ")} />
                              <span className="flex flex-1 flex-col gap-1">
                                <span className={["h-1.5 w-2/3 rounded-sm", option === "dark" ? "bg-[#8B5CF6]" : "bg-[#C4B5FD]"].join(" ")} />
                                <span className={["h-1.5 w-full rounded-sm", option === "dark" ? "bg-[#222236]" : "bg-[#E3E1EA]"].join(" ")} />
                                <span className={["h-1.5 w-4/5 rounded-sm", option === "dark" ? "bg-[#222236]" : "bg-[#E3E1EA]"].join(" ")} />
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-1 px-0.5 text-2xs font-medium capitalize text-foreground">
                              {option}
                              {on && <Check className="size-3 text-[var(--primary)]" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <Row title="Compact mode" hint="Smaller text and tighter spacing across every page — for wide monitors.">
                  <Toggle checked={compact} onChange={(v) => { setCompact(v); applyThemeNow(darkMode, v, animations, chatFontSize); }} label="Compact mode" />
                </Row>
                <Row title="Animations" hint="Interface transitions and motion.">
                  <Toggle checked={animations} onChange={(v) => {
                    setAnimations(v);
                    applyThemeNow(darkMode, compact, v, chatFontSize);
                  }} label="Animations" />
                </Row>
              </SectionCard>
            )}

            {/* Integrations are administrator-only: the configuration screen holds
                credentials (LLM key, Jira token, LDAP bind, SMTP) and the connection
                tests, so a member must not reach it at all — not even the read-only
                "my tools" catalogue, which probed every provider's config on mount. */}

            {/* Branding — admin only (logo on login + sidebar) */}
            {isAdmin && active === "general" && (
            <SectionCard
              icon={<ImageIcon className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />}
              iconTone="bg-fuchsia-50 dark:bg-fuchsia-950/40"
              title="Branding"
              description="Custom logo and brand name shown on the login page and sidebar."
            >
              <div className="p-5">
                <BrandingSettings
                  appName={brandName}
                  onAppNameChange={setBrandName}
                />
              </div>
            </SectionCard>
            )}

              </div>

              {/* Rail: the settings in force right now, so the form below reads as a diff
                  against something visible rather than a wall of toggles. */}
              <aside className="space-y-4 xl:sticky xl:top-6">
                <section data-slot="card" className="rounded-2xl border border-[var(--border)] bg-card p-4">
                  <h2 className="text-sm font-semibold">Your setup</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">What the interface uses right now.</p>
                  <dl className="mt-3 space-y-2.5">
                    {[
                      ["Theme", darkMode ? "Dark" : "Light"],
                      ["Chat text", `${chatFontSize}px`],
                      ["Density", compact ? "Compact" : "Comfortable"],
                      ["Motion", animations ? "On" : "Off"],
                      ["Citations", sourceCitations ? "Shown" : "Hidden"],
                      ["Token usage", showTokenUsage ? "Shown" : "Hidden"],
                      ["Markdown", markdownRendering ? "Formatted" : "Plain"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
                        <dt className="shrink-0 text-muted-foreground">{k}</dt>
                        <dd className="min-w-0 truncate text-right font-medium" title={v}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section data-slot="card" className="rounded-2xl border border-[var(--border)] bg-card p-4">
                  <h2 className="text-sm font-semibold">Save</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Theme, density and motion apply as you change them, but they are stored for this
                    account only when you save.
                  </p>

                  <button
                    type="button"
                    onClick={saveSettings}
                    disabled={saving || prefsState !== "ready" || !dirty}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                  >
                    <Save className="size-3.5" aria-hidden />
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={discardChanges}
                    disabled={!dirty || saving}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-foreground transition hover:bg-muted/50 disabled:opacity-50"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Discard changes
                  </button>

                  <div className="mt-3 text-xs" aria-live="polite">
                    {saving ? (
                      <span className="text-muted-foreground">Saving…</span>
                    ) : saved ? (
                      <span className="flex items-center gap-1.5 font-medium text-[var(--ok)]">
                        <Check className="size-3.5" /> Saved
                      </span>
                    ) : dirty ? (
                      <span className="flex items-center gap-1.5 font-medium text-[var(--warn)]">
                        <span className="size-1.5 rounded-full bg-[var(--warn)]" /> Unsaved changes
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No unsaved changes</span>
                    )}
                    {saveError && (
                      <span className="mt-1 flex items-start gap-1 text-[var(--danger)]">
                        <XCircle className="mt-0.5 size-3 shrink-0" /> {saveError}
                      </span>
                    )}
                  </div>
                </section>
              </aside>
            </div>
            )}

            {/* ==================== INTEGRATIONS ==================== */}

            {active === "integrations" && (
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              {/* The catalogue and the provider editor are the work; the header card that
                  used to sit above them only repeated the tab's own name. The readiness
                  strip answers the only question that matters after a fresh install:
                  is anything still missing? */}
              <div className="space-y-4">
                <SetupChecklist />
                <IntegrationsConfig />
              </div>

              {/* Live health used to sit below the whole page, under the fold, where it was
                  read only after something had already failed. */}
              <aside className="space-y-4 xl:sticky xl:top-6">
                <section data-slot="card" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
                    <span className="size-1.5 rounded-full bg-[var(--ok)]" />
                    <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Service status</h2>
                  </div>
                  <div className="p-3">
                    <IntegrationStatusCards />
                  </div>
                </section>

                <section data-slot="card" className="rounded-2xl border border-[var(--border)] bg-card p-4">
                  <h2 className="text-sm font-semibold">How this works</h2>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
                    <li className="flex gap-1.5">
                      <span className="mt-1 size-1 shrink-0 rounded-full bg-[var(--primary)]" />
                      Switching a provider on only reveals its panel — nothing connects until you save its fields.
                    </li>
                    <li className="flex gap-1.5">
                      <span className="mt-1 size-1 shrink-0 rounded-full bg-[var(--primary)]" />
                      Credentials are write-only: stored server-side and never returned, so a wrong value is fixed by replacing it, not by reading it.
                    </li>
                    <li className="flex gap-1.5">
                      <span className="mt-1 size-1 shrink-0 rounded-full bg-[var(--primary)]" />
                      “Remove stored settings” inside a panel is the only way to revoke a connection.
                    </li>
                  </ul>
                </section>
              </aside>
            </div>
            )}

            {/* Email & Notifications — one tab. The bell's switches are personal (every
                role), the SMTP server below them is administrator-only. */}
            {active === "notifications" && (
              <>
                <SectionCard
                  icon={<BellRing className="size-4" />}
                  iconTone="bg-amber-50 dark:bg-amber-950/40"
                  title="Notifications"
                  description="What the bell may tell you, how it sounds, and how to clear it."
                >
                  <NotificationSettings isAdmin={isAdmin} />
                </SectionCard>
                {isAdmin && <EmailServerSettings />}
              </>
            )}


            {/* ==================== AI ASSISTANT ==================== */}
            {/* Provider, credentials, model detection and the retrieval knobs are one
                decision, so they are one section with one Save. */}
            {active === "skills" && <AiServiceSettings isAdmin={isAdmin} />}

            {/* The component renders its own Panels (SettingsKit), so it is not wrapped in
                SectionCard — one card inside another reads as a different page. */}
            {active === "retention" && isAdmin && <DataRetentionSettings />}
            </div>

          </main>
        </div>

      </div>
    </PageShell>
  );
}

/* ============================================================
   INTEGRATIONS STATUS CARDS + EDITOR + SYSTEM HEALTH (live)
============================================================ */

/** The four connected systems, at a glance, on every settings tab. */
function IntegrationStatusCards() {
  const [services, setServices] = useState<any[]>([]);
  const [cfg, setCfg] = useState<Record<string, any>>({});

  useEffect(() => {
    dashHealth()
      .then((list) => setServices(Array.isArray(list) ? list : []))
      .catch(() => {});
    Promise.all([
      getIntegrationSettings("confluence"),
      getIntegrationSettings("jira"),
      getIntegrationSettings("ldap"),
      getIntegrationSettings("llm"),
    ]).then((vals) => {
      const map: Record<string, any> = {};
      vals.forEach((v: any, i: number) => { map[["confluence", "jira", "ldap", "llm"][i]] = v?.settings ?? v; });
      setCfg(map);
    }).catch(() => {});
  }, []);

  const st = (needle: string) => {
    const hit = services.find((s) => (s.name || "").toLowerCase().includes(needle));
    return hit ? hit.status : null;
  };
  const chip = (needle: string) => {
    const s = st(needle);
    if (!s) return null;
    const ok = /healthy|ok|up/i.test(s);
    return (
      <span className={["inline-flex items-center gap-1 text-xs font-medium", ok ? "text-[var(--ok)]" : "text-[var(--danger)]"].join(" ")}>
        <span className={["size-1.5 rounded-full", ok ? "bg-[var(--ok)]" : "bg-[var(--danger)]"].join(" ")} />
        {ok ? "Connected" : s}
      </span>
    );
  };

  const cards = [
    { key: "confluence", name: "Confluence", desc: "Knowledge base and documentation source.",
      detail: cfg.confluence?.base_url ? `URL: ${cfg.confluence.base_url}` : "URL: (configured in Confluence tab)" },
    { key: "jira", name: "Jira", desc: "Issue tracking and ticket management.",
      detail: cfg.jira?.base_url ? `URL: ${cfg.jira.base_url}` : "URL: (configured)" },
    { key: "ldap", name: "LDAP / Active Directory", desc: "User authentication and group synchronization.",
      detail: cfg.ldap?.host ? `Server: ${cfg.ldap.host}:${cfg.ldap.port ?? 389}` : "Server: 10.10.10.10" },
    // The model provider's status lives in the AI service section now — it shows the
    // provider, model, key state and detection count, which is strictly more than this
    // card said. Keeping a second copy here is how the two screens drifted apart before.
    // Redis is infrastructure, not an integration: single sign-on is what the fourth slot
    // is for, and it is the one provider the catalogue lists that had no status anywhere.
    { key: "keycloak", name: "Keycloak SSO", desc: "Single sign-on over OpenID Connect.",
      detail: cfg.keycloak?.issuer ? `Issuer: ${cfg.keycloak.issuer}` : "Issuer: (not set)" },
  ];

  return (
    /* One column: this lives in the 340px rail, where two tiles side by side truncated
       every URL down to "URL: (con…". */
    <div className="space-y-2">
      {cards.map((c) => (
        <div
          key={c.key}
          className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-background/60 p-2.5 transition hover:border-[var(--primary)]/30"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] p-1 ring-1 ring-[var(--border)] dark:bg-white/[0.03]">
            <IntegrationLogo providerKey={c.key} name={c.name} size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold">{c.name}</span>
              {chip(c.key)}
            </div>
            <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground" title={c.detail}>
              {c.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
