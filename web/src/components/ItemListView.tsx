// ItemListView — list of items for the selected list; view/edit/delete/complete
import React, { useState, useEffect } from "react";
import { Repeat } from "lucide-react";
import type { User, List, Item } from "../types";
import { getItems, deleteItem, completeItem } from "../apiClient";
import { AttachmentsView } from "./AttachmentsView";
import { ItemModal, useItemModal } from "./ItemModal";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { canWriteList } from "../lib/permissions";
import { formatOccurrenceTime } from "../../../src/shared/itemLabels";
import { cn } from "../lib/utils";

interface Props {
  listId: string | null;
  lists: List[];
  user: User;
  items: Item[];
  onItemsChange: (items: Item[]) => void;
  // Deep-link auto-open (Ruling 1/M2/NEW-1): App point-reads the deep-linked item and hands
  // it down already-fetched (no redundant fetch here). App owns the one-shot guard — it
  // clears initialOpenItem to null via onInitialOpenItemConsumed the first time this
  // component opens it, so a later remount (e.g. switching to Calendar/Admin and back,
  // which unmounts/remounts this component) sees initialOpenItem already null and does
  // NOT reopen a modal the user already closed. A purely local useRef guard would NOT
  // survive that remount, which is exactly the NEW-1 gap this ownership model closes.
  initialOpenItem?: Item | null;
  onInitialOpenItemConsumed?: () => void;
  // Mobile top-bar "+ New" (App shell) routes through this token rather than lifting the
  // modal's open state out of ItemListView (B1 — the modal's open state stays
  // ItemListView-local). App increments the token on each "+ New" tap; this component reacts
  // to token CHANGES (not its raw value) so re-renders with the same token don't re-trigger
  // create.
  createRequestToken?: number;
}

