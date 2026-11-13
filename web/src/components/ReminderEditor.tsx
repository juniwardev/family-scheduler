// ReminderEditor — N reminders; each = offset (value + unit) + email/push channel toggles
import React from "react";
import type { ReminderInput } from "../types";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
// splitOffsetMinutes moved verbatim to web/src/lib/itemDisplay.ts (item-view-mode plan §3.7),
// where describeReminder (the read-only view's wording helper) also uses it. toMinutes stays
// here — it is editor-only, not needed by the read-only view.
import { splitOffsetMinutes, type OffsetUnit } from "../lib/itemDisplay";

type Unit = OffsetUnit;

interface ReminderDraft {
  value: number;
  unit: Unit;
  channel_email: boolean;
  channel_push: boolean;
}

function toMinutes(value: number, unit: Unit): number {
  if (unit === "days") return value * 24 * 60;
  if (unit === "hours") return value * 60;
  return value;
}

interface Props {
  reminders: ReminderInput[];
  onChange: (reminders: ReminderInput[]) => void;
}

export function ReminderEditor({ reminders, onChange }: Props) {
  const drafts: ReminderDraft[] = reminders.map((r) => ({
    ...splitOffsetMinutes(r.offset_minutes),
    channel_email: r.channel_email,
    channel_push: r.channel_push,
  }));

  const commit = (next: ReminderDraft[]) => {
    onChange(
      next.map((d) => ({
        offset_minutes: toMinutes(d.value, d.unit),
        channel_email: d.channel_email,
        channel_push: d.channel_push,
      }))
    );
  };

  const update = (index: number, patch: Partial<ReminderDraft>) => {
    const next = drafts.map((d, i) => (i === index ? { ...d, ...patch } : d));
    commit(next);
  };

  const add = () => {
    commit([...drafts, { value: 30, unit: "minutes", channel_email: true, channel_push: true }]);
  };

  const remove = (index: number) => {
    commit(drafts.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Label className="mb-1.5 block">Reminders</Label>
      {drafts.map((d, i) => (
        <div key={i} className="mb-1.5 flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={0}
            value={d.value}
            onChange={(e) => update(i, { value: Number(e.target.value) })}
            className="w-16"
          />
          {/* Unit select — non-form-critical, no empty->null mapping, no `required` (plan
              §5.4/M5): safe to use shadcn Select here. */}
          <Select value={d.unit} onValueChange={(value) => update(i, { unit: value as Unit })}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">min</SelectItem>
              <SelectItem value="hours">hrs</SelectItem>
              <SelectItem value="days">days</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">before</span>
          <label className="flex items-center gap-1 text-sm">
            {/* Channel checkboxes (plan M4 — stay native, per the §5.3 ReminderEditor row and
                M4's "Radix Checkbox dropped from v1" note). */}
            <input
              type="checkbox"
              checked={d.channel_email}
              onChange={(e) => update(i, { channel_email: e.target.checked })}
            />
            Email
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={d.channel_push}
              onChange={(e) => update(i, { channel_push: e.target.checked })}
            />
            Push
          </label>
          <Button type="button" size="sm" variant="destructive" onClick={() => remove(i)}>
            ×
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={add}>
        + Add reminder
      </Button>
    </div>
  );
}
