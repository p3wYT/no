// Publish-time computation. Timezone + DST aware via date-fns-tz.
// Pure (given `now`); unit-tested.

import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type ScheduleMode =
  | "IMMEDIATE"
  | "FIXED_DELAY"
  | "SCHEDULED_WINDOW"
  | "SPECIFIC_TIME"
  | "QUEUE";

export interface ScheduleConfig {
  // SCHEDULED_WINDOW
  window?: { startHour: number; endHour: number; days?: number[] };
  // SPECIFIC_TIME (ISO instant or local wall-clock + separate tz handling)
  specific?: { at: string };
  // QUEUE
  queue?: { spacingMinutes: number };
}

export interface ScheduleInput {
  mode: ScheduleMode;
  config?: ScheduleConfig | null;
  delaySeconds?: number;
  extraDelaySec?: number;
  now: Date;
  timezone: string;
  // For QUEUE mode: the latest already-scheduled time in this queue.
  lastQueuedAt?: Date | null;
}

function addSeconds(d: Date, s: number): Date {
  return new Date(d.getTime() + s * 1000);
}

/** Build a UTC instant for a given wall-clock Y/M/D H in a timezone. */
function zonedWallToUtc(
  base: Date,
  timezone: string,
  hour: number,
  dayOffset = 0,
): Date {
  const z = toZonedTime(base, timezone);
  z.setDate(z.getDate() + dayOffset);
  z.setHours(hour, 0, 0, 0);
  // Interpret those wall-clock fields as local-to-timezone, get UTC instant.
  const y = z.getFullYear();
  const m = `${z.getMonth() + 1}`.padStart(2, "0");
  const d = `${z.getDate()}`.padStart(2, "0");
  const hh = `${z.getHours()}`.padStart(2, "0");
  return fromZonedTime(`${y}-${m}-${d}T${hh}:00:00`, timezone);
}

function localParts(d: Date, timezone: string): { hour: number; day: number } {
  const z = toZonedTime(d, timezone);
  return { hour: z.getHours(), day: z.getDay() };
}

function inWindow(hour: number, start: number, end: number): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Find the next instant at/after `from` that falls inside the daily window
 * and on an allowed day. Scans up to 14 days ahead.
 */
export function nextWindowStart(
  from: Date,
  timezone: string,
  window: { startHour: number; endHour: number; days?: number[] },
): Date {
  const { startHour, endHour, days } = window;
  const dayOk = (d: number) => !days || days.length === 0 || days.includes(d);

  const { hour, day } = localParts(from, timezone);
  // Already inside an active window today → schedule now.
  if (dayOk(day) && inWindow(hour, startHour, endHour)) {
    return from;
  }

  for (let offset = 0; offset <= 14; offset++) {
    const candidateDay = (day + offset) % 7;
    if (!dayOk(candidateDay)) continue;
    const start = zonedWallToUtc(from, timezone, startHour, offset);
    if (start.getTime() >= from.getTime()) return start;
  }
  // Fallback: 1 day later at start hour.
  return zonedWallToUtc(from, timezone, startHour, 1);
}

/**
 * Compute when a publish job should be scheduled.
 */
export function computeScheduledAt(input: ScheduleInput): Date {
  const extra = input.extraDelaySec ?? 0;
  const base = input.now;

  switch (input.mode) {
    case "IMMEDIATE":
      return addSeconds(base, extra);

    case "FIXED_DELAY":
      return addSeconds(base, (input.delaySeconds ?? 0) + extra);

    case "SCHEDULED_WINDOW": {
      const w = input.config?.window ?? { startHour: 9, endHour: 21 };
      const withDelay = addSeconds(base, (input.delaySeconds ?? 0) + extra);
      return nextWindowStart(withDelay, input.timezone, w);
    }

    case "SPECIFIC_TIME": {
      const at = input.config?.specific?.at;
      const parsed = at ? new Date(at) : base;
      const when = isNaN(parsed.getTime()) ? base : parsed;
      const target = when.getTime() < base.getTime() ? base : when;
      return addSeconds(target, extra);
    }

    case "QUEUE": {
      const spacing = (input.config?.queue?.spacingMinutes ?? 60) * 60;
      const earliest = input.lastQueuedAt
        ? addSeconds(input.lastQueuedAt, spacing)
        : base;
      const chosen = earliest.getTime() < base.getTime() ? base : earliest;
      return addSeconds(chosen, extra);
    }

    default:
      return addSeconds(base, extra);
  }
}
