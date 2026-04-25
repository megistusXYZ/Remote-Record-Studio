import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AccountMenu } from "./account/AccountMenu";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground dark">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/home" className="flex items-center gap-2 group" data-testid="link-logo">
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <div className="w-3 h-3 rounded-full bg-primary shadow-[0_0_10px_rgba(0,212,170,0.5)]"></div>
            </div>
            <span className="font-serif font-bold text-lg tracking-wide">Vessel</span>
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
