// Config constants (Appendix §6.2)
export interface EngineConfig {
  LOOKAHEAD_DAYS: number; // rolling window for materialize (spec §9: start with 60)
  GRACE_MINUTES: number; // how far back sendDue reaches (spec §9: start with 30)
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  LOOKAHEAD_DAYS: 60,
  GRACE_MINUTES: 30,
};

// Default timezone used when an item doesn't specify one (spec §4)
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

// ---------------------------------------------------------------------------
// Attachments (feat/attachments, plan §5.3) — size caps + MIME/extension allowlist.
// All caps and the allowlist are enforced server-side (Worker), never trusting the client.
// ---------------------------------------------------------------------------

export const ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024; // per-file cap: 10 MB
export const ATTACHMENT_MAX_ITEM_BYTES = 25 * 1024 * 1024; // per-item total cap: 25 MB
// Secondary guard: keeps the sum/list check sane AND is the invariant the cascade helper's
// single-page R2 list({ prefix }) relies on (plan §3.4/m6) — see deleteAttachmentObjectsForItem.
export const ATTACHMENT_MAX_ITEM_COUNT = 10;

// Extension -> allowed Content-Type(s). Validation rule (v1 gate, plan §5.3): the file's
// extension must be a key here AND the declared Content-Type must be one of the allowed values
// for that extension (compared before any `;` parameter, e.g. "text/plain; charset=utf-8").
// SVG/HTML/executables are excluded by omission — SVG deliberately (can carry script, §3.6).
export const ATTACHMENT_ALLOWLIST: Record<string, readonly string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".txt": ["text/plain"],
};
