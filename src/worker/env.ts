// Env bindings (Appendix §6.3)
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  OWNER_EMAIL: string; // seeds the sole admin role on upsert (O1); must be lowercase-normalized
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string; // e.g. "mailto:owner@example.com"
  EMAIL_FROM: string; // e.g. "Family Scheduler <reminders@mail.jr-quantum.com>"
  APP_URL: string;
  RESEND_API_KEY: string; // secret
  VAPID_PRIVATE_KEY: string; // secret (raw base64url-encoded 32-byte P-256 scalar, web-push format — NOT PKCS8 DER)
  // local-only dev auth shim toggle; NOT a security layer — host gate in auth.ts is the boundary
  DEV_AUTH_IDENTITY?: string;
}
