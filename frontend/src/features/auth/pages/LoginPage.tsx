import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  TicketCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { brandInitials, displayAppName, useBranding } from "@/app/useBranding";
import { healthPing } from "@/features/auth/api";

/**
 * Sign-in screen.
 *
 * Structure (v1.7.2):
 *   ┌ brand column (lg+) ──────────────┬ form column ─────────────┐
 *   │ framed panel: logo + status pill │ centred sign-in card     │
 *   │ headline + illustration window    │ (max-w 420, sticky-safe) │
 *   │ capability cards, legal footer    │ service status + legal   │
 *   └───────────────────────────────────┴──────────────────────────┘
 *
 * Every region is a bounded container rather than full-bleed text: the brand side is a
 * framed gradient panel on the card colour, the illustration sits inside a "window"
 * chrome, and the form is a single card. Below `lg` the brand column is replaced by a
 * compact branded band so the form keeps the whole viewport — the page never scrolls
 * sideways, from 320px phones to ultra-wide desktops.
 *
 * Branding (logo + app name) comes from the public /api/branding endpoint via
 * `useBranding()`; the gradient mark is the fallback when no logo is uploaded.
 */

type Props = {
  loginUser: string;
  setLoginUser: (v: string) => void;
  loginPass: string;
  setLoginPass: (v: string) => void;
  loginErr: string;
  onSubmit: (e: FormEvent) => void;
  /** True when an OIDC realm is configured — shows the second way in. */
  ssoEnabled?: boolean;
  /** Provider metadata from /api/auth/sso/enabled — used to name the provider. */
  sso?: { enabled: boolean; provider: string; label: string; realm: string };
  onSso?: () => void;
};

/** Keycloak's mark, drawn small: a key head with a shaft and two teeth. Uses currentColor
 *  so it inherits the theme's primary colour instead of hard-coding Keycloak blue. */
function KeycloakMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="4.2" />
      <path d="M11 11l9 9" />
      <path d="M16.5 15.5l2.5-2.5" />
      <path d="M19 18l2-2" />
    </svg>
  );
}

