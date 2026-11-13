# Production verification checklist

Open items that can only be confirmed against the live deployment, because each needs a
real-world trigger (a real email, a real cron tick, a real push, a real second person).
None of these block anything shipped — they are confirmations, not fixes.

**Live:** `https://family-scheduler.juniwar-dev.workers.dev`
**Current prod version:** `26191de7` (commit `fd43a69`, deployed 2026-09-21)

Handy for several of these — stream live logs while you poke at the app:

```bash
npx wrangler tail --format=pretty
```

If wrangler says *"Not logged in / token expired"*, run `npx wrangler login` first (needs an
interactive terminal).

---

## [ ] 1. Eyeball a real reminder email

Logs confirm **delivery** (`sent:2 failed:0`), never **appearance**. Nobody has actually looked
at one since the notifications-and-location work landed.

Set a reminder a few minutes out, let it fire, then open the email and check:

- Subject is type-aware — `Event reminder:` for events, `Task due:` for tasks
- The time is human-readable and in the **item's** timezone, not UTC and not yours
- The `?item=` deep link works — and note that it now opens **view** mode, not the editor
- Location renders correctly for its kind: a map link for an address, "Tap to join" for a
  meeting URL, plain text otherwise

## [ ] 2. Watch the daily digest cron

Trigger: `0 14 * * *` UTC ≈ **07:00 America/Los_Angeles**.

One morning, confirm the digest email actually sends. Times inside it should render in each
item's own timezone (fixed 2026-07-11 — that fix has never been observed live).

```bash
npx wrangler tail --format=pretty   # leave running across the tick
```

## [ ] 3. Tap a real push notification

This is the one behavior change from `item-view-mode` that was not in the original request, so
it is worth feeling out rather than just confirming.

On the iPhone, when a reminder push arrives, tap it and confirm:

- It opens the item in **view** mode — read-only, no form fields
- For a meeting-location item, the "Tap to join" location is a **real tappable link**.
  This was the deciding argument for view mode: in edit mode `location` is a text input, so the
  meeting URL could not be clicked at all.

## [ ] 4. Private-list isolation — the Access identity half

The authorization code is verified and now guarded by
`tests/unit/list-isolation-http.test.ts` (10 tests, runs on every `npm test`), plus a live
two-identity run locally. See `docs/qa/list-isolation-http-audit.md`.

**The only unverified piece** is prod-specific: that Cloudflare Access resolves a second family
member's JWT to *their own* email rather than the owner's. Local testing cannot cover it,
because it substitutes the identity source.

Next time a second family member is around, ~2 minutes:

1. **You**, in the browser console on the live site — grab a private list's id:
   ```js
   (await (await fetch('/api/lists')).json()).lists
     .filter(l => l.visibility === 'private')
     .map(l => ({ name: l.name, id: l.id }))
   ```
2. **Them**, logged in as themselves on the live site, in their console:
   ```js
   await fetch('/api/lists/<PASTE_ID>/items').then(r => r.status)   // expect 403
   await fetch('/api/me').then(r => r.json())                        // your private list absent
   ```

Expect **403** and the private list missing from their `/api/me`. If either differs, that is a
real security finding — capture it and stop.

---

## [ ] 5. Preview URLs — confirm the exposure is closed (opened 2026-09-21)

Added after PR #27. `preview_urls = false` had been mis-nested under `[vars]` since 6e02992
(2026-06-29), so wrangler bound it as `env.preview_urls` and **never sent the setting**. With
`workers_dev` enabled and wrangler >= 4.44.0, preview URLs default to match `workers_dev` —
i.e. **enabled**. Deploy `26191de7` is the first to actually send `false`; the new
`▲ [WARNING] ... Preview URLs are still disabled` line on that deploy is the proof it applies.

What is confirmed: the setting is now applied. What is **not**: whether previews were ever
actually reachable, and whether anything reached them. Preview URLs live at
`<VERSION_PREFIX>-family-scheduler.juniwar-dev.workers.dev` — a different hostname from
`APP_URL`, so the Access application guarding this app does not necessarily cover them.

- In the dashboard: **Workers & Pages → family-scheduler → Settings → Domains & Routes** —
  confirm Preview URLs now reads **disabled**.
- If any request analytics exist for those preview hostnames, check whether they served traffic
  during 2026-06-29 → 2026-09-21. Any non-Access-gated hit on real family data is a genuine
  security finding — capture it and stop.
- Note wrangler will keep emitting that warning on every deploy, suggesting `preview_urls = true`.
  Ignore it: disabled is the intended state.

---

## Already confirmed (no action)

- iPhone push delivery, and push staying enabled across a Safari close/reopen
- UI redesign on desktop and iPhone
- `item-view-mode` on iPhone (2026-08-22)
- Attachments end-to-end in prod (upload / list / download / delete / cascade)
- Access login, list & item CRUD, `*/5` cron, multi-user shared-list visibility
