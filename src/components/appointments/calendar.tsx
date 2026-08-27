"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  EventClickArg,
  EventContentArg,
  EventDropArg,
  DatesSetArg,
  DateSelectArg,
} from "@fullcalendar/core";
import { cn } from "@/lib/utils";
import { updateAppointmentAction, getAppointmentsForRangeAction } from "@/server/actions/appointments";
import type { AppointmentForCalendar } from "@/server/actions/appointments";
import { formatBogotaDateAndTime } from "@/validation/appointments";
import { statusMeta } from "./status-meta";
import { AppointmentDetailSheet } from "./appointment-detail-sheet";

/**
 * T4.3/T4.4, design.md's "Calendar view type" and "Calendar UX" sections.
 * Client Component: FullCalendar's drag-and-drop (REQ-013) needs a browser
 * DOM, the one deliberate Client Component boundary in this spec (design.md's
 * routing table). Default view is `resourceTimeGridDay`, one column per
 * professional (REQ-019); a non-resource `listWeek` view is offered as a
 * secondary toggle for browsing a wider range, per design.md -- a week x
 * N-professional resource grid stops being legible well before 3
 * professionals.
 */

export interface CalendarProfessional {
  id: string;
  displayName: string;
}

export interface CalendarProps {
  orgSlug: string;
  professionals: CalendarProfessional[];
  initialAppointments: AppointmentForCalendar[];
  initialRangeStart: string;
  initialRangeEnd: string;
}

// ADR-0005: @fullcalendar/core only natively supports timeZone "local" or
// "UTC" -- a named zone like "America/Bogota" silently falls back to the
// browser/server's local zone without the separate moment-timezone plugin,
// which this fixed, DST-free, single-offset case (REQ-005) doesn't
// justify pulling in. Every instant crossing into or out of FullCalendar
// is shifted by this fixed offset and declared `timeZone="UTC"` below, so
// FullCalendar's grid, navigation, and drag positions all read as true
// Bogota wall-clock time while every other file keeps working in real UTC.
const BOGOTA_OFFSET_MS = 5 * 60 * 60_000;
const toDisplayInstant = (real: Date) => new Date(real.getTime() - BOGOTA_OFFSET_MS);
const toRealInstant = (display: Date) => new Date(display.getTime() + BOGOTA_OFFSET_MS);

function toEventInput(appointment: AppointmentForCalendar) {
  const meta = statusMeta(appointment.status);
  return {
    id: appointment.id,
    resourceId: appointment.professionalId,
    start: toDisplayInstant(new Date(appointment.startAt)).toISOString(),
    end: toDisplayInstant(new Date(appointment.endAt)).toISOString(),
    title: appointment.patientName,
    extendedProps: { status: appointment.status, appointment },
    classNames: [meta.strikethrough ? "line-through" : ""].filter(Boolean),
  };
}

