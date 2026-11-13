// RadixSpike.test.tsx — THROWAWAY Phase-1 exit-gate spike (ui-redesign plan §7/§10 step 9, M1).
//
// Proves, before any real view is migrated, that a shadcn/Radix Dialog + Select + Tabs can
// MOUNT, be INTERACTED with via user-event, and UNMOUNT (Dialog leaves the DOM on open=false)
// in the jsdom "web" Vitest project with only the polyfills added to
// tests/setup/jsdom.setup.ts. This is also the M2 alias-gate: it imports "@/lib/utils".
//
// If this test needs a polyfill beyond what's already in jsdom.setup.ts, that gap must be
// fixed in jsdom.setup.ts (not worked around here) before Phase 1 is considered done.
//
// Per the plan, this file may be removed or kept as a smoke test once it's green — kept here
// (see impl notes) as a cheap regression guard for the Radix/jsdom wiring.
/// <reference types="@testing-library/jest-dom/vitest" />
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// M2 gate: @/lib/utils resolves and cn() behaves as expected under the web Vitest project.
describe("M2 gate — @/ alias resolves in the web Vitest project", () => {
  it("cn() merges class names", () => {
    const shouldInclude = false;
    expect(cn("a", shouldInclude && "b", "c")).toBe("a c");
  });
});

function SpikeHarness({ dialogDefaultOpen = false }: { dialogDefaultOpen?: boolean }) {
  const [open, setOpen] = useState(dialogDefaultOpen);
  return (
    <div>
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Tab one content</TabsContent>
        <TabsContent value="two">Tab two content</TabsContent>
      </Tabs>

      <Select defaultValue="a">
        <SelectTrigger aria-label="spike-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Spike Dialog</DialogTitle>
          <button type="button" onClick={() => setOpen(false)}>
            Close spike dialog
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

describe("M1 spike gate — Radix Dialog + Select + Tabs mount/interact/unmount in jsdom", () => {
  it("mounts Tabs and switches tabs via user-event", async () => {
    const user = userEvent.setup();
    render(<SpikeHarness />);

    expect(screen.getByText("Tab one content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Two" }));

    expect(await screen.findByText("Tab two content")).toBeInTheDocument();
  });

  it("mounts Select, opens it, and picks an option via user-event", async () => {
    const user = userEvent.setup();
    render(<SpikeHarness />);

    await user.click(screen.getByRole("combobox", { name: "spike-select" }));
    const optionB = await screen.findByRole("option", { name: "Option B" });
    await user.click(optionB);

    // Radix Select renders the selected item's text into the trigger's SelectValue slot.
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "spike-select" })).toHaveTextContent("Option B");
    });
  });

  it("mounts Dialog open, and closing it (open=false) removes its content from the DOM (state-driven unmount, B2)", async () => {
    const user = userEvent.setup();
    render(<SpikeHarness dialogDefaultOpen />);

    expect(screen.getByText("Spike Dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close spike dialog" }));

    // This MUST resolve without hanging on an animationend event jsdom never fires — proves
    // the vendored Dialog's unmount is state-driven (plan B2/Decision 3), not animation-gated.
    await waitFor(() => expect(screen.queryByText("Spike Dialog")).not.toBeInTheDocument());
  });
});
