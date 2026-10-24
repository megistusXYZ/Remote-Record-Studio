import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followDevice, getThemePreference, setThemePreference } from "./theme";

/**
 * The theme: System (follow the device), Light or Dark. It must be on the
 * page before the app paints, so the first test runs the boot script that
 * index.html loads in <head>, the way the browser does.
 */

type Listener = (e: { matches: boolean }) => void;

/** A device whose colour preference the test controls. */
function fakeDevice(prefersDark: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    get matches() {
      return prefersDark;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  window.matchMedia = ((q: string) =>
    q === "(prefers-color-scheme: dark)"
      ? query
      : { matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as typeof window.matchMedia;
  return {
    switchTo(dark: boolean) {
      prefersDark = dark;
      for (const l of listeners) l({ matches: dark });
    },
  };
}

function runBootScript() {
  const code = readFileSync(join(__dirname, "../../public/theme-boot.js"), "utf8");
  new Function(code)();
}

const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
  html().classList.remove("dark");
  html().style.colorScheme = "";
});

describe("theme before the app loads", () => {
  it("follows the device when nothing is saved", () => {
    fakeDevice(false);
    runBootScript();
    expect(html().dataset.theme).toBe("light");
    expect(html().style.colorScheme).toBe("light");

    fakeDevice(true);
    runBootScript();
    expect(html().dataset.theme).toBe("dark");
    expect(html().classList.contains("dark")).toBe(true);
  });

  it("uses a saved choice over the device, and ignores a broken one", () => {
    fakeDevice(true);
    localStorage.setItem("vessel_theme", "light");
    runBootScript();
    expect(html().dataset.theme).toBe("light");

    localStorage.setItem("vessel_theme", "sepia");
    runBootScript();
    expect(html().dataset.theme).toBe("dark");
  });
});

describe("changing the theme in the app", () => {
  it("remembers the choice and recolours the page and browser bar", () => {
    fakeDevice(true);
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);

    setThemePreference("light");
    expect(getThemePreference()).toBe("light");
    expect(html().dataset.theme).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
    expect(meta.content).toBe("#f6f8fa");

    setThemePreference("system");
    expect(getThemePreference()).toBe("system");
    expect(html().dataset.theme).toBe("dark");
    expect(meta.content).toBe("#080b0f");
    meta.remove();
  });
});

describe("following the device", () => {
  it("tracks a device switch on System, and holds a fixed choice", () => {
    const device = fakeDevice(true);
    setThemePreference("system");
    const stop = followDevice();

    device.switchTo(false);
    expect(html().dataset.theme).toBe("light");

    setThemePreference("dark");
    device.switchTo(false);
    expect(html().dataset.theme).toBe("dark");

    setThemePreference("system");
    stop();
    device.switchTo(true);
    expect(html().dataset.theme).toBe("light");
  });
});
