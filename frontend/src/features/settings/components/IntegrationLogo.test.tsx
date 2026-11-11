import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { IntegrationLogo, INTEGRATION_LOGOS } from "@/features/settings/components/IntegrationLogo";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("IntegrationLogo", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function mount(ui: React.ReactNode) {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(ui); });
    return container;
  }

  it("has authentic local assets mapped for all providers and infrastructure", () => {
    expect(INTEGRATION_LOGOS.confluence).toBeTruthy();
    expect(INTEGRATION_LOGOS.jira).toBeTruthy();
    expect(INTEGRATION_LOGOS.ldap).toBeTruthy();
    expect(INTEGRATION_LOGOS.keycloak).toBeTruthy();
    expect(INTEGRATION_LOGOS.postgres).toBeTruthy();
    expect(INTEGRATION_LOGOS.redis).toBeTruthy();
    expect(INTEGRATION_LOGOS.qdrant).toBeTruthy();
    expect(INTEGRATION_LOGOS.openai).toBeTruthy();
    expect(INTEGRATION_LOGOS.anthropic).toBeTruthy();
    expect(INTEGRATION_LOGOS.ollama).toBeTruthy();
    expect(INTEGRATION_LOGOS.kubernetes).toBeTruthy();
    expect(INTEGRATION_LOGOS.docker).toBeTruthy();
    expect(INTEGRATION_LOGOS.slack).toBeTruthy();
  });

  it("renders the official logo image with accessible alt text and object-contain", async () => {
    const el = await mount(<IntegrationLogo providerKey="confluence" name="Confluence" />);
    const img = el.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe("Confluence logo");
    expect(img.className).toContain("object-contain");
  });

  it("renders Jira logo properly", async () => {
    const el = await mount(<IntegrationLogo providerKey="jira" name="Jira" />);
    const img = el.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe("Jira logo");
  });

  it("renders LDAP / Active Directory logo properly", async () => {
    const el = await mount(<IntegrationLogo providerKey="ldap" name="LDAP / Active Directory" />);
    const img = el.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe("LDAP / Active Directory logo");
  });

  it("renders Keycloak SSO logo properly", async () => {
    const el = await mount(<IntegrationLogo providerKey="keycloak" name="Keycloak SSO" />);
    const img = el.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe("Keycloak SSO logo");
  });
});
