import { useState } from "react";
import { useLocation } from "wouter";
import { Download, LogOut, User } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import {
  downloadBackupFile,
  exportIdentityBackup,
} from "../../lib/identity";
import { AvatarMark } from "../AvatarMark";
import { useToast } from "../../hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export type AccountMenuProps = {
  variant?: "header" | "sidebar";
};

export function AccountMenu({ variant = "header" }: AccountMenuProps) {
  const [, setLocation] = useLocation();
  const { identity, displayName, pubkey, signerType, signOut } = useIdentity();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [savingBackup, setSavingBackup] = useState(false);
  const [backupSaved, setBackupSaved] = useState(false);
  const { toast } = useToast();

  if (!displayName || !pubkey) return null;

  const canDownloadBackup = signerType === "local" && !!identity;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setLocation("/");
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
      setBackupSaved(false);
    }
  };

  const handleSaveBackup = () => {
    if (!identity || !canDownloadBackup) return;
    setSavingBackup(true);
    try {
      const backupKey = exportIdentityBackup(identity);
      const filename = downloadBackupFile(identity, backupKey);
      setBackupSaved(true);
      toast({ title: "Backup saved", description: `Saved as ${filename}.` });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't save your backup key.";
      toast({
        title: "Couldn't save backup",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSavingBackup(false);
    }
  };

  const dialog = (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(o) => {
        if (!signingOut) {
          setConfirmOpen(o);
          if (!o) setBackupSaved(false);
        }
      }}
    >
      <AlertDialogContent data-testid="dialog-sign-out">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of Vessel?</AlertDialogTitle>
          <AlertDialogDescription>
            You'll be sent back to the welcome screen. Your local recordings stay
            on this device — they're not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {canDownloadBackup && (
          <button
            type="button"
            onClick={handleSaveBackup}
            disabled={savingBackup || signingOut}
            className="group -mx-1 mt-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg border border-vessel-border/60 bg-vessel-bg-base/40 px-3 py-2.5 text-left text-sm text-vessel-text-secondary transition-colors hover:border-vessel-accent/40 hover:bg-vessel-accent/5 hover:text-vessel-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-sign-out-save-backup"
          >
            <Download
              className={`w-4 h-4 shrink-0 transition-colors ${
                backupSaved
                  ? "text-vessel-green"
                  : "text-vessel-text-muted group-hover:text-vessel-accent"
              }`}
            />
            <span className="flex-1">
              {savingBackup
                ? "Saving backup key…"
                : backupSaved
                  ? "Backup key saved to your downloads."
                  : "Save a copy of your backup key first"}
            </span>
            {!savingBackup && !backupSaved && (
              <span className="text-[11px] uppercase tracking-wider text-vessel-text-muted/80 group-hover:text-vessel-accent/80">
                Optional
              </span>
            )}
          </button>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={signingOut} data-testid="button-sign-out-cancel">
            Stay signed in
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSignOut}
            disabled={signingOut}
            data-testid="button-sign-out-confirm"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === "sidebar") {
    return (
      <>
        <div className="w-full flex items-center gap-1 rounded-lg border border-transparent hover:bg-vessel-bg-surface/50 transition-colors group">
          <button
            onClick={() => setLocation("/settings")}
            className="flex-1 min-w-0 flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg text-sm font-medium text-vessel-text-secondary group-hover:text-vessel-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent/40 transition-colors"
            data-testid="button-account-settings-sidebar"
            aria-label={`Open account settings for ${displayName}`}
          >
            <AvatarMark
              pubkey={pubkey}
              displayName={displayName}
              className="w-7 h-7"
              initialsClassName="text-[10px]"
            />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-vessel-text-primary truncate">{displayName}</div>
              <div className="text-xs text-vessel-text-muted">Account settings</div>
            </div>
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 p-2 mr-1 rounded-md text-vessel-text-muted hover:text-vessel-text-primary hover:bg-vessel-bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent/40 transition-colors"
            data-testid="button-sign-out-sidebar"
            aria-label={`Sign out ${displayName}`}
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full p-1 hover:bg-vessel-bg-surface/50 transition-colors focus:outline-none focus:ring-2 focus:ring-vessel-accent/40"
            data-testid="button-account-menu"
            aria-label="Account menu"
          >
            <AvatarMark
              pubkey={pubkey}
              displayName={displayName}
              className="w-8 h-8"
              initialsClassName="text-xs"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" data-testid="menu-account">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="text-sm font-semibold truncate">{displayName}</span>
              <span className="text-xs text-muted-foreground">Signed in</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setLocation("/settings");
            }}
            data-testid="menu-item-settings"
          >
            <User className="w-4 h-4 mr-2" />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
            data-testid="menu-item-sign-out"
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}
