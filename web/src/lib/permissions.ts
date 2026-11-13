// web/src/lib/permissions.ts — client-side mirror of the server's write-authorization rule.
//
// Faithfully mirrors src/worker/db.ts's canWriteList (Decision 5, item-view-mode plan):
//   const norm = email.toLowerCase();
//   if (list.visibility === "shared") return true;
//   return list.owner_email === norm;
//
// The server only lowercases the CALLER's email and compares list.owner_email verbatim. We
// lowercase BOTH sides here — a strict superset of the server's rule, not a divergence: the
// server normalises owner_email to lowercase at insert time (db.ts:341 binds `norm`), so a
// mixed-case owner_email is unreachable in stored data. This just makes the client rule honest
// against a case-sensitive comparison bug the old inline expression
// (ItemListView.tsx: `selectedList?.owner_email === user.email`) had.
//
// Note: GET /api/lists only ever returns lists that are shared or owned by the caller
// (db.ts:323-329), so in practice this is `true` for every list the client can see today. It
// is retained as defense-in-depth and to keep the client rule honest against the server rule —
// not because a false case is currently reachable client-side. Do not "simplify" it away.
import type { List, User } from "../types";

export function canWriteList(list: List | undefined, user: User): boolean {
  if (!list) return false;
  if (list.visibility === "shared") return true;
  return list.owner_email.toLowerCase() === user.email.toLowerCase();
}
