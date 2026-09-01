/** Theme-aware QR code colors (hex for qrcode library). */
export function qrThemeColors(): { dark: string; light: string } {
  const darkTheme = document.documentElement.dataset.theme === "dark";
  return darkTheme
    ? { dark: "#eef3fb", light: "#171e2c" }
    : { dark: "#0a2540", light: "#ffffff" };
}
