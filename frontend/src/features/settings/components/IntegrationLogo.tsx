import { useState } from "react";

import confluenceSvg from "@/assets/logos/confluence.svg";
import jiraSvg from "@/assets/logos/jira.svg";
import ldapSvg from "@/assets/logos/active-directory.svg";
import keycloakSvg from "@/assets/logos/keycloak.svg";
import postgresqlSvg from "@/assets/logos/postgresql.svg";
import redisSvg from "@/assets/logos/redis.svg";
import qdrantSvg from "@/assets/logos/qdrant.svg";
import openaiSvg from "@/assets/logos/openai.svg";
import anthropicSvg from "@/assets/logos/anthropic.svg";
import openrouterSvg from "@/assets/logos/openrouter.svg";
import deepseekSvg from "@/assets/logos/deepseek.svg";
import ollamaSvg from "@/assets/logos/ollama.svg";
import kubernetesSvg from "@/assets/logos/kubernetes.svg";
import dockerSvg from "@/assets/logos/docker.svg";
import slackSvg from "@/assets/logos/slack.svg";
import microsoftSvg from "@/assets/logos/microsoft.svg";
import googleSvg from "@/assets/logos/google.svg";
import githubSvg from "@/assets/logos/github.svg";

/**
 * Map of integration provider keys to their authentic, official vector logo assets.
 * All logos are stored locally in the application's static assets directory.
 */
export const INTEGRATION_LOGOS: Record<string, string> = {
  confluence: confluenceSvg,
  jira: jiraSvg,
  ldap: ldapSvg,
  "active-directory": ldapSvg,
  activedirectory: ldapSvg,
  keycloak: keycloakSvg,
  postgres: postgresqlSvg,
  postgresql: postgresqlSvg,
  redis: redisSvg,
  qdrant: qdrantSvg,
  vector: qdrantSvg,
  openai: openaiSvg,
  anthropic: anthropicSvg,
  claude: anthropicSvg,
  openrouter: openrouterSvg,
  deepseek: deepseekSvg,
  ollama: ollamaSvg,
  kubernetes: kubernetesSvg,
  k8s: kubernetesSvg,
  docker: dockerSvg,
  slack: slackSvg,
  microsoft: microsoftSvg,
  entra: microsoftSvg,
  azure: ldapSvg,
  google: googleSvg,
  github: githubSvg,
};

type Props = {
  providerKey: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function IntegrationLogo({
  providerKey,
  name,
  size = "md",
  className = "",
}: Props) {
  const [hasError, setHasError] = useState(false);
  const logoSrc = INTEGRATION_LOGOS[providerKey] || `/logos/${providerKey}.svg`;

  const sizeClass = {
    sm: "size-4.5",
    md: "size-7",
    lg: "size-9",
  }[size];

  if (hasError || !logoSrc) {
    // Neutral accessible fallback if an image fails to render
    return (
      <span
        role="img"
        aria-label={`${name} logo`}
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-[11px] font-bold text-foreground ${sizeClass} ${className}`}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={logoSrc}
      alt={`${name} logo`}
      onError={() => setHasError(true)}
      className={`shrink-0 object-contain transition duration-150 ${sizeClass} ${className}`}
      loading="lazy"
      decoding="async"
    />
  );
}

export default IntegrationLogo;
