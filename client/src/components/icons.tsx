import type { SVGProps } from 'react';

// Inline SVG icon set (stroke icons, 24px grid). All decorative: pair with visible text labels.
const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 24 24',
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const ArrowRightIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const ArrowLeftIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const UsersIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>;
export const EyeIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const WarnIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.5" /></svg>;
export const EditIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>;
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>;
export const MicIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
export const MicOffIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3" /></svg>;
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M7 4l13 8-13 8V4z" /></svg>;
export const PauseIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 5v14M16 5v14" /></svg>;
export const SwitchIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 8h14l-4-4M20 16H6l4 4" /></svg>;
export const RotateIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" /></svg>;
export const StopIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
export const BellIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0" /></svg>;
export const VolumeIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" /></svg>;
export const VolumeOffIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6" /></svg>;
export const HeadphonesIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4" height="7" rx="1.5" /><rect x="17" y="14" width="4" height="7" rx="1.5" /></svg>;
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12l5 5 9-10" /></svg>;
export const InfoIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></svg>;
export const LockIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const SpinnerIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} className={`spinner ${p.className ?? ''}`}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
export const ZapIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" /></svg>;
