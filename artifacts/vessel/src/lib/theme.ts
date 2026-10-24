/**
 * Light, dark, or follow the device. public/theme-boot.js applies the same
 * rules before the app paints; this module takes over once it runs.
 */

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const STORAGE_KEY = "vessel_theme";
const DEVICE_QUERY = "(prefers-color-scheme: dark)";

/** Browser toolbar colour per theme: each palette's page background. */
const BROWSER_BAR: Record<Theme, string> = { light: "#f6f8fa", dark: "#080b0f" };

export function getThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage blocked: follow the device.
  }
  return "system";
}

function deviceTheme(): Theme {
  try {
    return window.matchMedia(DEVICE_QUERY).matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? deviceTheme() : preference;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", BROWSER_BAR[theme]);
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  applyTheme(resolveTheme(preference));
}

/**
 * While the preference is System, keep the page in step with the device.
 * Returns a function that stops listening.
 */
export function followDevice(): () => void {
  let query: MediaQueryList;
  try {
    query = window.matchMedia(DEVICE_QUERY);
  } catch {
    return () => {};
  }
  const onChange = () => {
    if (getThemePreference() === "system") applyTheme(deviceTheme());
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
