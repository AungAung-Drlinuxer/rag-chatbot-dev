/** Collapsible sidebar state (in-memory state across shell views). */
import { useEffect, useState } from "react";

let globalCollapsed = false;
const listeners = new Set<(v: boolean) => void>();

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(globalCollapsed);

  useEffect(() => {
    const handler = (v: boolean) => setCollapsedState(v);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const setCollapsed = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === "function" ? val(globalCollapsed) : val;
    globalCollapsed = next;
    listeners.forEach((fn) => fn(next));
  };

  // Cmd/Ctrl+B toggles globally
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => setCollapsed((v) => !v);
  return [collapsed, toggle];
}
