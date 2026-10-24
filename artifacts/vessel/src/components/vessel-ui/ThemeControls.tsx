import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "../../hooks/use-theme";
import type { ThemePreference } from "../../lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** System, Light or Dark, for Settings. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn(
        "inline-flex rounded-lg border border-vessel-border bg-vessel-bg-base p-1 gap-1",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(value)}
            data-testid={`theme-${value}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
              selected
                ? "bg-vessel-bg-elevated text-vessel-text-primary shadow-sm"
                : "text-vessel-text-secondary hover:text-vessel-text-primary",
            )}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** One-tap light/dark switch for the public pages' header. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { theme, setPreference } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={next === "light" ? "Switch to light mode" : "Switch to dark mode"}
      title={next === "light" ? "Light mode" : "Dark mode"}
      data-testid="theme-toggle"
      className={cn(
        "inline-flex items-center justify-center w-9 h-9 rounded-md text-vessel-text-secondary hover:text-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
        className,
      )}
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
