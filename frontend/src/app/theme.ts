/** Theme engine — the single owner of [data-theme].
 * Theme and UI preferences are fetched from the server DB on user login / session restore.
 * No preferences are stored in local files / localStorage.
 */

export function applyStoredTheme(): void {
  // Initial default before server preferences load
  const current = document.documentElement.getAttribute("data-theme");
  if (!current || current === "undefined") {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

/** Server-prefs -> DOM. Accepts either `theme` ("light"|"dark"|"system") or `darkMode`.
 *  Applies directly to DOM. Never writes to localStorage.
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
  const compact = typeof s?.compact === "boolean" ? s.compact : s?.density === "compact";
  root.dataset.compact = compact ? "1" : "0";
  if (typeof s?.animations === "boolean") {
    root.classList.toggle("animations-off", !s.animations);
  }
  root.style.setProperty("--chat-font-size", `${s?.chat_font_size || 14}px`);
}
