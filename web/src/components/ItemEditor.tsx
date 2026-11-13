// ItemEditor — create/edit an item: title, location, notes, start/end, all-day, timezone, RRULE, reminders
//
// This is the BARE form component — no Dialog/Sheet wrapper lives here. The modal wrapper
// (Dialog on desktop, Sheet on mobile) lives in ItemListView (plan Decision 5, B2), so
// ItemEditor.test.tsx's exact-once onCancel assertion (bare-component render, no
// onOpenChange->onCancel double-invocation path) continues to hold.
import React, { useState } from "react";
import type { List, Item, ItemDraft } from "../types";
import { createItem, updateItem, replaceReminders, ApiError } from "../apiClient";
import { ReminderEditor } from "./ReminderEditor";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { AttachmentsEditor, AttachmentsCreateHint } from "./AttachmentsEditor";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

// Base chevron/border/radius/shadow styling shared by both native selects that must stay
// native (plan M5 — the required list select and the empty->null location-kind select). This
// visually aligns them with the shadcn SelectTrigger (matching border/radius/shadow tokens
// plus a Lucide-style chevron). `.native-select` (defined in index.css) carries the
// `appearance-none` + background-image chevron rule as plain CSS rather than a Tailwind
// arbitrary-value class — a dynamic `bg-[url('data:image/svg+xml...')]` string embeds literal
// spaces inside a bracketed arbitrary value, which Tailwind's class-name extractor can silently
// fail to pick up (the same class of bug the QA report's CSS-comment note warns about: passes
// at dev-time, breaks/omits styling in the production build). Plain CSS sidesteps that risk
// entirely. Deliberately excludes sizing utilities (height/width/padding/text-size), which
// differ per select and are supplied at each call site.
const NATIVE_SELECT_BASE_CLASSNAME =
  "native-select rounded-md border border-input bg-transparent shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

function epochToDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToEpoch(s: string): number {
  return new Date(s).getTime();
}

interface Props {
  lists: List[];
  item?: Item; // undefined = create mode
  defaultListId?: string;
  // Duplicate's prefill (plan Decision 7). Create mode only — ignored when `item` is set. Used
  // as the useState initialiser verbatim (all twelve ItemDraft fields already resolved by
  // buildDuplicateDraft), so it takes priority over defaultListId.
  initialDraft?: ItemDraft;
  onSave: (saved: Item) => void;
  onCancel: () => void;
}

