// AttachmentsView — minimal read-only attachment panel (feat/attachments, plan §3.7).
// Lives as an expandable panel on the item row in ItemListView (an "Attachments" toggle that
// expands to show image thumbnails + filename/download links for docs), rather than a new
// modal — least invasive, no new routing, no change to how items open (still ItemEditor on
// Edit). Only fetches the attachment list when expanded (lazy), to avoid N fetches on list
// render. Read-only: no upload/remove controls here (those live in AttachmentsEditor).
import React, { useEffect, useState } from "react";
import type { Attachment } from "../types";
import { listAttachments, attachmentDownloadUrl, ApiError } from "../apiClient";

interface Props {
  itemId: string;
}

export function AttachmentsView({ itemId }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAttachments(itemId)
      .then((data) => {
        if (!cancelled) setAttachments(data.attachments);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading attachments…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (attachments.length === 0) {
    return <div className="text-sm text-muted-foreground">No attachments.</div>;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {attachments.map((a) =>
        a.content_type.startsWith("image/") ? (
          <a
            key={a.id}
            href={attachmentDownloadUrl(itemId, a.id)}
            target="_blank"
            rel="noopener noreferrer"
            title={a.filename}
          >
            <img
              src={attachmentDownloadUrl(itemId, a.id)}
              alt={a.filename}
              className="h-16 w-16 rounded-md border border-border object-cover"
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={attachmentDownloadUrl(itemId, a.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm"
          >
            {a.filename}
          </a>
        )
      )}
    </div>
  );
}
