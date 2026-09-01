let scriptPromise: Promise<void> | null = null;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string;
      remove: (widgetId?: string) => void;
    };
  }
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-tc-turnstile]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.dataset.tcTurnstile = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Mount Turnstile into `container`. Returns null when site key is unset (captcha optional). */
export async function mountTurnstile(
  container: HTMLElement,
  siteKey: string | null | undefined,
  opts?: { onToken?: (token: string | null) => void }
): Promise<{ getToken: () => string | null; reset: () => void; destroy: () => void } | null> {
  if (!siteKey) return null;
  await loadTurnstileScript();
  if (!window.turnstile) throw new Error("Turnstile unavailable");
  let token: string | null = null;
  const notify = (t: string | null) => {
    token = t;
    opts?.onToken?.(t);
  };
  const widgetId = window.turnstile.render(container, {
    sitekey: siteKey,
    callback: (t) => {
      notify(t);
    },
    "expired-callback": () => {
      notify(null);
    },
    "error-callback": () => {
      notify(null);
    },
  });
  return {
    getToken: () => token || window.turnstile?.getResponse(widgetId) || null,
    reset: () => {
      notify(null);
      window.turnstile?.reset(widgetId);
    },
    destroy: () => {
      window.turnstile?.remove(widgetId);
    },
  };
}
