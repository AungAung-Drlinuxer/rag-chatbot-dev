import { useState } from "react";

import confluenceSvg from "@/assets/logos/confluence.svg";
import jiraSvg from "@/assets/logos/jira.svg";
import ldapSvg from "@/assets/logos/active-directory.svg";
import keycloakSvg from "@/assets/logos/keycloak.svg";

/**
 * Map of integration provider keys to their authentic, official vector logo assets.
 * All logos are stored locally in the application's static assets directory.
 */
export const INTEGRATION_LOGOS: Record<string, string> = {
  confluence: confluenceSvg,
  jira: jiraSvg,
  ldap: ldapSvg,
  keycloak: keycloakSvg,
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
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-[10px] font-bold text-foreground ${sizeClass} ${className}`}
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
