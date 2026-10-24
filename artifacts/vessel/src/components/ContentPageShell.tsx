import * as React from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { VesselBrandIcon } from "./icons/VesselBrandIcon";
import { ThemeToggleButton } from "./vessel-ui/ThemeControls";

interface ContentPageShellProps {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}

export function ContentPageShell({ title, eyebrow, children }: ContentPageShellProps) {
  return (
    <div className="min-h-[100dvh] bg-vessel-bg-base text-vessel-text-primary selection:bg-vessel-accent/30 selection:text-vessel-accent">
      <header className="relative z-20 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Link
          href="/"
          className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded-md px-1 py-1"
          data-testid="link-content-home"
        >
          <VesselBrandIcon className="w-9 h-9 text-vessel-accent" />
          <div className="flex items-baseline gap-1">
            <span className="font-display font-bold text-xl tracking-tight">Vessel</span>
            <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
          </div>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggleButton />
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-vessel-text-secondary hover:text-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded-md px-2 py-1"
          data-testid="link-content-back"
        >
          <ArrowLeft size={14} />
          <span>Back to home</span>
        </Link>
        </div>
      </header>

      <main className="relative z-10 px-6 pt-8 pb-24">
        <article className="max-w-2xl mx-auto">
          {eyebrow ? (
            <p className="font-mono-vessel text-xs uppercase tracking-[0.18em] text-vessel-text-muted mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight mb-10">
            {title}
          </h1>
          <div className="space-y-8 text-vessel-text-secondary leading-relaxed text-[15px]">
            {children}
          </div>
        </article>
      </main>

      <footer className="relative z-10 py-12 px-6 border-t border-vessel-border bg-vessel-bg-base">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <VesselBrandIcon className="w-6 h-6 text-vessel-accent" />
            <span className="font-display font-bold text-base tracking-tight">Vessel</span>
            <div className="w-1 h-1 rounded-full bg-vessel-accent" />
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-vessel-text-muted font-medium">
            <Link href="/privacy" className="hover:text-vessel-accent transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-vessel-accent transition-colors">
              Terms
            </Link>
            <a
              href="https://github.com/megistusXYZ/Remote-Record-Studio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-vessel-accent transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface ContentSectionProps {
  heading: string;
  children: React.ReactNode;
}

export function ContentSection({ heading, children }: ContentSectionProps) {
  return (
    <section>
      <h2 className="font-display font-bold text-lg sm:text-xl text-vessel-text-primary mb-3 tracking-tight">
        {heading}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
