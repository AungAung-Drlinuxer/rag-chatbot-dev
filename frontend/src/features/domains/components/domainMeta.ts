/**
 * Domain presentation metadata — icons, accent colours and the helpers that resolve a
 * stored domain row to something renderable.
 *
 * Kept out of the manager component so the stats cards, the routing flow, the domain list
 * and the editor all share ONE definition. The manager re-exports `ICON_OPTIONS` /
 * `COLOR_OPTIONS` for the older imports (Knowledge page uses them for its cards).
 */
import type { ComponentType } from "react";
import {
  BookOpen, Boxes, Cloud, Cpu, Database, Headphones, Key, Layers, Lock, Mail,
  Monitor, Network, Server, Shield, Wrench,
} from "lucide-react";

import type { ClassifierDomainItem } from "@/features/domains/api";

export const ICON_OPTIONS: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
  Database: { label: "Database", icon: Database },
  Network: { label: "Network", icon: Network },
  Lock: { label: "Security / Lock", icon: Lock },
  Monitor: { label: "Server / Monitor", icon: Monitor },
  Cloud: { label: "Cloud / K8s", icon: Cloud },
  Server: { label: "Storage / Server", icon: Server },
  Headphones: { label: "Help Desk", icon: Headphones },
  Boxes: { label: "Inventory / Assets", icon: Boxes },
  Mail: { label: "Email", icon: Mail },
  Shield: { label: "Shield / Security", icon: Shield },
  Layers: { label: "Layers / Apps", icon: Layers },
  Wrench: { label: "Wrench / Maintenance", icon: Wrench },
  Cpu: { label: "CPU / Hardware", icon: Cpu },
  Key: { label: "Key / Identity", icon: Key },
  BookOpen: { label: "General / Book", icon: BookOpen },
};

export type ColorDef = {
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  swatchBg: string;
};

export const COLOR_OPTIONS: Record<string, ColorDef> = {
  blue: {
    label: "Blue",
    textClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-50 dark:bg-blue-950/40",
    borderClass: "border-blue-200 dark:border-blue-900/50",
    swatchBg: "bg-blue-500",
  },
  emerald: {
    label: "Emerald",
    textClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
    borderClass: "border-emerald-200 dark:border-emerald-900/50",
    swatchBg: "bg-emerald-500",
  },
  amber: {
    label: "Amber",
    textClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
    borderClass: "border-amber-200 dark:border-amber-900/50",
    swatchBg: "bg-amber-500",
  },
  violet: {
    label: "Violet",
    textClass: "text-sky-600 dark:text-sky-400",
    bgClass: "bg-sky-50 dark:bg-sky-950/40",
    borderClass: "border-sky-200 dark:border-sky-900/50",
    swatchBg: "bg-sky-500",
  },
  sky: {
    label: "Sky",
    textClass: "text-sky-600 dark:text-sky-400",
    bgClass: "bg-sky-50 dark:bg-sky-950/40",
    borderClass: "border-sky-200 dark:border-sky-900/50",
    swatchBg: "bg-sky-500",
  },
  orange: {
    label: "Orange",
    textClass: "text-orange-600 dark:text-orange-400",
    bgClass: "bg-orange-50 dark:bg-orange-950/40",
    borderClass: "border-orange-200 dark:border-orange-900/50",
    swatchBg: "bg-orange-500",
  },
  rose: {
    label: "Rose",
    textClass: "text-rose-600 dark:text-rose-400",
    bgClass: "bg-rose-50 dark:bg-rose-950/40",
    borderClass: "border-rose-200 dark:border-rose-900/50",
    swatchBg: "bg-rose-500",
  },
  slate: {
    label: "Slate",
    textClass: "text-slate-600 dark:text-slate-400",
    bgClass: "bg-slate-100 dark:bg-slate-900",
    borderClass: "border-slate-200 dark:border-slate-800",
    swatchBg: "bg-slate-500",
  },
};

/** The icon component a domain row should render (falling back to the book). */
export function domainIcon(domain: Pick<ClassifierDomainItem, "icon">) {
  return (domain.icon && ICON_OPTIONS[domain.icon]?.icon) || BookOpen;
}

/** The accent definition a domain row should render (falling back to blue). */
export function domainColor(domain: Pick<ClassifierDomainItem, "color">): ColorDef {
  return (domain.color && COLOR_OPTIONS[domain.color]) || COLOR_OPTIONS.blue;
}

/** A domain needs attention when the classifier cannot use it well. */
export function domainHealth(domain: ClassifierDomainItem) {
  const issues: string[] = [];
  if (!domain.is_active) issues.push("inactive");
  if ((domain.keywords?.length ?? 0) === 0) issues.push("no keywords");
  if (!domain.jira_project) issues.push("no Jira route");
  if (!domain.description || domain.description.trim().length < 25) issues.push("thin description");
  return issues;
}