export function ItemListView({
  listId,
  lists,
  user,
  items,
  onItemsChange,
  initialOpenItem,
  onInitialOpenItemConsumed,
  createRequestToken,
}: Props) {
  // B1 invariant (load-bearing — see docs/plans/ui-redesign.md Decision 5, and
  // docs/plans/item-view-mode.md HC1): useItemModal()'s state is per-instance useState LOCAL
  // to ItemListView (not Context, not a module-scoped store — see ItemModal.tsx's HC1 note).
  // The modal (Dialog/Sheet, rendered by <ItemModal>) is rendered INSIDE this component's
  // tree, so it unmounts along with ItemListView whenever App switches activeView away from
  // "list" (App.tsx's conditional view-swap is unchanged). This is what makes the NEW-1
  // deep-link regression guard (App.deeplink.test.tsx) hold: a Calendar/List round-trip
  // discards this local state instead of leaving a stale modal open. CalendarView mounts its
  // OWN, separate useItemModal() instance for the same reason.
  const itemModal = useItemModal();
  // Destructured so the create-token effect below can list a stable function identity
  // directly in its dep array (Decision 2's useCallback-stability requirement) without
  // react-hooks/exhaustive-deps asking for the whole itemModal object, whose `state` field
  // changes on every open/close and would make the effect re-run far too often.
  const { openCreate } = itemModal;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Archived toggle (plan Decision 4b). Scoped to the currently selected list, not a
  // separate top-level view.
  const [scope, setScope] = useState<"active" | "archived">("active");

  useEffect(() => {
    if (!listId) { onItemsChange([]); return; }
    setLoading(true);
    setError(null);
    getItems(listId, { archived: scope === "archived" })
      .then((data) => onItemsChange(data.items))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [listId, scope]);

  useEffect(() => {
    if (initialOpenItem) {
      itemModal.openView(initialOpenItem);
      // Report consumption immediately so App clears initialOpenItem — this is the
      // one-shot guard (owned by App, not a local ref; see the Props doc above).
      onInitialOpenItemConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenItem]);

  useEffect(() => {
    if (createRequestToken) {
      openCreate();
    }
  }, [createRequestToken, openCreate]);

  const selectedList = lists.find((l) => l.id === listId);

  // §5.7's two-fetch-sites requirement: refresh() is what runs after delete/complete/save —
  // and now after archive/restore, including from the Archived view (Restore). Threading scope
  // into only the mount effect above would leave this call scope-blind, silently repopulating
  // the Archived view with active items after the first mutation performed there.
  const refresh = () => {
    if (!listId) return;
    getItems(listId, { archived: scope === "archived" })
      .then((data) => onItemsChange(data.items))
      .catch((err) => setError(String(err)));
  };

  const handleDelete = async (item: Item) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      await deleteItem(item.id);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleComplete = async (item: Item, occurrenceAt?: number) => {
    const isCompleted = item.rrule
      ? false // per-occurrence: always toggle to complete here (simplified)
      : Boolean(item.completed_at);

    try {
      await completeItem(item.id, occurrenceAt, !isCompleted);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  if (!listId) {
    return (
      <div className="pt-16 text-center text-muted-foreground">
        Select a list from the sidebar.
      </div>
    );
  }

  if (loading) return <div className="loading">Loading items…</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 text-xl font-semibold">
          {selectedList?.name ?? "Items"}
          {selectedList?.visibility === "shared" && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">(shared)</span>
          )}
        </h2>
        <Button type="button" size="sm" onClick={() => itemModal.openCreate()}>
          + New Item
        </Button>
      </div>

      {/* Active/Archived toggle (plan Decision 4b): two plain Buttons with aria-pressed,
          mirroring the existing nav idiom (App.tsx:168) — NOT web/src/components/ui/tabs.tsx,
          which is unused elsewhere in the app and would add a focus-management surface this
          feature does not need. aria-pressed (a toggle), not aria-current (navigation). */}
      <div className="mb-4 flex gap-2" role="group" aria-label="Item visibility">
        <Button
          type="button"
          size="sm"
          variant={scope === "active" ? "default" : "outline"}
          aria-pressed={scope === "active"}
          onClick={() => setScope("active")}
        >
          Active
        </Button>
        <Button
          type="button"
          size="sm"
          variant={scope === "archived" ? "default" : "outline"}
          aria-pressed={scope === "archived"}
          onClick={() => setScope("archived")}
        >
          Archived
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-muted-foreground">
          {scope === "archived" ? "No archived items." : "No items in this list yet."}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              user={user}
              selectedList={selectedList}
              // Archived view: View only — no checkbox, no Edit, no Delete (plan §5.7). Editing
              // an archived item is Restore-then-edit (NG3); deleting it is still reachable via
              // Restore -> Delete, so nothing is stranded.
              archivedView={scope === "archived"}
              onView={() => itemModal.openView(item)}
              onEdit={() => itemModal.openEdit(item)}
              onDelete={() => void handleDelete(item)}
              onComplete={(occAt) => void handleComplete(item, occAt)}
            />
          ))}
        </ul>
      )}

      <ItemModal
        state={itemModal.state}
        lists={lists}
        user={user}
        defaultListId={listId}
        triggerRef={itemModal.triggerRef}
        onClose={itemModal.close}
        onEditRequested={(item) => itemModal.openEdit(item)}
        onDuplicateRequested={(item) => itemModal.openDuplicate(item)}
        // §9.1 scope switch: this is the SINGLE convergence point for all three create entry
        // points (list "+ New Item" :150, mobile top-bar via createRequestToken :90-93, and
        // Duplicate :219 below) — ItemEditor's onSave prop is this same handler regardless of
        // which door opened it. A per-entry-point patch would leave door 2 (mobile) unfixed.
        // Edit-save also lands here, but an archived item is never editable (canEdit requires
        // !isArchived — ItemDetails.tsx), so onSaved can only fire from Archived scope via a
        // CREATE (new item or duplicate) — never via edit. When scope is already "active" this
        // is an edit-save (or a create made from Active), so just refresh() as before. When
        // scope is "archived", switching it lets the [listId, scope] effect above issue the
        // refetch (scoped to "active"), which is why refresh() is skipped in that branch —
        // calling it here too would fire a stale request for the OLD (archived) scope a beat
        // before the effect's request for the new one (§9.1 "no extra refresh call").
        onSaved={() => {
          itemModal.close();
          if (scope !== "active") {
            setScope("active");
          } else {
            refresh();
          }
        }}
        // Restore must go through refresh()/reloadToken, never onSaved (plan §5.7/R3) — Restore
        // is not an editor save, and refresh() is scope-aware (moves the row between Active and
        // Archived; see the two-fetch-sites note above).
        onArchiveChanged={() => {
          itemModal.close();
          refresh();
        }}
      />
    </div>
  );
}

