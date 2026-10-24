import { Link } from "wouter";
import { VesselButton } from "../components/vessel-ui/VesselButton";

export default function NotFound() {
  return (
    <main className="min-h-[100dvh] w-full flex items-center justify-center bg-vessel-bg-base px-4">
      <div className="max-w-md text-center">
        <p className="font-mono-vessel text-xs uppercase tracking-[0.18em] text-vessel-text-muted mb-4">
          404
        </p>
        <h1 className="font-display text-3xl font-bold text-vessel-text-primary tracking-tight mb-3">
          This page doesn&rsquo;t exist.
        </h1>
        <p className="text-sm text-vessel-text-secondary mb-8">
          The link may be mistyped, or the page may have moved.
        </p>
        <Link href="/">
          <VesselButton>Back to home</VesselButton>
        </Link>
      </div>
    </main>
  );
}
