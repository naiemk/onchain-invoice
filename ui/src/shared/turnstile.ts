let scriptPromise: Promise<void> | null = null;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          appearance?: "always" | "execute" | "interaction-only";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string;
      remove: (widgetId?: string | HTMLElement) => void;
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

export type TurnstileHandle = {
  getToken: () => string | null;
  reset: () => void;
  destroy: () => void;
};

/** Mount Turnstile into `container`. Returns null when site key is unset (captcha optional). */
export async function mountTurnstile(
  container: HTMLElement,
  siteKey: string | null | undefined,
  opts?: { onToken?: (token: string | null) => void; signal?: AbortSignal }
): Promise<TurnstileHandle | null> {
  if (!siteKey) return null;
  await loadTurnstileScript();
  if (opts?.signal?.aborted) return null;
  if (!window.turnstile) throw new Error("Turnstile unavailable");

  // Dedicated host so React Strict Mode / dialog remount can render again
  // without "already been rendered in this container".
  const host = document.createElement("div");
  container.replaceChildren(host);
  if (opts?.signal?.aborted) {
    container.replaceChildren();
    return null;
  }

  let token: string | null = null;
  const notify = (t: string | null) => {
    token = t;
    opts?.onToken?.(t);
  };

  let widgetId: string;
  try {
    widgetId = window.turnstile.render(host, {
      sitekey: siteKey,
      appearance: "always",
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
  } catch {
    container.replaceChildren();
    return null;
  }

  if (opts?.signal?.aborted) {
    try {
      window.turnstile.remove(widgetId);
    } catch {
      /* already gone */
    }
    container.replaceChildren();
    return null;
  }

  const destroy = () => {
    try {
      window.turnstile?.remove(widgetId);
    } catch {
      /* already gone */
    }
    if (host.parentNode === container) container.replaceChildren();
  };

  return {
    getToken: () => {
      try {
        return token || window.turnstile?.getResponse(widgetId) || null;
      } catch {
        return token;
      }
    },
    reset: () => {
      notify(null);
      try {
        window.turnstile?.reset(widgetId);
      } catch {
        /* already gone */
      }
    },
    destroy,
  };
}
