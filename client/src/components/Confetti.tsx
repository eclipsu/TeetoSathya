import { useEffect, useRef } from 'react';

interface Piece { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string }

const DURATION_MS = 4200;

/**
 * One burst of confetti over the whole window, drawn on a canvas that ignores the pointer.
 * Remount (change `key`) to fire again. Skipped under reduced motion.
 */
export function Confetti({ colors }: { colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);

    // Two cannons from the bottom corners, aimed up and in.
    const pieces: Piece[] = [];
    for (let i = 0; i < 160; i++) {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const speed = 11 + Math.random() * 9;
      pieces.push({
        x: left ? -10 : innerWidth + 10,
        y: innerHeight * 0.85,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length]!,
      });
    }

    const start = performance.now();
    let last = start;
    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(2, (t - last) / 16.7);
      last = t;
      const fade = Math.max(0, 1 - Math.max(0, t - start - DURATION_MS + 1000) / 1000);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = fade;
      for (const p of pieces) {
        p.vy += 0.25 * dt;
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 2)); // flutter
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t - start < DURATION_MS) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}