interface ItemRowProps {
  item: Item;
  user: User;
  selectedList: List | undefined;
  // Archived view (plan §5.7): forces View-only regardless of canWrite — no checkbox, no Edit,
  // no Delete. Archive/Restore/Duplicate live in the view modal (Decision 6), not on the row.
  archivedView: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onComplete: (occurrenceAt?: number) => void;
}

function ItemRow({ item, user, selectedList, archivedView, onView, onEdit, onDelete, onComplete }: ItemRowProps) {
  const completed = Boolean(item.completed_at);
  const canWrite = canWriteList(selectedList, user) && !archivedView;
  // D-OQ5 (item-view-mode plan): formatOccurrenceTime fixes a real bug — the previous
  // `new Date(item.start_at).toLocaleString()` ignored item.all_day entirely, so every
  // all-day row rendered a spurious midnight time. It also uses the item's stored timezone
  // instead of the device's, matching the modal.
  const startDate = formatOccurrenceTime(item.start_at, item.timezone, item.all_day);

  // Expander state is component-local useState (plan §3.7/n2) — it does NOT touch App's
  // activeView ("list" | "calendar" | "admin") nor the initialOpenItem one-shot guard, so it
  // does not interact with the unified list/calendar/admin view state (commit f64c556).
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);

  return (
    <Card
      data-testid="item-row"
      className={cn("flex items-start gap-3 p-4", completed && "opacity-60")}
    >
      {item.type === "task" && !archivedView && (
        // Task-complete checkbox (plan M4 — stays native): drives onComplete via a native
        // change event. A Radix <button role="checkbox"> would change event semantics.
        // Suppressed in the Archived view — completeItem 409s on an archived item anyway (G6).
        <input
          type="checkbox"
          checked={completed}
          onChange={() => onComplete(undefined)}
          className="mt-1"
          title={completed ? "Mark incomplete" : "Mark complete"}
        />
      )}

      <div className="flex-1">
        <div className={cn("font-medium", completed && "line-through")}>
          {/* Title button (item-view-mode plan Decision 6) — THIS SNIPPET IS THE
              AUTHORITATIVE CLASS LIST for this element. Only the title text is the button;
              the event Badge and the recurring Repeat icon stay OUTSIDE it, so the button's
              accessible name is exactly the item title.
              - line-through is REPEATED here (not just on the parent div): CSS
                text-decoration does not propagate into an atomic inline-level box, and a
                <button> is display: inline-block by default (Tailwind preflight resets
                background/border/padding/color but not display).
              - hover:text-primary, NOT hover:underline — Tailwind's `underline` and
                `line-through` are the SAME text-decoration-line utility group, so a
                hover:underline here would erase the strike-through on hover for completed
                items. */}
          <button
            type="button"
            onClick={onView}
            className={cn(
              "rounded-sm text-left font-medium hover:text-primary",
              // Hit box larger than the text line box (Decision 10's touch-target criterion).
              "-my-0.5 py-0.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              completed && "line-through"
            )}
          >
            {item.title}
          </button>
          {item.type === "event" && (
            <Badge variant="secondary" className="ml-2 align-middle">
              event
            </Badge>
          )}
          {item.rrule && <Repeat className="ml-1.5 inline-block h-3 w-3 text-primary" aria-label="recurring" />}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {startDate}
          {item.location && <> · {item.location}</>}
        </div>
        {item.notes && <div className="mt-1 text-sm">{item.notes}</div>}
        {item.reminders.length > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {item.reminders.length} reminder{item.reminders.length > 1 ? "s" : ""}
          </div>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setAttachmentsExpanded((prev) => !prev)}
        >
          Attachments {attachmentsExpanded ? "▲" : "▼"}
        </Button>
        {attachmentsExpanded && (
          <div className="mt-2">
            <AttachmentsView itemId={item.id} />
          </div>
        )}
      </div>

      {/* Requirement 4 (item-view-mode plan): stacked one-per-row, order View/Edit/Delete.
          View renders unconditionally (never gated on write access — Decision 5, edge case 8);
          Edit/Delete stay behind canWrite (the guard that used to wrap this whole container
          now sits on the two write-only buttons individually). size="default" (h-9), not
          size="sm", per Decision 10's touch-target criterion — the Attachments toggle above is
          explicitly exempt and stays size="sm". */}
      <div className="flex shrink-0 flex-col gap-1.5">
        <Button type="button" size="default" variant="secondary" onClick={onView}>
          View
        </Button>
        {canWrite && (
          <>
            <Button type="button" size="default" variant="outline" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" size="default" variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
