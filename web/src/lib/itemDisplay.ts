// web/src/lib/itemDisplay.ts — reminder-offset display helpers (item-view-mode plan §3.7).
//
// splitOffsetMinutes is a VERBATIM move of ReminderEditor's private fromMinutes — no logic
// change. ReminderEditor now imports it from here instead of defining it locally. toMinutes
// stays in ReminderEditor (editor-only, not needed by the read-only view).
export type OffsetUnit = "minutes" | "hours" | "days";

export function splitOffsetMinutes(minutes: number): { value: number; unit: OffsetUnit } {
  if (minutes >= 60 * 24 && minutes % (60 * 24) === 0) {
    return { value: minutes / (60 * 24), unit: "days" };
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: minutes / 60, unit: "hours" };
  }
  return { value: minutes, unit: "minutes" };
}

interface DescribableReminder {
  offset_minutes: number;
  channel_email: boolean;
  channel_push: boolean;
}

function channelsSuffix(r: DescribableReminder): string {
  const channels: string[] = [];
  if (r.channel_email) channels.push("Email");
  if (r.channel_push) channels.push("Push");
  return channels.length > 0 ? channels.join(", ") : "no channels";
}

// offset_minutes === 0 is an ordinary, reachable value (an "at the time of the event"
// reminder) and must be special-cased BEFORE splitOffsetMinutes, which would otherwise yield
// "0 minutes before".
export function describeReminder(r: DescribableReminder): string {
  if (r.offset_minutes === 0) {
    return `At the time of the event · ${channelsSuffix(r)}`;
  }
  const { value, unit } = splitOffsetMinutes(r.offset_minutes);
  const unitLabel =
    unit === "minutes" ? (value === 1 ? "minute" : "minutes")
    : unit === "hours" ? (value === 1 ? "hour" : "hours")
    : value === 1 ? "day" : "days";
  return `${value} ${unitLabel} before · ${channelsSuffix(r)}`;
}
