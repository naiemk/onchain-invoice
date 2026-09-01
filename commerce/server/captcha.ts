import type { AppConfig } from "./config.js";

export async function verifyCaptcha(config: AppConfig, token: unknown, remoteIp?: string): Promise<boolean> {
  if (!config.turnstileSecret) {
    return true;
  }
  if (typeof token !== "string" || token.length === 0) {
    return false;
  }
  // CI/tests use TURNSTILE_SECRET=test-secret with captchaToken=test-pass (no Cloudflare call).
  if (config.turnstileSecret === "test-secret" && token === "test-pass") {
    return true;
  }
  if (config.captchaProvider && config.captchaProvider !== "turnstile") {
    throw new Error(`Unsupported captcha provider: ${config.captchaProvider}`);
  }

  const form = new FormData();
  form.set("secret", config.turnstileSecret);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    return false;
  }
  const body = (await response.json()) as { success?: boolean };
  return body.success === true;
}
