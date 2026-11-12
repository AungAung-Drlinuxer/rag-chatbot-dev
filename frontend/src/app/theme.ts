/** Theme engine — the single owner of [data-theme].
 *
 * Theme and UI preferences are fetched from the server DB on user login / session
 * restore. The *appearance* also keeps a local copy under one key: without it, signing out
 * dropped the DOM attribute on the next load and the login page came back light even for
 * a user who had chosen dark a second earlier. Nothing identifying is stored here — only
 * "light" or "dark".
 */

const THEME_KEY = "ith-theme";

function storeTheme(theme: string): void {
  try {
    if (theme === "dark" || theme === "light") localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / quota — the DOM attribute still applies for this page */
  }
}

export function readStoredTheme(): "light" | "dark" | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

/** Before the server answers (login screen, first paint) honour the last choice. */
export function applyStoredTheme(): void {
  const root = document.documentElement;
  const stored = readStoredTheme();
  if (stored) {
    root.setAttribute("data-theme", stored);
    return;
  }
  /* No stored choice (a first visit, or a private window): follow the operating system.
     Forcing "light" here is what gave a dark-desktop user a bright login page and then a
     dark app one click later. */
  const prefersDark =
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  root.setAttribute("data-theme", prefersDark ? "dark" : "light");
}

/** Server-prefs -> DOM. Accepts either `theme` ("light"|"dark"|"system") or `darkMode`.
 *  Applies directly to DOM and remembers the result for the next signed-out page.
 */
export function applyUserPrefs(s: any): void {
  const root = document.documentElement;
  let theme: string;
  // If theme is explicit ("dark" | "light"), trust theme over legacy darkMode.
  // "system" follows the OS — it used to fall through to the light default, which is why a
  // user on a dark desktop got a light app after signing in.
  if (s?.theme === "dark") {
    theme = "dark";
  } else if (s?.theme === "light") {
    theme = "light";
  } else if (s?.theme === "system") {
    theme = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } else if (typeof s?.darkMode === "boolean") {
    theme = s.darkMode ? "dark" : "light";
  } else {
    // Default to the reference light design
    theme = "light";
  }

  root.setAttribute("data-theme", theme);
  storeTheme(theme);
  const compact = typeof s?.compact === "boolean" ? s.compact : s?.density === "compact";
  root.dataset.compact = compact ? "1" : "0";
  if (typeof s?.animations === "boolean") {
    root.classList.toggle("animations-off", !s.animations);
  }
  root.style.setProperty("--chat-font-size", `${s?.chat_font_size || 14}px`);
}

/** Live preview from the Settings screen: same DOM contract, same local copy. */
export function applyThemeChoice(opts: {
  dark: boolean; dense: boolean; animations: boolean; fontSize: number;
}): void {
  const root = document.documentElement;
  const theme = opts.dark ? "dark" : "light";
  root.setAttribute("data-theme", theme);
  storeTheme(theme);
  root.dataset.compact = opts.dense ? "1" : "0";
  root.classList.toggle("animations-off", !opts.animations);
  root.style.setProperty("--chat-font-size", `${opts.fontSize}px`);
}
