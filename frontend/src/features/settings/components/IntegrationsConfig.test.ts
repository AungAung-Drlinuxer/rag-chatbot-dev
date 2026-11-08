import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./IntegrationsConfig";

/**
 * The JSM fields are what make an escalation land on a service desk instead of a plain
 * Task. They were accepted by the API (and stored in `system_settings`) for a while
 * without existing in this catalogue, so an admin had to set an environment variable —
 * which contradicts "every credential lives in the database". Pin them.
 */
describe("integration catalogue — Jira", () => {
  const jira = PROVIDERS.find((p) => p.key === "jira")!;

  it("exposes the JSM service desk and request-type fields", () => {
    const keys = jira.fields.map((f) => f.key);
    expect(keys).toContain("service_desk_id");
    expect(keys).toContain("request_types");
  });

  it("renders the request-type map as a multiline field with a hint", () => {
    const field = jira.fields.find((f) => f.key === "request_types")!;
    expect(field.multiline).toBe(true);
    expect(field.hint).toMatch(/general/);
  });

  it("keeps the credential write-only and the project key required", () => {
    expect(jira.fields.find((f) => f.key === "api_token")?.isSecret).toBe(true);
    expect(jira.fields.some((f) => f.key === "project_key")).toBe(true);
  });
});
