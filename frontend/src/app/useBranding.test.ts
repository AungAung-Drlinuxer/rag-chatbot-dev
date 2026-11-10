import { describe, expect, it } from "vitest";
import { brandInitials, displayAppName, DEFAULT_APP_NAME } from "./useBranding";

/**
 * The mark and the name are the administrator's, not the product's.
 *
 * Before this there was a literal "iTH" in four places and "IT Help Chatbot" as the name
 * fallback. An installation that renamed itself still carried both.
 */
describe("branding display", () => {
  it("derives the mark from the name the administrator chose", () => {
    expect(brandInitials("Acme IT")).toBe("AI");
    expect(brandInitials("Zenith")).toBe("ZE");
    expect(brandInitials("Global Helpdesk Operations")).toBe("GH");
  });

  it("uses a neutral built-in name when nothing is configured", () => {
    expect(DEFAULT_APP_NAME).not.toMatch(/chatbot/i);
    expect(displayAppName(null)).toBe(DEFAULT_APP_NAME);
    expect(displayAppName("   ")).toBe(DEFAULT_APP_NAME);
  });

  it("never falls back to a product name", () => {
    expect(displayAppName("Acme IT")).toBe("Acme IT");
    expect(brandInitials(null)).toBe(brandInitials(DEFAULT_APP_NAME));
    expect(brandInitials(null)).not.toBe("iTH");
  });
});
