import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AccountMenu } from "./account/AccountMenu";
import { VesselBrandIcon } from "./icons/VesselBrandIcon";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground dark">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/home" className="flex items-center gap-2 group" data-testid="link-logo">
            <VesselBrandIcon className="w-7 h-7 text-vessel-accent shrink-0 transition-transform group-hover:-translate-y-px" />
            <span className="font-display font-bold text-xl tracking-tight group-hover:text-vessel-accent transition-colors">
              Vessel
            </span>
          </Link>
          
          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-6">
              <Link
                href="/home"
                className={`text-sm font-medium transition-colors ${location === '/home' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid="link-nav-home"
              >
                Dashboard
              </Link>
              <Link
                href="/record"
                className={`text-sm font-medium transition-colors ${location === '/record' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid="link-nav-record"
              >
                New recording
              </Link>
              <Link
                href="/vault"
                className={`text-sm font-medium transition-colors ${location === '/vault' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid="link-nav-vault"
              >
                Vault
              </Link>
              <Link
                href="/settings"
                className={`text-sm font-medium transition-colors ${location === '/settings' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                data-testid="link-nav-settings"
              >
                Settings
              </Link>
            </nav>
            <AccountMenu variant="header" />
          </div>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
