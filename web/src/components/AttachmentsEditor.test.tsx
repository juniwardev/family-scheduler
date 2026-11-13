// AttachmentsEditor.test.tsx — colocated component test (plan §7.8/M2), matching the existing
// convention (ItemEditor.test.tsx, NotificationSetup.test.tsx). Covers the done condition:
// select a file -> upload -> appears in the list -> remove.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentsEditor } from "./AttachmentsEditor";
import type { Attachment } from "../types";
import * as apiClient from "../apiClient";

vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    listAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  };
});

const ITEM_ID = "item-1";

const EXISTING_ATTACHMENT: Attachment = {
  id: "att-1",
  item_id: ITEM_ID,
  filename: "slip.pdf",
  content_type: "application/pdf",
  size: 2048,
  uploaded_by: "owner@example.com",
  created_at: 0,
};

const UPLOADED_ATTACHMENT: Attachment = {
  id: "att-2",
  item_id: ITEM_ID,
  filename: "photo.png",
  content_type: "image/png",
  size: 1024,
  uploaded_by: "owner@example.com",
  created_at: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

function getFileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("AttachmentsEditor — list on mount", () => {
  it("fetches and renders existing attachments on mount", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({
      attachments: [EXISTING_ATTACHMENT],
    });

    render(<AttachmentsEditor itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText("slip.pdf")).toBeInTheDocument();
    });
    expect(apiClient.listAttachments).toHaveBeenCalledWith(ITEM_ID);
  });

  it("shows 'No attachments yet.' when the list is empty", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });

    render(<AttachmentsEditor itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
    });
  });
});

describe("AttachmentsEditor — select -> upload -> appears -> remove", () => {
  it("uploading a file calls uploadAttachment then refreshes the list to include it", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.listAttachments)
      .mockResolvedValueOnce({ attachments: [] })
      .mockResolvedValueOnce({ attachments: [UPLOADED_ATTACHMENT] });
    vi.mocked(apiClient.uploadAttachment).mockResolvedValue({ attachment: UPLOADED_ATTACHMENT });

    const { container } = render(<AttachmentsEditor itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
    });

    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    await user.upload(getFileInput(container), file);

    await waitFor(() => {
      expect(apiClient.uploadAttachment).toHaveBeenCalledWith(ITEM_ID, file);
    });
    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
    });
  });

  it("clicking Remove calls deleteAttachment then refreshes the list", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.listAttachments)
      .mockResolvedValueOnce({ attachments: [EXISTING_ATTACHMENT] })
      .mockResolvedValueOnce({ attachments: [] });
    vi.mocked(apiClient.deleteAttachment).mockResolvedValue(undefined);

    render(<AttachmentsEditor itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText("slip.pdf")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(apiClient.deleteAttachment).toHaveBeenCalledWith(ITEM_ID, EXISTING_ATTACHMENT.id);
    });
    await waitFor(() => {
      expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
    });
  });
});

describe("AttachmentsEditor — client pre-validation (fast error; server remains authoritative)", () => {
  it("rejects a disallowed extension client-side without calling uploadAttachment", async () => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });

    const { container } = render(<AttachmentsEditor itemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
    });

    // Use fireEvent (not user-event's upload()) here: user-event v14 filters the file against
    // the input's `accept` attribute and silently no-ops for a non-matching extension, which
    // would prevent exercising the client pre-validation path. A real browser's "All Files"
    // file-picker option can still select a non-matching file, so this is a faithful simulation
    // of that case — the SERVER remains the authority regardless (plan §3.7/§5.3).
    const file = new File(["x"], "virus.exe", { type: "application/octet-stream" });
    const input = getFileInput(container);
    fireEvent.change(input, { target: { files: [file] } });

    expect(apiClient.uploadAttachment).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    });
  });
});
