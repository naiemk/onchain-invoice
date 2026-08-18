import { bcp47 } from "./detect.js";
import { getLocale } from "./t.js";

export function intlLocale(): string {
  return bcp47(getLocale());
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(intlLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMs = date.getTime() - Date.now();
  const minutes = Math.round(deltaMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" });
  if (Math.abs(minutes) < 1) return rtf.format(0, "second");
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
}
