/**
 * Promise-based confirmation dialog.
 *
 * `window.confirm` is a browser primitive: it cannot be themed, cannot show what will be lost
 * beyond one paragraph, and it stops the page (Chrome will eventually stop honouring it in
 * cross-origin frames anyway). Everything destructive in Settings used it. This gives the same
 * one-line call site — `if (!(await confirm({...}))) return;` — backed by the app's own dialog.
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (!(await confirm({ title, description, confirmLabel: "Delete", destructive: true }))) return;
 *   ...
 *   {dialog}
 */
import { useCallback, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

export type ConfirmOptions = {
  title: string;
  description: ReactNode;
  /** Verb on the danger button — "Remove", "Revoke", "Delete". Never "OK". */
  confirmLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const settle = useCallback(
    (value: boolean) => {
      setPending((current) => {
        current?.resolve(value);
        return null;
      });
    },
    [],
  );

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(next) => { if (!next) settle(false); }}>
      <AlertDialogContent size="confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={pending?.destructive ? "destructive" : "default"}
            onClick={() => settle(true)}
          >
            {pending?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
