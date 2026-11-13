// AttachmentsView.test.tsx — colocated component test (plan §7.8/M2). Covers the done
// condition: image thumbnail vs. filename+download link, and the lazy-fetch-on-mount behavior.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AttachmentsView } from "./AttachmentsView";
import type { Attachment } from "../types";
import * as apiClient from "../apiClient";

vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    listAttachments: vi.fn(),
  };
});

const ITEM_ID = "item-1";

const IMAGE_ATTACHMENT: Attachment = {
  id: "att-img",
  item_id: ITEM_ID,
  filename: "photo.png",
  content_type: "image/png",
  size: 1024,
  uploaded_by: "owner@example.com",
  created_at: 0,
};

const PDF_ATTACHMENT: Attachment = {
  id: "att-pdf",
  item_id: ITEM_ID,
  filename: "slip.pdf",
  content_type: "application/pdf",
  size: 2048,
  uploaded_by: "owner@example.com",
  created_at: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttachmentsView — thumbnail vs download link", () => {
  it("renders an <img> thumbnail for an image/* attachment", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [IMAGE_ATTACHMENT] });

    render(<AttachmentsView itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByAltText("photo.png")).toBeInTheDocument();
    });
    const img = screen.getByAltText("photo.png") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.src).toContain(`/api/items/${ITEM_ID}/attachments/${IMAGE_ATTACHMENT.id}`);
  });

  it("renders a filename + download link (no <img>) for a non-image attachment", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [PDF_ATTACHMENT] });

    render(<AttachmentsView itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText("slip.pdf")).toBeInTheDocument();
    });
    const link = screen.getByText("slip.pdf") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.href).toContain(`/api/items/${ITEM_ID}/attachments/${PDF_ATTACHMENT.id}`);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows 'No attachments.' when the list is empty", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });

    render(<AttachmentsView itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/no attachments\./i)).toBeInTheDocument();
    });
  });

  it("fetches lazily on mount (only once) rather than eagerly for every list row", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [IMAGE_ATTACHMENT] });

    render(<AttachmentsView itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(apiClient.listAttachments).toHaveBeenCalledTimes(1);
    });
    expect(apiClient.listAttachments).toHaveBeenCalledWith(ITEM_ID);
  });
});
