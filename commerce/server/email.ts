import { createHash, randomInt } from "node:crypto";
import type { EmailConfig } from "./config.js";

/** Last OTP logged in dev/test when Resend is unset (never exposed over HTTP). */
let lastDevOtp: { to: string; code: string; purpose: "attach" | "recover" } | null = null;

export function getLastDevOtp(): typeof lastDevOtp {
  return lastDevOtp;
}

export function clearLastDevOtp(): void {
  lastDevOtp = null;
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0) return "***";
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/**
 * Send a 6-digit OTP via Resend. When `RESEND_API_KEY` is unset, logs to stderr (dev/test).
 * Never puts the code in HTTP responses.
 */
export async function sendOtpEmail(
  config: EmailConfig,
  input: { to: string; code: string; purpose: "attach" | "recover" }
): Promise<{ delivered: boolean; mode: "resend" | "log" }> {
  const subject =
    input.purpose === "attach"
      ? "Verify your Trustless Commerce wallet email"
      : "Confirm your Trustless Commerce wallet recovery";
  const body = [
    `Your verification code is: ${input.code}`,
    "",
    "It expires in 10 minutes. If you did not request this, ignore this email.",
  ].join("\n");

  if (!config.resendApiKey) {
    lastDevOtp = { to: input.to, code: input.code, purpose: input.purpose };
    console.error(`[email:dev] OTP to=${input.to} purpose=${input.purpose} code=${input.code}`);
    return { delivered: true, mode: "log" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.from ?? "Trustless Commerce <noreply@trustless-commerce.com>",
      to: [input.to],
      subject,
      text: body,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`Resend failed: ${response.status} ${text}`), { statusCode: 502 });
  }
  return { delivered: true, mode: "resend" };
}
