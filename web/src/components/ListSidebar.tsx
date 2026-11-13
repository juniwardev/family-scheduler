// ListSidebar — show owned + shared lists, create/rename/recolor/visibility toggle
import React, { useState } from "react";
import { Globe, Lock, X } from "lucide-react";
import type { User, List } from "../types";
import { getLists, createList, updateList, deleteList } from "../apiClient";
import { NotificationSetup } from "./NotificationSetup";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

interface Props {
  lists: List[];
  selectedListId: string | null;
  user: User;
  onSelect: (id: string) => void;
  onListsChange: (lists: List[]) => void;
  onUserChange?: (user: User) => void;
}

export function ListSidebar({ lists, selectedListId, user, onSelect, onListsChange, onUserChange }: Props) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const data = await getLists();
    onListsChange(data.lists);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await createList(name, null, "private");
      setNewName("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (list: List, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete list "${list.name}"? This will also delete all items.`)) return;
    try {
      await deleteList(list.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleVisibility = async (list: List, e: React.MouseEvent) => {
    e.stopPropagation();
    const newVis = list.visibility === "shared" ? "private" : "shared";
    try {
      await updateList(list.id, { visibility: newVis });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Lists</div>

      {error && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <ul className="mb-4 list-none space-y-0.5 p-0">
        {lists.map((list) => (
          <li key={list.id}>
            <button
              type="button"
              onClick={() => onSelect(list.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                selectedListId === list.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                // Dynamic per-list color (a stored hex string) — Tailwind cannot express an
                // arbitrary runtime hex, so this single inline style is the documented
                // exception to "no inline styles" (plan §6).
                style={{ background: list.color ?? "hsl(var(--primary))" }}
              />
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {list.name}
                {list.visibility === "shared" && (
                  <span className="ml-1 text-[10px] text-muted-foreground">shared</span>
                )}
              </span>
              {list.owner_email === user.email && (
                <span className="flex shrink-0 items-center gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    title={list.visibility === "shared" ? "Make private" : "Share"}
                    onClick={(e) => void handleVisibility(list, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handleVisibility(list, e as unknown as React.MouseEvent);
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {list.visibility === "shared" ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      <Globe className="h-3 w-3" />
                    )}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Delete list"
                    onClick={(e) => void handleDelete(list, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handleDelete(list, e as unknown as React.MouseEvent);
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-1.5">
        <Input
          type="text"
          placeholder="New list name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreate();
          }}
          className="h-8 flex-1 text-sm"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={creating || !newName.trim()}
        >
          +
        </Button>
      </div>

      <div className="mt-6">
        <NotificationSetup user={user} onUserChange={onUserChange} />
      </div>
    </div>
  );
}
