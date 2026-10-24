import * as React from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Home, Library, Mic, Settings, type LucideIcon } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home, testId: "mobile-nav-home" },
  { href: "/vault", label: "Vault", icon: Library, testId: "mobile-nav-vault" },
  { href: "/settings", label: "Settings", icon: Settings, testId: "mobile-nav-settings" },
];

const FAB_ITEM: NavItem = {
  href: "/session/new",
  label: "Record",
  icon: Mic,
  testId: "mobile-nav-record",
};

function isActive(current: string, href: string): boolean {
  if (href === "/home") return current === "/home";
  if (href === "/vault") return current === "/vault" || current.startsWith("/vault/");
  if (href === "/settings") return current === "/settings";
  if (href === "/session/new") return current === "/session/new";
  return false;
}

interface TabProps {
  item: NavItem;
  active: boolean;
}

function Tab({ item, active }: TabProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-testid={item.testId}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 px-1 min-h-[56px] rounded-2xl active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vessel-bg-elevated"
    >
      {active && (
        <motion.span
          layoutId="mobile-nav-active-pill"
          className="absolute inset-y-1.5 inset-x-2 rounded-2xl bg-vessel-accent/12 border border-vessel-accent/25"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          aria-hidden="true"
        />
      )}
      <Icon
        className={`relative w-[22px] h-[22px] transition-colors ${
          active ? "text-vessel-accent" : "text-vessel-text-muted"
        }`}
        strokeWidth={active ? 2.25 : 2}
      />
      <span
        className={`relative text-[10px] font-medium tracking-wide leading-none transition-colors ${
          active ? "text-vessel-accent" : "text-vessel-text-muted"
        }`}
      >
        {item.label}
      </span>
    </Link>
  );
}

function RecordFab({ active }: { active: boolean }) {
  const Icon = FAB_ITEM.icon;
  return (
    <Link
      href={FAB_ITEM.href}
      data-testid={FAB_ITEM.testId}
      aria-label={FAB_ITEM.label}
      aria-current={active ? "page" : undefined}
      className="group relative flex flex-1 flex-col items-center justify-end gap-1 py-2 px-1 min-h-[56px] rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vessel-bg-elevated"
    >
      <span className="relative -mt-5 flex items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-vessel-accent/35 blur-md group-hover:bg-vessel-accent/45 transition-colors"
        />
        <span
          className="relative w-12 h-12 rounded-full flex items-center justify-center bg-vessel-accent text-vessel-bg-base shadow-[0_6px_18px_rgb(var(--vessel-accent-rgb)/0.45)] ring-4 ring-vessel-bg-elevated group-hover:brightness-110 group-active:scale-95 transition-all"
        >
          <Icon className="w-5 h-5" strokeWidth={2.5} />
        </span>
      </span>
      <span
        className={`relative text-[10px] font-medium tracking-wide leading-none transition-colors ${
          active ? "text-vessel-accent" : "text-vessel-text-muted"
        }`}
      >
        {FAB_ITEM.label}
      </span>
    </Link>
  );
}

export function MobileBottomNav() {
  const [location] = useLocation();
  const fabActive = isActive(location, FAB_ITEM.href);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 md:hidden pointer-events-none"
    >
      <div className="pointer-events-auto bg-vessel-bg-elevated/95 backdrop-blur-xl border-t border-vessel-border shadow-[0_-4px_24px_rgb(var(--vessel-shadow-rgb)/0.25)]">
        <div className="max-w-md mx-auto px-2 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-stretch justify-between gap-1 h-[68px]">
            <Tab item={NAV_ITEMS[0]} active={isActive(location, NAV_ITEMS[0].href)} />
            <Tab item={NAV_ITEMS[1]} active={isActive(location, NAV_ITEMS[1].href)} />
            <RecordFab active={fabActive} />
            <Tab item={NAV_ITEMS[2]} active={isActive(location, NAV_ITEMS[2].href)} />
          </div>
        </div>
      </div>
    </nav>
  );
}