export function ItemEditor({ lists, item, defaultListId, initialDraft, onSave, onCancel }: Props) {
  const now = Date.now();
  const roundedNow = Math.ceil(now / (60 * 1000)) * 60 * 1000; // round up to minute

  const [draft, setDraft] = useState<ItemDraft>(() => {
    if (item) {
      return {
        list_id: item.list_id,
        type: item.type,
        title: item.title,
        location: item.location ?? "",  // empty string for form; converted to null on submit
        notes: item.notes ?? "",          // same
        start_at: item.start_at,
        end_at: item.end_at,
        all_day: item.all_day,
        rrule: item.rrule,
        timezone: item.timezone,
        reminders: item.reminders,
        location_kind: item.location_kind,
      };
    }
    if (initialDraft) return initialDraft;
    return {
      list_id: defaultListId ?? (lists[0]?.id ?? ""),
      type: "event",
      title: "",
      location: "",
      notes: "",
      start_at: roundedNow,
      end_at: null,
      all_day: false,
      rrule: null,
      timezone: DEFAULT_TIMEZONE,
      reminders: [],
      location_kind: null,
    };
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof ItemDraft>(key: K, val: ItemDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (item) {
        const { item: saved } = await updateItem(item.id, {
          type: draft.type,
          title: draft.title,
          location: draft.location || null,
          notes: draft.notes || null,
          start_at: draft.start_at,
          end_at: draft.end_at,
          all_day: draft.all_day,
          rrule: draft.rrule,
          timezone: draft.timezone,
          location_kind: draft.location_kind,
        });
        // The item PATCH succeeded. Persist the reminder set via the existing PUT path
        // (deferred-until-submit, per §4.2 of the fix plan). `updateItem`'s returned
        // `reminders` are STALE (db.ts reads reminders before this PUT replaces them),
        // so we must merge the FRESH set returned by replaceReminders into onSave.
        try {
          const { reminders } = await replaceReminders(item.id, draft.reminders);
          onSave({ ...saved, reminders });
        } catch (remindersErr) {
          // Item metadata is saved but the reminder set is unchanged; surface a distinct,
          // recoverable error and do NOT call onSave with a half-applied state.
          setError(
            `Item saved, but reminders failed to save: ${
              remindersErr instanceof ApiError ? remindersErr.message : String(remindersErr)
            }`
          );
          return;
        }
      } else {
        const { item: saved } = await createItem(draft);
        onSave(saved);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="max-w-xl">
      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {!item && (
          <div>
            <Label className="mb-1 block">List</Label>
            {/* Native <select required> (plan M5 — stays native): participates in the <form>
                submit and blocks it on empty; Radix Select has no native required
                form-participation. */}
            <select
              value={draft.list_id}
              onChange={(e) => setField("list_id", e.target.value)}
              required
              className={`${NATIVE_SELECT_BASE_CLASSNAME} h-9 w-full pl-3 pr-8 py-2 text-sm`}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label className="mb-1 block">Type</Label>
          <div className="flex gap-3">
            {/* Type radios (plan M4 — stay native): Radix RadioGroup would add arrow-key
                roving focus, a user-visible behavior change. */}
            {(["event", "task"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={draft.type === t}
                  onChange={() => setField("type", t)}
                />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-1 block">Title *</Label>
          <Input
            type="text"
            value={draft.title}
            onChange={(e) => setField("title", e.target.value)}
            required
            maxLength={200}
          />
        </div>

        <div>
          <Label className="mb-1 block">Location</Label>
          <Input
            type="text"
            value={draft.location}
            onChange={(e) => {
              // Editing the location text resets any stored classification override to
              // "Auto" (null) — a stale override could otherwise mislabel a now-different
              // string (e.g. changing a Zoom URL to "Home" must not leave a `meeting`
              // override on "Home"). See Decision 3 override edge rules.
              setDraft((prev) => ({ ...prev, location: e.target.value, location_kind: null }));
            }}
          />
          {draft.location.trim().length > 0 && (
            <div className="mt-1.5">
              <Label className="mr-1.5 text-xs text-muted-foreground">Location type:</Label>
              {/* Empty->null location-kind <select> (plan M5 — stays native): Radix Select
                  disallows empty-string item values and requires a placeholder, which would
                  force a rework of this behavior. */}
              <select
                value={draft.location_kind ?? ""}
                onChange={(e) =>
                  setField(
                    "location_kind",
                    e.target.value === "" ? null : (e.target.value as "plain" | "address" | "meeting")
                  )
                }
                className={`${NATIVE_SELECT_BASE_CLASSNAME} h-7 w-auto pl-2 pr-7 py-1 text-xs`}
              >
                <option value="">Auto</option>
                <option value="plain">Plain text</option>
                <option value="address">Address (map)</option>
                <option value="meeting">Meeting link</option>
              </select>
            </div>
          )}
        </div>

        <div>
          <Label className="mb-1 block">Notes</Label>
          <Textarea value={draft.notes} onChange={(e) => setField("notes", e.target.value)} rows={3} />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            {/* All-day checkbox (plan M4 — stays native). */}
            <input
              type="checkbox"
              checked={draft.all_day}
              onChange={(e) => setField("all_day", e.target.checked)}
            />
            All day
          </label>
        </div>

        {/* Start/End row: stacks on narrow viewports (mobile Sheet) so the native
            datetime-local/date inputs can shrink to w-full instead of forcing horizontal
            overflow; side-by-side again from `sm` up (QA report Defect 1). */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="min-w-0 w-full sm:flex-1">
            <Label className="mb-1 block">Start *</Label>
            <Input
              type={draft.all_day ? "date" : "datetime-local"}
              value={draft.all_day
                ? new Date(draft.start_at).toISOString().slice(0, 10)
                : epochToDatetimeLocal(draft.start_at)}
              onChange={(e) => {
                const ms = draft.all_day
                  ? new Date(e.target.value + "T00:00:00").getTime()
                  : datetimeLocalToEpoch(e.target.value);
                setField("start_at", ms);
              }}
              required
              className="w-full min-w-0"
            />
          </div>
          <div className="min-w-0 w-full sm:flex-1">
            <Label className="mb-1 block">End</Label>
            <Input
              type={draft.all_day ? "date" : "datetime-local"}
              value={draft.end_at
                ? (draft.all_day
                  ? new Date(draft.end_at).toISOString().slice(0, 10)
                  : epochToDatetimeLocal(draft.end_at))
                : ""}
              onChange={(e) => {
                if (!e.target.value) { setField("end_at", null); return; }
                const ms = draft.all_day
                  ? new Date(e.target.value + "T00:00:00").getTime()
                  : datetimeLocalToEpoch(e.target.value);
                setField("end_at", ms);
              }}
              className="w-full min-w-0"
            />
          </div>
        </div>

        <div>
          <Label className="mb-1 block">Timezone</Label>
          <Input
            type="text"
            value={draft.timezone}
            onChange={(e) => setField("timezone", e.target.value)}
            placeholder="America/Los_Angeles"
          />
        </div>

        <RecurrenceEditor
          rrule={draft.rrule}
          onChange={(r) => setField("rrule", r)}
        />

        <ReminderEditor
          reminders={draft.reminders}
          onChange={(r) => setField("reminders", r)}
        />

        {item ? <AttachmentsEditor itemId={item.id} /> : <AttachmentsCreateHint />}
      </div>

      <div className="mt-5 flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : item ? "Save" : "Create"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
