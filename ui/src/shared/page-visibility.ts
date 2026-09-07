/** Re-run when the tab is shown again (Safari bfcache, background tab). Full reloads remount. */
export function subscribePageVisible(onVisible: () => void): () => void {
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onVisible();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") onVisible();
  };
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
