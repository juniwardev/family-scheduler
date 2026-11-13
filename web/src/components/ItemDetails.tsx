// ItemDetails — bare, read-only presentation of an Item (item-view-mode plan §3.6, Decision 3).
//
// Mirrors the "BARE form component" pattern documented at ItemEditor.tsx:2-6: no Dialog/Sheet
// wrapper lives here. ItemModal supplies the DialogTitle/SheetTitle (the item's title is NOT
// repeated here — that would be a duplicate heading).
import React from "react";
import type { EpochMs, Item, List, User } from "../types";
import { formatOccurrenceTime } from "../../../src/shared/itemLabels";
import { resolveLocationRender, resolveMapsProvider } from "../../../src/shared/location";
import { isArchivable } from "../../../src/shared/archive";
import { describeRecurrence } from "../lib/rrule";
import { describeReminder } from "../lib/itemDisplay";
import { AttachmentsView } from "./AttachmentsView";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

interface Props {
  item: Item;
  // Calendar only. Both are per-occurrence values computed by the server
  // (src/worker/routes/items.ts:77-81); item.start_at/item.end_at describe the FIRST
  // occurrence only. Omitting occurrenceEndAt renders a backwards range — Decision 9.
  occurrenceAt?: EpochMs;
  occurrenceEndAt?: EpochMs;
  lists: List[];
  user: User;
  canWrite: boolean;
  onEdit: () => void;
  onClose: () => void;
  // Required, not optional (plan N4.3 — the same argument as ItemModal's onArchiveChanged one
  // level down): each gate below has no handler term, so an omitted handler would render a
  // live-looking button that does nothing. Raise intent only — no arguments, no fetch. The host
  // (ItemModal) owns the setItemArchived() call and the duplicate modal transition.
  onArchive: () => void;
  onRestore: () => void;
  onDuplicate: () => void;
}

export function ItemDetails({
  item,
  occurrenceAt,
  occurrenceEndAt,
  lists,
  user,
  canWrite,
  onEdit,
  onClose,
  onArchive,
  onRestore,
  onDuplicate,
}: Props) {
  const list = lists.find((l) => l.id === item.list_id);

  const start = occurrenceAt ?? item.start_at;
  const end = occurrenceEndAt ?? item.end_at;

  const whenText = formatOccurrenceTime(start, item.timezone, item.all_day);
  const whenRangeText = end != null
    ? `${whenText} – ${formatOccurrenceTime(end, item.timezone, item.all_day)}`
    : whenText;

  const recurrenceText = describeRecurrence(item.rrule);
  const showSeriesHint = Boolean(item.rrule) && occurrenceAt != null;

  const hasLocation = item.location != null && item.location.trim().length > 0;
  const locationRender = hasLocation
    ? resolveLocationRender(item.location as string, item.location_kind, resolveMapsProvider(user.maps_provider))
    : null;

  const showCompletedBadge = item.rrule === null && Boolean(item.completed_at);
  const isArchived = item.archived_at !== null;

  // canEdit, not canWrite, gates Edit (plan §5.5/G6): PATCH 409s on an archived item, so the
  // button must not offer an action the server will refuse. isArchivable already covers rrule
  // (recurring items are never archivable), so no separate rrule check is needed here.
  const canEdit = canWrite && !isArchived;
  const canArchive = canWrite && !isArchived && isArchivable(item, Date.now());
  const canRestore = canWrite && isArchived;
  // Duplicate is offered for an archived item only in this branch (Decision 6 / OQ3 — "yes
  // eventually, no in this branch"). buildDuplicateDraft has no such restriction, so widening
  // this to live items later is a one-line change here.
  const canDuplicate = canWrite && isArchived;

  return (
    <dl className="grid gap-3">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</dt>
        <dd className="mt-0 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{item.type === "event" ? "event" : "task"}</Badge>
          {list && <span className="text-muted-foreground">{list.name}</span>}
          {showCompletedBadge && <Badge>Completed</Badge>}
          {isArchived && <Badge variant="secondary">Archived</Badge>}
        </dd>
      </div>

      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">When</dt>
        <dd className="mt-0 text-sm">{whenRangeText}</dd>
      </div>

      {recurrenceText && (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recurrence</dt>
          <dd className="mt-0 text-sm">{recurrenceText}</dd>
        </div>
      )}

      {showSeriesHint && (
        <p className="text-xs text-muted-foreground">
          This is one occurrence of a repeating item. Editing changes the whole series.
        </p>
      )}

      {locationRender && (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Location</dt>
          <dd className="mt-0 text-sm">
            {locationRender.href ? (
              <a
                href={locationRender.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {locationRender.kind === "address"
                  ? `${locationRender.text} (open in maps)`
                  : locationRender.kind === "meeting"
                    ? "Tap to join"
                    : locationRender.text}
              </a>
            ) : (
              locationRender.text
            )}
          </dd>
        </div>
      )}

      {item.notes && (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</dt>
          <dd className="mt-0 whitespace-pre-wrap text-sm">{item.notes}</dd>
        </div>
      )}

      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reminders</dt>
        <dd className="mt-0 text-sm">
          {item.reminders.length === 0 ? (
            "None"
          ) : (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {item.reminders.map((r) => (
                <li key={r.id}>{describeReminder(r)}</li>
              ))}
            </ul>
          )}
        </dd>
      </div>

      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attachments</dt>
        <dd className="mt-0">
          <AttachmentsView itemId={item.id} />
        </dd>
      </div>

      <p className="text-xs text-muted-foreground">
        Added by {item.created_by} · Updated {formatOccurrenceTime(item.updated_at, item.timezone, false)}
      </p>

      {/* Footer order is Close, then the primary action (Edit / Restore), then
          Archive / Duplicate — owner's stated click-likelihood order. Note that the
          gates above make this only two real shapes: an active item renders
          Close/Edit/Archive, an archived one Close/Restore/Duplicate. Edit and Restore
          never co-occur, and neither do Archive and Duplicate. */}
      <div data-testid="item-details-actions" className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {canEdit && (
          <Button type="button" variant="default" onClick={onEdit}>
            Edit
          </Button>
        )}
        {canArchive && (
          <Button type="button" variant="outline" onClick={onArchive}>
            Archive
          </Button>
        )}
        {canRestore && (
          <Button type="button" variant="outline" onClick={onRestore}>
            Restore
          </Button>
        )}
        {canDuplicate && (
          <Button type="button" variant="outline" onClick={onDuplicate}>
            Duplicate
          </Button>
        )}
      </div>
    </dl>
  );
}
