// channels/email.ts — Resend integration (single email integration point)
// Swapping to Amazon SES later is a single-file change (spec §8).
// Returns a Result that distinguishes transient from permanent failures (D13).

import type { Env } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  ok: boolean;
  permanent: boolean; // true = permanent failure (4xx); false = transient or success
  statusCode?: number;
  error?: string;
}

/**
 * Send an email via Resend.
 * Returns EmailResult:
 *  - { ok: true, permanent: false } on success
 *  - { ok: false, permanent: false } on transient (5xx/429/network) — caller leaves dispatch pending
 *  - { ok: false, permanent: true } on permanent failure (4xx not retryable) — caller marks failed
 */
export async function sendEmail(msg: EmailMessage, env: Env): Promise<EmailResult> {
  let resp: Response;
  try {
    resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
  } catch (err) {
    // Network error — transient
    return { ok: false, permanent: false, error: String(err) };
  }

  if (resp.ok) {
    return { ok: true, permanent: false, statusCode: resp.status };
  }

  if (resp.status === 429 || resp.status >= 500) {
    // Rate limit or server error — transient
    return { ok: false, permanent: false, statusCode: resp.status };
  }

  // Other 4xx — permanent failure
  const body = await resp.text().catch(() => "");
  return { ok: false, permanent: true, statusCode: resp.status, error: body };
}
