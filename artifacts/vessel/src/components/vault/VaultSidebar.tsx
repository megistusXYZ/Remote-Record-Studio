import { useLocation } from "wouter";
import { cn } from "../../lib/utils";
import { VesselButton } from "../vessel-ui/VesselButton";
import { AccountMenu } from "../account/AccountMenu";
import { VesselBrandIcon } from "../icons/VesselBrandIcon";
import { SettingsGearsIcon } from "../icons/SettingsGearsIcon";
import { MyVaultLaptopIcon } from "../icons/MyVaultLaptopIcon";

export type VaultSidebarProps = {
  active: "my-vault" | "settings";
  myVaultCount?: number;
};

export function VaultSidebar({ active, myVaultCount }: VaultSidebarProps) {
  const [, setLocation] = useLocation();

  return (
    <aside className="hidden sm:flex flex-col w-60 shrink-0 border-r border-vessel-border bg-vessel-bg-base/40 backdrop-blur-sm h-full">
      <div className="h-[72px] shrink-0 px-4 flex items-center border-b border-vessel-border">
        <button
          type="button"
          onClick={() => setLocation("/home")}
          aria-label="Go to home"
          className="group flex items-center gap-2 -mx-1 px-1 py-1 rounded-lg hover:bg-vessel-bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent/40 transition-colors"
          data-testid="nav-vault-home"
        >
          <VesselBrandIcon className="w-6 h-6 text-vessel-accent shrink-0 transition-transform group-hover:-translate-y-px" />
          <span className="font-display font-bold tracking-tight text-vessel-text-primary group-hover:text-vessel-accent transition-colors">
            Vessel
          </span>
        </button>
      </div>

      <nav className="p-4 space-y-1">
        <button
          onClick={() => setLocation("/vault")}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            active === "my-vault"
              ? "bg-vessel-bg-surface text-vessel-text-primary border border-vessel-border-strong"
              : "text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-surface/50 border border-transparent"
          )}
          data-testid="nav-vault-my-vault"
        >
          <MyVaultLaptopIcon className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left truncate">My Vault</span>
          {myVaultCount !== undefined && myVaultCount > 0 && (
            <span className="text-xs font-mono-vessel text-vessel-text-muted px-1.5 py-0.5 rounded bg-vessel-bg-base">
              {myVaultCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setLocation("/settings")}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            active === "settings"
              ? "bg-vessel-bg-surface text-vessel-text-primary border border-vessel-border-strong"
              : "text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-surface/50 border border-transparent"
          )}
          data-testid="nav-vault-settings"
        >
          <SettingsGearsIcon className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left truncate">Settings</span>
        </button>
      </nav>

      <div className="mt-auto p-4 border-t border-vessel-border space-y-3">
        <VesselButton
          variant="primary"
          className="w-full"
          onClick={() => setLocation("/home")}
          data-testid="button-sidebar-new-session"
        >
          + New Session
        </VesselButton>
        <AccountMenu variant="sidebar" />
      </div>
    </aside>
  );
}
