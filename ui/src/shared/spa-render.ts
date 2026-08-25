/** Monotonic id so in-flight page fetches don't paint over a newer route. */
let generation = 0;

export function beginSpaRender(): number {
  generation += 1;
  return generation;
}

export function currentSpaRender(): number {
  return generation;
}

export function isSpaRenderCurrent(id: number): boolean {
  return id === generation;
}

/** Client-side navigation without a full document reload. */
export function spaNavigate(path: string, mode: "push" | "replace" = "push"): void {
  if (mode === "replace") history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