export function Calendar({
  orgSlug,
  professionals,
  initialAppointments,
  initialRangeStart,
  initialRangeEnd,
}: CalendarProps) {
  const router = useRouter();
  const [appointments, setAppointments] = useState(initialAppointments);
  const [loading, setLoading] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const currentRange = useRef({ start: initialRangeStart, end: initialRangeEnd });

  const resources = useMemo(
    () => professionals.map((professional) => ({ id: professional.id, title: professional.displayName })),
    [professionals]
  );

  const events = useMemo(() => appointments.map(toEventInput), [appointments]);

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId]
  );

  const isEmptyRange = !loading && appointments.length === 0;

  const refetchCurrentRange = useCallback(async () => {
    const result = await getAppointmentsForRangeAction(currentRange.current.start, currentRange.current.end);
    if (result.success && result.appointments) {
      setAppointments(result.appointments);
    }
  }, []);

  const handleDatesSet = useCallback(
    async (arg: DatesSetArg) => {
      // arg.start/arg.end are display instants (ADR-0005); convert back to
      // real UTC before comparing against/storing in currentRange, which
      // is always real UTC (what getAppointmentsForRangeAction expects).
      const start = toRealInstant(arg.start).toISOString();
      const end = toRealInstant(arg.end).toISOString();
      if (start === currentRange.current.start && end === currentRange.current.end) {
        return;
      }
      currentRange.current = { start, end };
      setLoading(true);
      try {
        await refetchCurrentRange();
      } finally {
        setLoading(false);
      }
    },
    [refetchCurrentRange]
  );

  const handleEventDrop = useCallback(
    async (arg: EventDropArg) => {
      const appointment = arg.event.extendedProps.appointment as AppointmentForCalendar;
      const newProfessionalId = (arg.event.getResources()[0]?.id ?? appointment.professionalId) as string;
      // arg.event.start/end are display instants (ADR-0005); convert back
      // to the real UTC instant before deriving the Bogota date/time
      // fields updateAppointmentAction expects.
      const realStart = toRealInstant(arg.event.start!);
      const realEnd = toRealInstant(arg.event.end!);
      const durationMinutes = Math.round((realEnd.getTime() - realStart.getTime()) / 60_000);
      const { date, time } = formatBogotaDateAndTime(realStart);

      setDragError(null);
      const result = await updateAppointmentAction(appointment.id, {
        professionalId: newProfessionalId,
        date,
        time,
        durationMinutes: String(durationMinutes),
        reason: appointment.reason ?? "",
        notes: appointment.notes ?? "",
      });

      if (!result.success) {
        // REQ-026: revert the visual drag, never persist the attempted
        // change, and surface the specific rejection reason inline near
        // the calendar.
        arg.revert();
        setDragError(result.error ?? "Could not reschedule this appointment.");
        return;
      }

      await refetchCurrentRange();
    },
    [refetchCurrentRange]
  );

  const handleEventClick = useCallback((arg: EventClickArg) => {
    setSelectedAppointmentId(arg.event.id);
  }, []);

  // REQ-024: a calendar event must be reachable and activatable by
  // keyboard, not only by click/tap/drag (WCAG 2.5.7) -- eventClick above
  // only fires on pointer activation, so Enter/Space is wired here on the
  // rendered element itself, funneling to the same selection state.
  const handleEventDidMount = useCallback(
    (info: { el: HTMLElement; event: { id: string } }) => {
      info.el.setAttribute("tabindex", "0");
      info.el.setAttribute("role", "button");
      info.el.style.minHeight = "44px";
      info.el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelectedAppointmentId(info.event.id);
        }
      });
    },
    []
  );

  const handleSelect = useCallback(
    (arg: DateSelectArg) => {
      // arg.start is a display instant (ADR-0005); convert back to real
      // UTC before deriving the Bogota date/time to pre-fill.
      const { date, time } = formatBogotaDateAndTime(toRealInstant(arg.start));
      const professionalId = arg.resource?.id ?? "";
      const params = new URLSearchParams({ date, time, professionalId });
      router.push(`/${orgSlug}/appointments/new?${params.toString()}`);
    },
    [orgSlug, router]
  );

  const renderEventContent = useCallback((arg: EventContentArg) => {
    const status = arg.event.extendedProps.status as AppointmentForCalendar["status"];
    const meta = statusMeta(status);
    const Icon = meta.Icon;
    return (
      <div
        className={cn(
          "flex min-h-[44px] w-full flex-col justify-center gap-0.5 rounded-md px-2 py-1 text-xs",
          meta.chipClassName
        )}
      >
        <div className="flex items-center gap-1 font-medium">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className={cn("truncate", meta.strikethrough && "line-through")}>{arg.event.title}</span>
        </div>
        <span className="truncate opacity-80">{meta.label}</span>
      </div>
    );
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {dragError && (
        <p role="alert" data-testid="drag-error" className="text-sm text-destructive">
          {dragError}
        </p>
      )}

      <div className="relative">
        {loading && (
          <div
            data-testid="calendar-loading"
            className="absolute inset-0 z-10 flex items-center justify-center bg-background/60"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {isEmptyRange && (
          <div
            data-testid="calendar-empty-state"
            className="pointer-events-none absolute inset-x-0 top-1/3 z-10 text-center text-sm text-muted-foreground"
          >
            No appointments scheduled
          </div>
        )}

        <FullCalendar
          plugins={[resourceTimeGridPlugin, listPlugin, interactionPlugin]}
          initialView="resourceTimeGridDay"
          // ADR-0005: "UTC" (a built-in-supported value), fed
          // display-shifted instants (toDisplayInstant/toRealInstant
          // above) rather than the named "America/Bogota" zone, which
          // @fullcalendar/core silently doesn't support without the
          // separate moment-timezone plugin.
          timeZone="UTC"
          // ADR-0005: FullCalendar's own notion of "now" (initial view,
          // the "today" nav button) must be shifted exactly like event
          // data is, or its default "today" (real UTC calendar day) can
          // disagree with the Bogota calendar day the shifted events
          // actually fall on -- most visibly whenever a Bogota day hasn't
          // yet rolled over in UTC terms.
          now={() => toDisplayInstant(new Date())}
          initialDate={toDisplayInstant(new Date(initialRangeStart))}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "resourceTimeGridDay,listWeek",
          }}
          resources={resources}
          events={events}
          editable
          selectable
          // REQ-028: a longer hold than FullCalendar's own default is needed
          // before a touch is treated as a drag start, so an ordinary
          // scroll swipe on a tablet isn't misread as a reschedule attempt.
          longPressDelay={1500}
          height="auto"
          datesSet={handleDatesSet}
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          select={handleSelect}
          eventContent={renderEventContent}
          loading={setLoading}
          eventDidMount={handleEventDidMount}
        />
      </div>

      <AppointmentDetailSheet
        appointment={selectedAppointment}
        professionals={professionals}
        open={selectedAppointment !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAppointmentId(null);
          }
        }}
        onChanged={refetchCurrentRange}
      />
    </div>
  );
}
