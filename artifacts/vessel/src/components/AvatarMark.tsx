import * as React from "react";
import { useIdentity } from "../hooks/use-identity";
import {
  resolveAvatarColor,
  useStoredAvatarColor,
} from "../hooks/use-avatar-color";
import {
  resolveAvatarIcon,
  useStoredAvatarIcon,
} from "../hooks/use-avatar-icon";
import {
  DEFAULT_AVATAR_ICON_COLOR,
  resolveAvatarIconColor,
  useStoredAvatarIconColor,
} from "../hooks/use-avatar-icon-color";
import { getInitials } from "../lib/identity";
import { getAvatarMark, type AvatarMarkId } from "./icons/avatar-marks";
import { cn } from "../lib/utils";

export type AvatarMarkProps = {
  /** Public identity of the participant whose avatar this is. */
  pubkey: string | null | undefined;
  /** Display name — used for the initials fallback and the alt text. */
  displayName: string;
  /** Tailwind size classes (width + height). Defaults to `w-9 h-9`. */
  className?: string;
  /** Tailwind classes for the initials text. The default scales sensibly
   *  for the default `w-9 h-9` size; pass a tighter/looser size when the
   *  caller uses a different avatar size. */
  initialsClassName?: string;
  /** Force a single character of the initials (the vault list uses this
   *  for tiny chips). Defaults to the first one or two characters. */
  initialsSingleChar?: boolean;
  /** Optional override of the chosen icon. Mostly used for previews
   *  inside the picker UI, where we want to show a candidate icon
   *  before it's been persisted. */
  iconOverride?: AvatarMarkId | null;
  /** Optional override of the resolved color. Same picker-preview use. */
  colorOverride?: string | null;
  /** Optional override of the foreground (mark / initials) color.
   *  Same picker-preview use as `colorOverride`. */
  iconColorOverride?: string | null;
  /** Optional children (e.g. status chips like the raised-hand badge)
   *  rendered absolutely-positioned over the avatar — preserves the
   *  composition pattern used by the live roster today. */
  children?: React.ReactNode;
  /** data-testid for the wrapper div. */
  "data-testid"?: string;
  /** Optional title attribute. */
  title?: string;
};

/**
 * Single source of truth for "colored circle with initials *or* a
 * hand-drawn icon". Replaces the inline pattern repeated across the
 * roster, video tile, account menu, lobby card, saving overlay,
 * post-session screen, vault list, share modal, and recipient page.
 *
 * The icon is treated as a strictly local preference — only the
 * signed-in user sees their own chosen icon. Other participants render
 * with their deterministic color + initials. This mirrors the existing
 * behavior of `useStoredAvatarColor` and avoids needing to broadcast
 * the icon over the call signaling channel.
 */
export function AvatarMark({
  pubkey,
  displayName,
  className,
  initialsClassName,
  initialsSingleChar,
  iconOverride,
  colorOverride,
  iconColorOverride,
  children,
  title,
  ...rest
}: AvatarMarkProps) {
  const { pubkey: selfPubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();
  const storedIcon = useStoredAvatarIcon();
  const storedIconColor = useStoredAvatarIconColor();

  const color =
    colorOverride !== undefined && colorOverride !== null
      ? colorOverride
      : resolveAvatarColor(pubkey, selfPubkey, storedColor);
  const iconId =
    iconOverride !== undefined
      ? iconOverride
      : resolveAvatarIcon(pubkey, selfPubkey, storedIcon);
  const iconColor =
    iconColorOverride !== undefined && iconColorOverride !== null
      ? iconColorOverride
      : resolveAvatarIconColor(pubkey, selfPubkey, storedIconColor);
  const mark = getAvatarMark(iconId);
  // Inline style only when the user has actually chosen something
  // other than the default — keeps the rendered DOM clean for the
  // 99% of avatars that use the white fallback.
  const foregroundStyle =
    iconColor !== DEFAULT_AVATAR_ICON_COLOR ? { color: iconColor } : undefined;

  const initials = initialsSingleChar
    ? getInitials(displayName).slice(0, 1)
    : getInitials(displayName);

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 relative",
        // Default size matches the most common usage in the roster.
        // Callers pass their own size class to override.
        !className?.match(/\bw-/) && "w-9 h-9",
        className,
      )}
      style={{ backgroundColor: color }}
      title={title ?? displayName}
      data-testid={rest["data-testid"]}
    >
      {mark ? (
        <mark.Component
          className={cn(
            "text-white",
            // Inset slightly so the stroke doesn't crowd the circle edge.
            // 75% works at every size we use (16px → 96px).
            "w-3/4 h-3/4",
          )}
          style={foregroundStyle}
        />
      ) : (
        <span
          className={cn(
            "text-white font-bold leading-none select-none",
            initialsClassName ?? "text-xs",
          )}
          style={foregroundStyle}
        >
          {initials}
        </span>
      )}
      {children}
    </div>
  );
}
