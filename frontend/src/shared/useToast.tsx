/** App-level toast (2.5s auto-clear). Pages call push() via their onToast prop. */
import { useCallback, useRef, useState } from "react";

export type ToastState = { msg: string; kind: "ok" | "err"; id: number } | null;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);

  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    seq.current += 1;
    setToast({ msg, kind, id: seq.current });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  return { toast, push };
}

/** Soft-shadow, borderless toast host (matches the UI system). */
export function ToastHost({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={[
        "fixed bottom-6 right-6 z-[80] max-w-[360px] rounded-xl px-4 py-3 text-xs font-medium",
        "shadow-lg shadow-black/10 dark:shadow-black/40",
        toast.kind === "err"
          ? "bg-red-50 text-red-700 ring-1 ring-red-500/15 dark:bg-red-950/70 dark:text-red-200"
          : "bg-slate-50 text-slate-700 ring-1 ring-slate-500/10 dark:bg-slate-800 dark:text-slate-100",
      ].join(" ")}
    >
      {toast.msg}
    </div>
  );
}
