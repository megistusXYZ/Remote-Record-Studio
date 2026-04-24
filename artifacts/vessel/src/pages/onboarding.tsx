import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Input } from "@/components/ui/input";

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { displayName, setDisplayName, isLoaded } = useIdentity();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isLoaded && displayName) {
      setLocation("/home");
    }
  }, [isLoaded, displayName, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    await setDisplayName(name.trim());
    setLocation("/home");
  };

  if (!isLoaded || displayName) {
    return null;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background dark text-foreground px-4">
      <div className="w-full max-w-md space-y-8 text-center animate-in fade-in zoom-in duration-700">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-primary shadow-[0_0_20px_rgba(0,212,170,0.6)] animate-pulse"></div>
          </div>
          <h1 className="text-4xl font-serif font-bold tracking-tight">Welcome to Vessel</h1>
          <p className="text-muted-foreground text-lg max-w-[280px]">Your professional recording studio in the browser.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 mt-12">
          <div className="space-y-2 text-left">
            <label htmlFor="name" className="text-sm font-medium text-secondary-foreground ml-1">
              What should we call you?
            </label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-14 text-lg bg-surface border-border-strong focus-visible:ring-primary rounded-xl px-4"
              data-testid="input-name"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || isSubmitting}
            className="vessel-btn vessel-btn-primary w-full h-14 text-lg"
            data-testid="button-submit-name"
          >
            {isSubmitting ? "Setting up..." : "Enter Studio"}
          </button>
        </form>
      </div>
      
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background -z-10 pointer-events-none"></div>
    </div>
  );
}
