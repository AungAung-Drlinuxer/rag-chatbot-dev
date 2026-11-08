import { useEffect, useState } from "react";
import { getMySettings } from "@/features/settings/api";

export type ChatPreferences = {
  show_rag_sources: boolean;
  show_token_usage: boolean;
  markdown_rendering: boolean;
};

const DEFAULTS: ChatPreferences = {
  show_rag_sources: true,
  show_token_usage: true,
  markdown_rendering: true,
};

/** Load chat preferences once and reflect saves made on the Settings page. */
export function useUserPreferences(): ChatPreferences {
  const [preferences, setPreferences] = useState<ChatPreferences>(DEFAULTS);

  useEffect(() => {
    let mounted = true;
    const apply = (value: Partial<ChatPreferences>) => {
      if (!mounted) return;
      setPreferences((current) => ({
        show_rag_sources: value.show_rag_sources ?? current.show_rag_sources,
        show_token_usage: value.show_token_usage ?? current.show_token_usage,
        markdown_rendering: value.markdown_rendering ?? current.markdown_rendering,
      }));
    };
    getMySettings().then(apply).catch(() => {});
    const onSaved = (event: Event) => apply((event as CustomEvent<Partial<ChatPreferences>>).detail ?? {});
    window.addEventListener("ith:settings-saved", onSaved);
    return () => {
      mounted = false;
      window.removeEventListener("ith:settings-saved", onSaved);
    };
  }, []);

  return preferences;
}
