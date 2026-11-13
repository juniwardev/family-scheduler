// AttachmentsEditor — upload/list/remove control for an item's attachments (feat/attachments).
// Rendered inside ItemEditor ONLY in edit mode (item already has an id); create mode shows a
// "save first" hint instead (plan §3.7 — attachments attach to an existing item id).
import React, { useEffect, useState } from "react";
import type { Attachment } from "../types";
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  attachmentDownloadUrl,
  ApiError,
} from "../apiClient";
import { Label } from "./ui/label";
import { Button } from "./ui/button";

// Client-side pre-validation ONLY (fast, friendly error) — the SERVER is the authority
// (plan §3.7/§5.3). Mirrors the server allowlist so a common mistake is caught before a
// round-trip, but this list is NOT the security boundary.
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".pdf", ".docx", ".xlsx", ".txt"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors ATTACHMENT_MAX_FILE_BYTES

function clientPreValidate(file: File): string | null {
  const dotIndex = file.name.lastIndexOf(".");
  const ext = dotIndex > 0 ? file.name.slice(dotIndex).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `File type '${ext || "(none)"}' is not allowed`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `File exceeds the maximum size of ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`;
  }
  return null;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  itemId: string;
}

export function AttachmentsEditor({ itemId }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const { attachments: list } = await listAttachments(itemId);
      setAttachments(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;

    const preValidationError = clientPreValidate(file);
    if (preValidationError) {
      setError(preValidationError);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await uploadAttachment(itemId, file);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (attachmentId: string) => {
    setError(null);
    try {
      await deleteAttachment(itemId, attachmentId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div>
      <Label className="mb-1.5 block">Attachments</Label>

      {error && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading attachments…</div>
      ) : (
        <ul className="mb-2 list-none space-y-1 p-0">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <a
                href={attachmentDownloadUrl(itemId, a.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                {a.filename}
              </a>
              <span className="text-muted-foreground">({formatBytes(a.size)})</span>
              <Button type="button" size="sm" variant="destructive" onClick={() => void handleRemove(a.id)}>
                Remove
              </Button>
            </li>
          ))}
          {attachments.length === 0 && (
            <li className="text-sm text-muted-foreground">No attachments yet.</li>
          )}
        </ul>
      )}

      <input
        type="file"
        accept={ALLOWED_EXTENSIONS.join(",")}
        onChange={(e) => void handleFileSelected(e)}
        disabled={uploading}
        className="text-sm"
      />
      {uploading && <span className="ml-2 text-xs text-muted-foreground">Uploading…</span>}
    </div>
  );
}

/**
 * Rendered in ItemEditor's create mode (no item id yet) — attachments require a saved item
 * (plan §3.7). Simplest correct v1 behavior; a future enhancement could stage uploads and
 * attach them on first save (see docs/plans/attachments.md §6).
 */
export function AttachmentsCreateHint() {
  return (
    <div>
      <Label className="mb-1.5 block">Attachments</Label>
      <div className="text-sm text-muted-foreground">Save the item first, then add attachments.</div>
    </div>
  );
}
