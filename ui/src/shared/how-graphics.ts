/** Inline SVG diagrams for the landing “How it works” cards. */

export function howCreateArt(): string {
  return `
<svg class="how-art" viewBox="0 0 280 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="24" y="28" width="140" height="104" rx="12" fill="#fff" stroke="#d6dee8" stroke-width="1.5"/>
  <rect x="40" y="44" width="72" height="8" rx="4" fill="#0a2540"/>
  <rect x="40" y="60" width="96" height="6" rx="3" fill="#e6ebf1"/>
  <rect x="40" y="74" width="84" height="6" rx="3" fill="#e6ebf1"/>
  <rect x="40" y="100" width="64" height="18" rx="6" fill="#0a6cff"/>
  <path d="M172 80h28" stroke="#0a6cff" stroke-width="2" stroke-linecap="round"/>
  <path d="M192 72l8 8-8 8" stroke="#0a6cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="208" y="52" width="48" height="56" rx="10" fill="#0a2540"/>
  <circle cx="232" cy="72" r="8" fill="#18c9b7"/>
  <rect x="220" y="88" width="24" height="4" rx="2" fill="#67e8db"/>
</svg>`;
}

export function howPayArt(): string {
  return `
<svg class="how-art" viewBox="0 0 280 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="36" y="36" width="120" height="88" rx="12" fill="#fff" stroke="#d6dee8" stroke-width="1.5"/>
  <rect x="52" y="52" width="88" height="56" rx="8" fill="#f6f9fc" stroke="#0a6cff" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="96" y="84" text-anchor="middle" fill="#0a2540" font-family="IBM Plex Mono, monospace" font-size="11">0xA3…9C</text>
  <circle cx="210" cy="80" r="28" fill="#0a6cff" opacity="0.12"/>
  <circle cx="210" cy="80" r="18" fill="#0a6cff"/>
  <path d="M202 80h16M210 72v16" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M156 80h18" stroke="#0a2540" stroke-width="2" stroke-linecap="round"/>
  <path d="M168 72l8 8-8 8" stroke="#0a2540" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

export function howSettleArt(feeLabel = "fee", walletLabel = "Your wallet"): string {
  return `
<svg class="how-art" viewBox="0 0 280 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M40 80h52" stroke="#0a6cff" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="40" cy="80" r="8" fill="#0a6cff"/>
  <path d="M92 80h28" stroke="#0a2540" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M112 72l8 8-8 8" stroke="#0a2540" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="128" y="48" width="72" height="64" rx="12" fill="#0a2540"/>
  <rect x="146" y="66" width="36" height="28" rx="6" fill="#123a5c" stroke="#67e8db" stroke-width="1.5"/>
  <path d="M156 66v-6a8 8 0 0 1 16 0v6" stroke="#67e8db" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M200 64h36" stroke="#aec7c9" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3 3"/>
  <rect x="236" y="54" width="28" height="20" rx="6" fill="#e6ebf1"/>
  <text x="250" y="68" text-anchor="middle" fill="#6b7c93" font-family="IBM Plex Mono, monospace" font-size="8">${escapeXml(feeLabel)}</text>
  <path d="M164 112v16M152 120h24" stroke="#18c9b7" stroke-width="2" stroke-linecap="round"/>
  <text x="164" y="144" text-anchor="middle" fill="#0a2540" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="600">${escapeXml(walletLabel)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char
  );
}
