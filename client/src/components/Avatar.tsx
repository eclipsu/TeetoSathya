import { useMemo } from 'react';
import { usernameKey } from '@teeto/shared';
import { hashString } from '../lib/hash';
import './avatar.css';

/** Muted solid avatar colors. White initials pass AA on all of them. */
const COLORS = ['#4f6d8f', '#6b8f71', '#8f6b6b', '#8f7f4f', '#6b6b8f', '#4f8f8a', '#8f4f6d', '#7a7a7a'];

export interface AvatarLook {
  color: string;
  initials: string;
}

export function initialsOf(name: string): string {
  // Prefer words containing letters, so "Sita_42" gives "SI" rather than "S4".
  const all = name.trim().split(/[\s_-]+/).filter(Boolean);
  const lettered = all.filter((w) => /[a-z]/i.test(w));
  const words = lettered.length ? lettered : all;
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? '?';
  return (w.length > 1 ? w[0]! + w[1]! : w[0]!).toUpperCase();
}

/** Same name (case/spacing-insensitive) always gives the same look. */
export function avatarLook(name: string): AvatarLook {
  const seed = hashString(usernameKey(name) || '?');
  return { color: COLORS[seed % COLORS.length]!, initials: initialsOf(name) };
}

export interface AvatarProps {
  name: string;
  size?: number;
  /** Turns on the 2px speaking ring. Ring opacity follows the inherited CSS var --level (0-1). */
  speaking?: boolean;
  className?: string;
}

export function Avatar({ name, size = 40, speaking = false, className = '' }: AvatarProps) {
  const look = useMemo(() => avatarLook(name), [name]);
  return (
    <span
      className={`avatar ${speaking ? 'avatar--speaking' : ''} ${className}`}
      style={{ width: size, height: size, background: look.color, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {look.initials}
    </span>
  );
}
