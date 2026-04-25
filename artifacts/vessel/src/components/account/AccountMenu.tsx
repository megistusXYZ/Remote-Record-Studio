import { useState } from "react";
import { useLocation } from "wouter";
import { LogOut, User } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { getInitials } from "../../lib/identity";
import { useAvatarColor } from "../../hooks/use-avatar-color";
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
  const { displayName, pubkey, signOut } = useIdentity();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const avatarColor = useAvatarColor(pubkey);

  if (!displayName || !pubkey) return null;

  const initials = getInitials(displayName);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setLocation("/");
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
    }
  };

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
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: avatarColor }}
            >
              <span className="text-white text-[10px] font-bold">{initials}</span>
            </div>
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
        {renderDialog(confirmOpen, setConfirmOpen, handleSignOut, signingOut)}
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
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: avatarColor }}
            >
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
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
      {renderDialog(confirmOpen, setConfirmOpen, handleSignOut, signingOut)}
    </>
  );
}

function renderDialog(
  open: boolean,
  setOpen: (v: boolean) => void,
  onConfirm: () => void,
  busy: boolean,
) {
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent data-testid="dialog-sign-out">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of Vessel?</AlertDialogTitle>
          <AlertDialogDescription>
            You'll be sent back to the welcome screen. Your local recordings stay
            on this device — they're not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} data-testid="button-sign-out-cancel">
            Stay signed in
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={busy}
            data-testid="button-sign-out-confirm"
          >
            {busy ? "Signing out…" : "Sign out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
