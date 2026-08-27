import type { AppointmentStatus } from "@prisma/client";
import { AlertTriangle, Check, CheckCircle2, Clock, X, type LucideIcon } from "lucide-react";

/**
 * REQ-020, REQ-025: the icon + text label + color/opacity treatment per
 * `AppointmentStatus`, per design.md's "Calendar UX" mapping. Shared by
 * the calendar's event chips (calendar.tsx) and the detail sheet's
 * status-transition buttons (appointment-detail-sheet.tsx) so the two
 * surfaces can never drift into showing different icons/labels for the
 * same status -- not listed in design.md's file table, a small
 * code-quality-driven extraction to avoid duplicating this mapping twice.
 */
export interface StatusMeta {
  label: string;
  Icon: LucideIcon;
  chipClassName: string;
  strikethrough?: boolean;
}

const STATUS_META: Record<AppointmentStatus, StatusMeta> = {
  SCHEDULED: {
    label: "Scheduled",
    Icon: Clock,
    chipClassName: "border border-primary/40 bg-background text-foreground",
  },
  CONFIRMED: {
    label: "Confirmed",
    Icon: CheckCircle2,
    chipClassName: "border border-transparent bg-primary text-primary-foreground",
  },
  COMPLETED: {
    label: "Completed",
    Icon: Check,
    chipClassName: "border border-transparent bg-muted text-muted-foreground",
  },
  CANCELLED: {
    label: "Cancelled",
    Icon: X,
    chipClassName: "border border-transparent bg-muted text-muted-foreground",
    strikethrough: true,
  },
  NO_SHOW: {
    label: "No-show",
    Icon: AlertTriangle,
    chipClassName: "border border-transparent bg-muted text-muted-foreground",
  },
};

export function statusMeta(status: AppointmentStatus): StatusMeta {
  switch (status) {
    case "SCHEDULED":
      return STATUS_META.SCHEDULED;
    case "CONFIRMED":
      return STATUS_META.CONFIRMED;
    case "COMPLETED":
      return STATUS_META.COMPLETED;
    case "CANCELLED":
      return STATUS_META.CANCELLED;
    case "NO_SHOW":
      return STATUS_META.NO_SHOW;
  }
}
