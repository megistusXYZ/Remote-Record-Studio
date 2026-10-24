import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Both palettes, read from the stylesheet, must stay readable: WCAG AA asks
 * for 4.5:1 for text and 3:1 for large text and status marks. A pale grey
 * that looks fine on dark can vanish on white; this catches it.
 */

const CSS = readFileSync(join(__dirname, "index.css"), "utf8");

/** The `--vessel-*` tokens declared in the first block whose selector matches. */
function palette(selector: RegExp): Record<string, string> {
  const blocks = CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, sel, body] of blocks) {
    if (!selector.test(sel!)) continue;
    const out: Record<string, string> = {};
    for (const [, name, value] of body!.matchAll(/--vessel-([a-z-]+):\s*([^;]+);/g)) {
      out[name!] = value!.trim();
    }
    return out;
  }
  throw new Error(`No block for ${selector}`);
}

type RGBA = [number, number, number, number];

function parse(color: string): RGBA {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1]!.split(",").map((s) => s.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`Unreadable colour ${color}`);
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number {
  const back = parse(bg);
  const front = over(parse(fg), back);
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("contrast maths", () => {
  it("matches published reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // WebAIM: #777777 on white is 4.48:1, just under AA.
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

const THEMES = {
  dark: palette(/\[data-theme="dark"\]/),
  light: palette(/\[data-theme="light"\]/),
};

describe.each(Object.entries(THEMES))("%s palette", (_, t) => {
  const backgrounds = ["bg-base", "bg-surface", "bg-elevated"];

  it.each(["text-primary", "text-secondary", "text-muted"])(
    "%s is readable on every background",
    (text) => {
      for (const bg of backgrounds) {
        expect(contrast(t[text]!, t[bg]!), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("accent links are readable, and so are labels on accent buttons", () => {
    for (const bg of ["bg-base", "bg-surface"]) {
      expect(contrast(t.accent!, t[bg]!), `accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t["bg-base"]!, t.accent!), "label on accent").toBeGreaterThanOrEqual(4.5);
  });

  it("errors read as text, and status colours stand out", () => {
    expect(contrast(t.red!, t["bg-surface"]!), "red").toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.amber!, t["bg-surface"]!), "amber").toBeGreaterThanOrEqual(3);
    expect(contrast(t.green!, t["bg-surface"]!), "green").toBeGreaterThanOrEqual(3);
  });

  it("strong borders are visible", () => {
    expect(contrast(t["border-strong"]!, t["bg-surface"]!), "border-strong").toBeGreaterThanOrEqual(1.3);
  });
});
