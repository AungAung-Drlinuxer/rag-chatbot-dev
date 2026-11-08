import { describe, it, expect, beforeEach } from "vitest";
import { applyStoredTheme, applyUserPrefs } from "./theme";

describe("theme engine", () => {
  beforeEach(() => {
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
});
