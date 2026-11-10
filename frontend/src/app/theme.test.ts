import { describe, it, expect, beforeEach } from "vitest";
import { applyStoredTheme, applyThemeChoice, applyUserPrefs, readStoredTheme } from "./theme";

describe("theme engine", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    delete (document.documentElement.dataset as any).compact;
    document.documentElement.classList.remove("animations-off");
  });

  it("applies default light theme when none set", () => {
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("applies user prefs from server object directly to DOM", () => {
    applyUserPrefs({ darkMode: true, compact: true, animations: false, chat_font_size: 16 });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.dataset.compact).toBe("1");
    expect(document.documentElement.classList.contains("animations-off")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("16px");
  });

  it("applies typed density preferences from the settings API", () => {
    applyUserPrefs({ density: "compact" });
    expect(document.documentElement.dataset.compact).toBe("1");
    applyUserPrefs({ density: "comfortable" });
    expect(document.documentElement.dataset.compact).toBe("0");
  });

  it("never writes 'undefined' into data-theme", () => {
    applyUserPrefs({});
    const val = document.documentElement.getAttribute("data-theme");
    expect(val).not.toBe("undefined");
    expect(["light", "dark"]).toContain(val);
  });

  it("resolves theme:'system' against the OS preference", () => {
    const original = window.matchMedia;
    // @ts-expect-error test stub
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    applyUserPrefs({ theme: "system" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    window.matchMedia = original;
  });

  /* Signing out is the case this cache exists for: the settings fetch no longer runs, so
     the login page has only the local word to go on. */
  it("remembers the theme applied by the Settings preview", () => {
    applyThemeChoice({ dark: true, dense: false, animations: true, fontSize: 14 });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("restores the remembered theme on a fresh document (signed out / reloaded)", () => {
    applyUserPrefs({ theme: "dark" });
    document.documentElement.removeAttribute("data-theme");
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("lets the server preference move the local copy", () => {
    applyThemeChoice({ dark: true, dense: false, animations: true, fontSize: 14 });
    applyUserPrefs({ theme: "light" });
    expect(readStoredTheme()).toBe("light");
  });

  it("explicit theme wins over a stale darkMode flag", () => {
    applyUserPrefs({ theme: "light", darkMode: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
