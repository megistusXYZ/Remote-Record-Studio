import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { Input } from "@/components/ui/input";
import { Copy, Check, Key } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { pubkey, displayName, setDisplayName, isLoaded } = useIdentity();
  
  const [name, setName] = useState(displayName || "");
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isLoaded && !pubkey) setLocation("/");
  }, [isLoaded, pubkey, setLocation]);

  if (!isLoaded) return null;
  if (!pubkey) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSaving || name === displayName) return;
    
    setIsSaving(true);
    await setDisplayName(name.trim());
    setIsSaving(false);
  };

  const copyPubkey = () => {
    if (!pubkey) return;
    navigator.clipboard.writeText(pubkey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-2xl animate-in fade-in duration-500">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your studio identity.</p>
        </div>

        <div className="space-y-8">
          <div className="vessel-card p-6">
            <h2 className="text-lg font-serif font-bold text-foreground mb-4">Profile</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-secondary-foreground">
                  Display Name
                </label>
                <div className="flex gap-3">
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 bg-surface border-border-strong focus-visible:ring-primary"
                    data-testid="input-settings-name"
                  />
                  <button
                    type="submit"
                    disabled={!name.trim() || isSaving || name === displayName}
                    className="vessel-btn vessel-btn-primary h-11 px-6 shrink-0"
                    data-testid="button-settings-save"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="vessel-card overflow-hidden">
            <Collapsible>
              <CollapsibleTrigger className="w-full flex items-center justify-between p-6 hover:bg-surface/50 transition-colors" data-testid="trigger-advanced">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
                    <Key className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-left">
                    <h2 className="text-lg font-serif font-bold text-foreground">Advanced</h2>
                    <p className="text-sm text-muted-foreground">Export your hidden identity</p>
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-6 pb-6 pt-2 border-t border-border mt-2">
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    Your studio identity is controlled by this secret key. Save it securely if you need to restore your account on another device.
                  </p>
                  <div className="flex gap-2">
                    <code className="flex-1 bg-surface border border-border-strong rounded-lg p-3 text-sm font-mono text-muted-foreground overflow-x-auto break-all select-all">
                      {pubkey}
                    </code>
                    <button 
                      onClick={copyPubkey}
                      className="vessel-btn vessel-btn-secondary h-auto px-4 shrink-0"
                      title="Copy identity"
                      data-testid="button-copy-identity"
                    >
                      {copied ? <Check className="w-4 h-4 text-green" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </div>
    </Layout>
  );
}
