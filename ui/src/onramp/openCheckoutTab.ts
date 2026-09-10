const CHECKOUT_WINDOW = "tc-onramp";

/** Open a blank tab on the user gesture, then navigate it to the provider URL. */
export function openBlankCheckoutTab(): Window | null {
  try {
    return window.open("about:blank", CHECKOUT_WINDOW);
  } catch {
    return null;
  }
}

export function navigateCheckoutTab(tab: Window | null, url: string): boolean {
  if (!tab || tab.closed) return false;
  try {
    tab.location.href = url;
    tab.focus();
    return true;
  } catch {
    return false;
  }
}

export function closeCheckoutTab(tab: Window | null): void {
  try {
    tab?.close();
  } catch {
    /* ignore */
  }
}
