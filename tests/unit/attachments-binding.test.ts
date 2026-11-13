// Phase-1 spike (feat/attachments, plan §7.2): PROVES env.ATTACHMENTS (R2 binding) surfaces
// in the worker vitest-pool-workers project via the miniflare r2Buckets config added to
// vitest.workspace.ts. This MUST pass before any route/db/cascade code is built on top of the
// R2 binding — see docs/plans/attachments.md §7.2 (M1 hard gate).
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("R2 test binding spike (env.ATTACHMENTS)", () => {
  it("put/get/delete round-trips against the emulated ATTACHMENTS bucket", async () => {
    const key = "spike/x";
    const body = "hi";

    await env.ATTACHMENTS.put(key, body);

    const got = await env.ATTACHMENTS.get(key);
    expect(got).not.toBeNull();
    const text = await got!.text();
    expect(text).toBe(body);

    await env.ATTACHMENTS.delete(key);
    const afterDelete = await env.ATTACHMENTS.get(key);
    expect(afterDelete).toBeNull();
  });
});