export default function Login({
  loginUser,
  setLoginUser,
  loginPass,
  setLoginPass,
  loginErr,
  onSubmit,
  ssoEnabled = false,
  sso,
  onSso,
}: Props) {
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const branding = useBranding();
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  const appName = displayAppName(branding.appName);

  /* Single sign-on is offered under its real name. "SSO" told the user nothing about
     where they were being sent; Keycloak is what the realm actually is, and the realm
     name is public (it is in the redirect the browser follows). */
  const showSso = sso ? sso.enabled : ssoEnabled;
  const ssoLabel = sso?.label || "Keycloak";
  const ssoRealm = sso?.realm || "";


  // v1.5.1 — client-side validation before hitting the server
  function handleLocalSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = loginUser.trim();
    if (!u || !loginPass) {
      setFieldErr(!u ? "Please enter your username." : "Please enter your password.");
      return;
    }
    setFieldErr(null);
    setSubmitting(true);
    // The parent resets state on completion via re-render; reset after a generous
    // window in case the parent does not unmount (a failed login keeps the form).
    window.setTimeout(() => setSubmitting(false), 12000);
    onSubmit(e);
  }

  useEffect(() => {
    let mounted = true;
    healthPing().then((ok) => { if (mounted) setBackendUp(ok); });
    return () => { mounted = false; };
  }, []);

  const canSubmit = !!loginUser.trim() && !!loginPass && !submitting;

  return (
    <div className="relative min-h-[100svh] bg-background text-foreground">
      {/* ambient decoration — clipped, never scrollable */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-24 size-[28rem] rounded-full bg-[var(--primary)]/10 blur-[100px]" />
        <div className="absolute -bottom-40 right-0 size-[26rem] rounded-full bg-[var(--primary)]/10 blur-[110px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at 30% 20%, black, transparent 72%)",
            WebkitMaskImage: "radial-gradient(ellipse at 30% 20%, black, transparent 72%)",
          }}
        />
      </div>

      <div className="relative mx-auto grid w-full max-w-[1680px] lg:min-h-[100svh] lg:grid-cols-[minmax(0,1fr)_minmax(400px,520px)]">
        {/* ============================ BRAND COLUMN ============================ */}
        <section className="relative hidden min-h-0 flex-col p-4 lg:flex xl:p-6">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-gradient-to-b from-card via-card to-muted/40 shadow-xs">
            {/* framed header */}
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-6 py-4 xl:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <Logo branding={branding} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold tracking-tight">{appName}</p>
                  <p className="truncate text-2xs font-medium text-muted-foreground">
                    AI-powered IT support
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-background/70 px-2.5 py-1 text-2xs font-medium text-muted-foreground backdrop-blur">
                <span className="size-1.5 rounded-full bg-[var(--ok)]" />
                Internal IT platform
              </span>
            </header>

            {/* flexible content area */}
            <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-6 py-6 xl:px-8 xl:py-8">
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4.5">
                <div>
                  <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-[32px]">
                    Find the right{" "}
                    <span className="bg-gradient-to-r from-[var(--primary)] to-[var(--accent-foreground)] bg-clip-text text-transparent">
                      IT answer faster.
                    </span>
                  </h1>
                  <p className="mt-2 max-w-[54ch] text-sm leading-relaxed text-muted-foreground">
                    Search your internal knowledge base, get grounded answers, verify the source,
                    and escalate to IT support when you need a human.
                  </p>
                </div>

                {/* illustration inside a structured "app window" frame — fills frame edge-to-edge */}
                <figure className="w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-background shadow-sm">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] bg-muted/40 px-3 py-2">
                    <span className="flex gap-1" aria-hidden>
                      <span className="size-1.5 rounded-full bg-[var(--danger)]/50" />
                      <span className="size-1.5 rounded-full bg-[var(--warn)]/60" />
                      <span className="size-1.5 rounded-full bg-[var(--ok)]/50" />
                    </span>
                    <span className="truncate text-2xs font-medium text-muted-foreground">
                      {appName} · assistant workspace
                    </span>
                  </div>
                  <img
                    src="/login-illustration.jpg"
                    width={1280}
                    height={548}
                    alt="IT Help assistant illustration — search IT knowledge, verify sources, escalate if needed"
                    className="pointer-events-none block h-auto w-full select-none object-cover"
                    style={{ aspectRatio: "1280 / 548" }}
                    fetchPriority="high"
                    decoding="async"
                    draggable={false}
                  />
                </figure>

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <FeatureCard icon={<BookOpenCheck className="size-4" />} title="Grounded" description="Answers use internal knowledge." />
                  <FeatureCard icon={<Link2 className="size-4" />} title="Traceable" description="Sources stay visible." />
                  <FeatureCard icon={<TicketCheck className="size-4" />} title="Actionable" description="Escalate when needed." />
                </div>
              </div>
            </div>

            {/* framed footer */}
            <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border)] px-6 py-3.5 text-2xs text-muted-foreground xl:px-8">
              <span>Internal IT Service</span>
              <Dot />
              <span>RBAC protected</span>
              <Dot />
              <span>Secure access</span>
            </footer>
          </div>
        </section>

        {/* ============================ FORM COLUMN ============================ */}
        <main className="flex min-h-[100svh] min-w-0 flex-col lg:min-h-0 lg:border-l lg:border-[var(--border)] lg:bg-muted/20">
          {/* mobile / tablet brand band — takes over the desktop brand column */}
          <div className="lg:hidden">
            <div className="relative overflow-hidden rounded-b-[28px] border-b border-[var(--border)] bg-gradient-to-br from-[var(--primary)] to-[var(--primary)] px-5 pb-6 pt-5 text-[var(--primary-foreground)]">
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-white/10 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <Logo branding={branding} size="sm" onDark />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold tracking-tight">{appName}</p>
                  <p className="truncate text-2xs text-white/70">AI-powered IT support</p>
                </div>
                <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-2xs font-medium sm:inline-flex">
                  <span className="size-1.5 rounded-full bg-emerald-300" /> Internal
                </span>
              </div>
              <p className="relative mt-4 max-w-[34ch] text-[15px] font-medium leading-snug sm:hidden">
                Grounded IT answers, with the source attached.
              </p>
              <img
                src="/login-illustration.jpg"
                alt=""
                aria-hidden
                className="relative mt-3 block h-auto w-full max-w-full rounded-xl shadow-sm ring-1 ring-white/15"
                style={{ aspectRatio: "1280 / 548", maxHeight: 460 }}
                decoding="async"
                draggable={false}
              />
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
            <div className="w-full max-w-[420px]">
              {/* sign-in card */}
              <div className="rounded-3xl border border-[var(--border)] bg-card p-5 text-card-foreground shadow-[0_20px_60px_-24px_rgba(24,16,45,0.35)] sm:p-7">
                <div className="mb-6">
                  <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-[var(--accent)] text-[var(--accent-foreground)]">
                    <LockKeyhole className="size-5" />
                  </div>
                  <h2 className="text-[clamp(1.375rem,4vw,1.625rem)] font-semibold tracking-tight">
                    Welcome back
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    Sign in with your corporate account to access the IT knowledge assistant.
                  </p>
                </div>

                <form onSubmit={handleLocalSubmit} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="login-username" className="mb-1.5 block text-xs font-semibold text-foreground">
                      Username
                    </label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        id="login-username"
                        name="username"
                        type="text"
                        placeholder="Corporate username"
                        autoComplete="username"
                        autoFocus
                        value={loginUser}
                        onChange={(e) => setLoginUser(e.target.value)}
                        aria-invalid={!!fieldErr && !loginUser.trim()}
                        className="h-11 w-full rounded-xl border border-[var(--border)] bg-background pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/12"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="login-password" className="mb-1.5 block text-xs font-semibold text-foreground">
                      Password
                    </label>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        id="login-password"
                        name="password"
                        type={showPass ? "text" : "password"}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        value={loginPass}
                        onChange={(e) => setLoginPass(e.target.value)}
                        aria-invalid={!!fieldErr && !loginPass}
                        className="h-11 w-full rounded-xl border border-[var(--border)] bg-background pl-10 pr-12 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/12"
                      />
                      <button
                        type="button"
                        aria-label={showPass ? "Hide password" : "Show password"}
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  {!loginErr && fieldErr && (
                    <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2.5 text-xs text-[var(--warn)]">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{fieldErr}</span>
                    </div>
                  )}
                  {loginErr && (
                    <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2.5 text-xs text-[var(--danger)]">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{loginErr}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </button>

                  {showSso && onSso && (
                    <>
                      <div className="flex items-center gap-3 py-1" aria-hidden="true">
                        <span className="h-px flex-1 bg-[var(--border)]" />
                        <span className="text-2xs uppercase tracking-wide text-muted-foreground">or</span>
                        <span className="h-px flex-1 bg-[var(--border)]" />
                      </div>
                      <button
                        type="button"
                        onClick={onSso}
                        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted/50 focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15 active:scale-[0.99]"
                      >
                        <KeycloakMark className="size-4 shrink-0 text-[var(--primary)]" />
                        <span>Sign in with {ssoLabel}</span>
                      </button>
                      <p className="text-center text-2xs text-muted-foreground">
                        {ssoRealm
                          ? `via ${ssoLabel} single sign-on · realm ${ssoRealm}. Ask IT if you are not enrolled.`
                          : `via ${ssoLabel} single sign-on. Ask IT if you are not enrolled.`}
                      </p>
                    </>
                  )}
                </form>

                <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-muted/30 px-3 py-2 text-2xs">
                  {backendUp === null ? (
                    <><span className="size-2 animate-pulse rounded-full bg-muted-foreground/50" /><span className="text-muted-foreground">Checking service status…</span></>
                  ) : backendUp ? (
                    <><CheckCircle2 className="size-3.5 text-[var(--ok)]" /><span className="text-muted-foreground">IT Help service is available</span></>
                  ) : (
                    <><AlertCircle className="size-3.5 text-[var(--warn)]" /><span className="text-[var(--warn)]">IT Help service is currently unavailable</span></>
                  )}
                </div>
              </div>

              <p className="mt-4 flex items-center justify-center gap-1.5 px-2 text-center text-2xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0 text-[var(--ok)]" />
                Authorized corporate users only · SSO &amp; RBAC protected
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Dot() {
  return <span aria-hidden className="size-1 rounded-full bg-[var(--border)]" />;
}

/** Logo tile: uploaded logo when branding provides one, gradient monogram otherwise. */
function Logo({ branding, size, onDark = false }: {
  branding: { logo: string | null; appName: string | null };
  size: "sm" | "md";
  onDark?: boolean;
}) {
  const box = size === "sm" ? "size-10 rounded-xl text-xs" : "size-11 rounded-2xl text-sm";
  if (branding.logo) {
    return (
      <img
        src={branding.logo}
        alt={branding.appName ? `${branding.appName} logo` : "Company logo"}
        className={`${box} shrink-0 object-contain ${onDark ? "bg-white/95 p-1 ring-1 ring-white/30" : "bg-background p-1 ring-1 ring-[var(--border)]"}`}
      />
    );
  }
  return (
    <div
      className={`${box} grid shrink-0 place-items-center bg-[var(--primary)] font-extrabold tracking-tight text-white shadow-sm ${onDark ? "ring-1 ring-white/30" : ""}`}
    >
      {brandInitials(branding.appName)}
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-background/70 px-3 py-2.5 backdrop-blur-sm transition hover:border-[var(--primary)]/35">
      <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
        {icon}
      </div>
      <div className="min-w-0">
        <span className="text-2xs font-semibold leading-4">{title}</span>
        <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
