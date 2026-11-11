/**
 * Composer — the ONE type area, shared by the full chat page and the floating widget.
 *
 * Both places ask the same question and must answer it the same way: attach, type, send,
 * and stop. They used to be two hand-written copies, which is why a restyle of the chat
 * composer left the floating one drawing an ArrowUp button and no Ctrl+Enter hint — the
 * divergence was structural, not an oversight.
 *
 * Page-specific controls are slots, not props:
 *   `leading`  — page-only status pill (the floating widget is a quick question, not a
 *                session, so it shows none)
 *   `above`    — pending-attachment chips and the mode/engine row
 *
 * Send is a round accent disc with a paper-plane glyph, and Stop keeps the same 36px
 * footprint so the row never shifts mid-generation.
 */
import { useRef, type ReactNode } from "react";
import { Paperclip, Send, Square } from "lucide-react";

export type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  /** Send the current value. Called on submit, on Ctrl/Cmd+Enter and on plain Enter. */
  onSubmit: () => void;
  placeholder?: string;
  /** Rendered inside the field, left of the attach button (the scope pill). */
  leading?: ReactNode;
  /** Rendered above the field (attachment chips, mode/engine row). */
  above?: ReactNode;
  /** Generating: the send button becomes Stop. */
  busy?: boolean;
  onStop?: () => void;
  /** Receives the chosen file; the composer owns the hidden input and its reset. */
  onAttach?: (file: File) => void | Promise<void>;
  attachAccept?: string;
  attaching?: boolean;
  /** Show the Ctrl+Enter key hint. Off for the floating widget, which is one-line. */
  hint?: boolean;
  /** Grow with content (chat page) vs a fixed single line (floating widget). */
  multiline?: boolean;
  /** Disable the field while an upload or a send is in flight. */
  disabled?: boolean;
  autoFocus?: boolean;
  /** Tailwind classes for the field container, so each surface can size itself. */
  className?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  "aria-label"?: string;
};

export default function Composer({
  value,
  onChange,
  onSubmit,
  placeholder = "Ask an IT question...",
  leading,
  above,
  busy = false,
  onStop,
  onAttach,
  attachAccept,
  attaching = false,
  hint = false,
  multiline = true,
  disabled = false,
  autoFocus = false,
  className = "",
  inputRef,
  "aria-label": ariaLabel = "Ask an IT question",
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !!value.trim() && !disabled && !attaching;

  function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    // Ctrl/Cmd+Enter is what the hint advertises, so it must work. Plain Enter keeps
    // working too — it is what people actually press — unless multiline is off, where
    // Enter is the only way to send.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <>
      {above}
      <div
        className={
          "flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-1.5 shadow-xs transition-all focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900/80 dark:focus-within:bg-slate-900 " +
          className
        }
      >
        {leading}

        {onAttach && (
          <>
            <button
              type="button"
              disabled={attaching}
              onClick={() => fileRef.current?.click()}
              aria-label="Attach file or image"
              title="Attach file or image"
              className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={attachAccept}
              className="hidden"
              aria-label="Attach file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await onAttach(f);
                } finally {
                  // Reset even on failure, or picking the same file twice is a no-op.
                  if (fileRef.current) fileRef.current.value = "";
                }
              }}
            />
          </>
        )}

        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={keyDown}
            rows={1}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="max-h-40 min-h-[30px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-6 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={keyDown}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="h-9 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        )}

        {/* The hint belongs INSIDE the field, beside the button it describes. */}
        {hint && (
          <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-white/70 px-1.5 py-0.5 font-mono text-xs text-slate-500 md:inline-block dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
            Ctrl+Enter
          </kbd>
        )}

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop generating (Esc)"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            title="Send (Enter)"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-white shadow-xs transition hover:opacity-90 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          >
            <Send className="size-4" />
          </button>
        )}
      </div>
    </>
  );
}
