import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { useFloatingChat } from "@/components/FloatingChat";

/**
 * Floating chat FAB — compact round button (56px), bot icon only.
 * v0.22 redesign per user feedback: the previous large card covered page
 * content; now a single minimal button. Popup opens on click; conversation
 * persists via FloatingChatProvider (App-level).
 */
export function NeedHelpCard() {
  const { setOpen, open } = useFloatingChat();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleRestore = () => {
      setDismissed(false);
      setVisible(true);
    };
    window.addEventListener("ith:restore-assistant-btn", handleRestore);
    return () => window.removeEventListener("ith:restore-assistant-btn", handleRestore);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(t);
  }, []);

  // Hidden while the popup itself is open (popup has its own close/minimize)
  if (dismissed || open) return null;

  return (
    <button
      type="button"
      aria-label="Open AI assistant chat"
      title="AI Assistant"
      onClick={() => {
        setOpen(true);
      }}
      className={[
        "group fixed bottom-5 right-5 z-40 grid size-10 place-items-center rounded-full",
        "bg-blue-600 text-white shadow-md shadow-blue-600/30",
        "transition-all duration-300 hover:scale-110 hover:bg-blue-700",
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      ].join(" ")}
    >
      {/* dismiss — small, only on hover, top-right */}
      <span
        role="button"
        tabIndex={0}
        aria-label="Dismiss assistant button"
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            setDismissed(true);
          }
        }}
        className="absolute -right-1 -top-1 hidden size-4 place-items-center rounded-full border border-[var(--border)] bg-white text-slate-500 shadow-xs transition hover:text-red-500 group-hover:grid dark:border-slate-700 dark:bg-slate-800"
      >
        <X className="size-2.5" />
      </span>

      <Bot className="size-5" strokeWidth={2} />

      {/* pulse ring — subtle */}
      <span aria-hidden className="absolute inset-0 -z-10 animate-ping rounded-full bg-blue-500/15 [animation-duration:3s]" />
    </button>
  );
}
