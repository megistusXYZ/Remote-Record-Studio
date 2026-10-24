import { useCallback, useEffect, useState } from "react";
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  type Theme,
  type ThemePreference,
} from "../lib/theme";

/** The saved preference, the theme on screen now, and a way to change it. */
export function useTheme(): {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (p: ThemePreference) => void;
} {
  const [preference, setPref] = useState<ThemePreference>(getThemePreference);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(getThemePreference()));

  useEffect(() => {
    // Another control, another tab or the device may change the theme.
    const sync = () => {
      setPref(getThemePreference());
      setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("storage", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setThemePreference(p);
    setPref(p);
    setTheme(resolveTheme(p));
  }, []);

  return { preference, theme, setPreference };
}
