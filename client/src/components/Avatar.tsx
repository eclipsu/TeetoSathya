import { useId, useMemo } from "react";
import { usernameKey } from "@teeto/shared";
import { hashString, seededRandom } from "../lib/hash";
import "./avatar.css";

export interface AvatarLook {
  hueA: number;
  hueB: number;
  angle: number;
  pattern: "orbs" | "shards" | "rings" | "stripes";
  initials: string;
  /** Solid accent color derived from the avatar, used for the buzz flash. */
  accent: string;
  rand: number[];
}

const PATTERNS: AvatarLook["pattern"][] = [
  "orbs",
  "shards",
  "rings",
  "stripes",
];

export function initialsOf(name: string): string {
  // Prefer words containing letters, so "Sita_42" gives "SI" rather than "S4".
  const all = name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  const lettered = all.filter((w) => /[a-z]/i.test(w));
  const words = lettered.length ? lettered : all;
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? "?";
  return (w.length > 1 ? w[0]! + w[1]! : w[0]!).toUpperCase();
}

/** Same name (case/spacing-insensitive) always gives the same look. */
export function avatarLook(name: string): AvatarLook {
  const seed = hashString(usernameKey(name) || "?");
  const rnd = seededRandom(seed);
  const hueA = Math.floor(rnd() * 360);
  const hueB = (hueA + 40 + Math.floor(rnd() * 140)) % 360;
  return {
    hueA,
    hueB,
    angle: Math.floor(rnd() * 360),
    pattern: PATTERNS[Math.floor(rnd() * PATTERNS.length)]!,
    initials: initialsOf(name),
    accent: `hsl(${hueA} 85% 62%)`,
    rand: Array.from({ length: 12 }, rnd),
  };
}

function Pattern({ look }: { look: AvatarLook }) {
  const r = look.rand;
  switch (look.pattern) {
    case "orbs":
      return (
        <g fill="#fff">
          <circle
            cx={15 + r[0]! * 30}
            cy={10 + r[1]! * 30}
            r={14 + r[2]! * 14}
            opacity={0.16}
          />
          <circle
            cx={60 + r[3]! * 30}
            cy={55 + r[4]! * 30}
            r={18 + r[5]! * 16}
            opacity={0.12}
          />
          <circle
            cx={70 + r[6]! * 20}
            cy={10 + r[7]! * 20}
            r={6 + r[8]! * 8}
            opacity={0.22}
          />
        </g>
      );
    case "shards":
      return (
        <g fill="#fff">
          <polygon
            points={`0,${60 + r[0]! * 30} ${40 + r[1]! * 30},100 0,100`}
            opacity={0.14}
          />
          <polygon
            points={`100,${r[2]! * 30} ${55 + r[3]! * 30},0 100,0`}
            opacity={0.18}
          />
          <polygon
            points={`${30 + r[4]! * 40},${r[5]! * 20} 100,${50 + r[6]! * 30} ${70 + r[7]! * 20},${40 + r[8]! * 10}`}
            opacity={0.09}
          />
        </g>
      );
    case "rings": {
      const cx = 20 + r[0]! * 60;
      const cy = 20 + r[1]! * 60;
      return (
        <g fill="none" stroke="#fff" strokeWidth={5}>
          <circle cx={cx} cy={cy} r={18} opacity={0.18} />
          <circle cx={cx} cy={cy} r={34} opacity={0.12} />
          <circle cx={cx} cy={cy} r={50} opacity={0.07} />
        </g>
      );
    }
    case "stripes": {
      const rot = Math.floor(r[0]! * 180);
      return (
        <g fill="#fff" transform={`rotate(${rot} 50 50)`}>
          <rect
            x={-20}
            y={14}
            width={140}
            height={10 + r[1]! * 6}
            opacity={0.12}
          />
          <rect
            x={-20}
            y={44}
            width={140}
            height={6 + r[2]! * 6}
            opacity={0.18}
          />
          <rect
            x={-20}
            y={70}
            width={140}
            height={12 + r[3]! * 8}
            opacity={0.09}
          />
        </g>
      );
    }
  }
}

export interface AvatarProps {
  name: string;
  size?: number;
  /** Turns on the speaking ring. Glow intensity follows the inherited CSS var --level (0-1). */
  speaking?: boolean;
  className?: string;
}

export function Avatar({
  name,
  size = 40,
  speaking = false,
  className = "",
}: AvatarProps) {
  const look = useMemo(() => avatarLook(name), [name]);
  const id = useId().replace(/:/g, "");
  return (
    <span
      className={`avatar ${speaking ? "avatar--speaking" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        ["--avatar-accent" as string]: look.accent,
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient
            id={`g${id}`}
            gradientTransform={`rotate(${look.angle} .5 .5)`}
          >
            <stop offset="0%" stopColor={`hsl(${look.hueA} 80% 58%)`} />
            <stop offset="100%" stopColor={`hsl(${look.hueB} 75% 42%)`} />
          </linearGradient>
          <clipPath id={`c${id}`}>
            <circle cx="50" cy="50" r="50" />
          </clipPath>
        </defs>
        <g clipPath={`url(#c${id})`}>
          <rect width="100" height="100" fill={`url(#g${id})`} />
          <Pattern look={look} />
        </g>
        <text
          x="50"
          y="50"
          dy="0.35em"
          textAnchor="middle"
          fontSize={look.initials.length > 1 ? 38 : 46}
          fontWeight={800}
          fill="#fff"
          style={{
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.02em",
          }}
          paintOrder="stroke"
          stroke="rgba(0,0,0,.18)"
          strokeWidth={3}
        >
          {look.initials}
        </text>
      </svg>
    </span>
  );
}
