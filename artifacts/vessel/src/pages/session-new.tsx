import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { Input } from "@/components/ui/input";
import { useCreateSession } from "@workspace/api-client-react";
import { Mic, ArrowRight } from "lucide-react";

export default function NewSession() {
  const [, setLocation] = useLocation();
  const { pubkey, displayName, isLoaded } = useIdentity();
  
  const [title, setTitle] = useState("");
  
  const createSessionMutation = useCreateSession();

  useEffect(() => {
    if (isLoaded && (!pubkey || !displayName)) setLocation("/");
  }, [isLoaded, pubkey, displayName, setLocation]);

  if (!isLoaded) return null;
  if (!pubkey || !displayName) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || createSessionMutation.isPending) return;

    try {
      const session = await createSessionMutation.mutateAsync({
        data: {
          title: title.trim(),
          hostPubkey: pubkey,
          hostName: displayName
        }
      });
      setLocation(`/session/${session.id}`);
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="vessel-card p-8 md:p-10">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
            <Mic className="w-8 h-8 text-primary" />
          </div>
          
          <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Create new session</h1>
          <p className="text-muted-foreground mb-8">Set up your studio room to start recording.</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium text-secondary-foreground ml-1">
                Session Title
              </label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Interview with Jane Doe"
                className="h-14 text-lg bg-surface border-border-strong focus-visible:ring-primary rounded-xl px-4"
                data-testid="input-session-title"
                autoFocus
              />
            </div>
            
            <div className="flex items-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => setLocation("/home")}
                className="vessel-btn vessel-btn-secondary h-12 px-6"
                data-testid="button-cancel-session"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || createSessionMutation.isPending}
                className="vessel-btn vessel-btn-primary h-12 px-8 flex-1 gap-2"
                data-testid="button-create-session"
              >
                {createSessionMutation.isPending ? "Creating..." : "Enter Studio"}
                {!createSessionMutation.isPending && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
