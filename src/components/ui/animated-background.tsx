/**
 * Ambient animated backgrounds.
 *
 * Pure CSS — no JS animation loop, no library, no bundle cost.
 * Every variant sits behind `pointer-events-none` and is fully
 * disabled by the `prefers-reduced-motion` block in globals.css.
 *
 * Variants: silk | aurora | grid | beam | stars
 */

import { cn } from "@/lib/utils"

export type BackgroundVariant = "silk" | "aurora" | "grid" | "beam" | "stars"

/** Platform default — change here to restyle every auth screen at once. */
export const DEFAULT_BACKGROUND: BackgroundVariant = "silk"

export function AnimatedBackground({
  variant = DEFAULT_BACKGROUND,
  className,
}: {
  variant?: BackgroundVariant
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {variant === "silk" && <Silk />}
      {variant === "aurora" && <Aurora />}
      {variant === "grid" && <Grid />}
      {variant === "beam" && <Beam />}
      {variant === "stars" && <Stars />}
    </div>
  )
}

/* ── BG 05 · Silk Mesh ─────────────────────────────────────────────────── */
function Silk() {
  return (
    <>
      <div
        className="absolute -inset-1/3 animate-silk-a blur-[70px]"
        style={{
          background:
            "radial-gradient(46% 52% at 26% 32%, rgba(124,92,255,.85), transparent 68%)",
        }}
      />
      <div
        className="absolute -inset-1/3 animate-silk-b blur-[70px]"
        style={{
          background:
            "radial-gradient(44% 48% at 76% 66%, rgba(91,50,236,.62), transparent 68%)",
        }}
      />
      <div
        className="absolute -inset-1/3 animate-silk-c blur-[70px]"
        style={{
          background:
            "radial-gradient(38% 42% at 62% 18%, rgba(56,189,248,.34), transparent 68%)",
        }}
      />
      {/* Sinks the centre back down so the card always has contrast behind it */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(58% 58% at 50% 50%, rgba(7,7,10,.60), rgba(7,7,10,.20) 70%, transparent)",
        }}
      />
      <div className="grain absolute inset-0 opacity-[0.18]" />
    </>
  )
}

/* ── BG 01 · Aurora Drift ──────────────────────────────────────────────── */
function Aurora() {
  return (
    <>
      <div className="absolute -left-[8%] -top-[30%] h-[120%] w-[60%] animate-aurora-a rounded-full bg-brand-500/55 blur-[70px]" />
      <div className="absolute -bottom-[30%] -right-[6%] h-[110%] w-[55%] animate-aurora-b rounded-full bg-sky-400/30 blur-[70px]" />
      <div className="grain absolute inset-0 opacity-[0.12]" />
    </>
  )
}

/* ── BG 02 · Grid + Travelling Glow ────────────────────────────────────── */
function Grid() {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 70% at 50% 45%, #000 25%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(70% 70% at 50% 45%, #000 25%, transparent 78%)",
        }}
      />
      <div
        className="absolute h-[340px] w-[340px] animate-glow-path rounded-full blur-[70px]"
        style={{
          background: "radial-gradient(circle, rgba(124,92,255,.70), transparent 68%)",
        }}
      />
    </>
  )
}

/* ── BG 03 · Beam Sweep ────────────────────────────────────────────────── */
function Beam() {
  return (
    <>
      {/* Apex is parked off-canvas at the top-right so only the fan of light
          crosses the panel — a visible convergence point looks like a bug. */}
      <div
        className="absolute left-full top-0 h-[240%] w-[240%] -translate-x-1/2 -translate-y-1/2 animate-slow-spin"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(124,92,255,.50) 26deg, transparent 70deg, transparent 176deg, rgba(167,139,250,.30) 210deg, transparent 262deg)",
        }}
      />
      {/* Feathers the apex itself */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(24% 34% at 100% 0%, rgba(7,7,10,.95), rgba(7,7,10,.45) 55%, transparent 80%)",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 80% at 40% 60%, transparent, rgba(7,7,10,.70) 92%)",
        }}
      />
      <div className="grain absolute inset-0 opacity-[0.14]" />
    </>
  )
}

/* ── BG 04 · Starfield ─────────────────────────────────────────────────── */
function Stars() {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(80% 70% at 50% 15%, #141420, #07070A 75%)" }}
      />
      <div
        className="absolute inset-0 animate-star-rise"
        style={{
          backgroundImage: [
            "radial-gradient(1.4px 1.4px at 20px 30px, rgba(255,255,255,.85), transparent)",
            "radial-gradient(1.2px 1.2px at 130px 80px, rgba(255,255,255,.60), transparent)",
            "radial-gradient(1.6px 1.6px at 220px 40px, rgba(167,139,250,.90), transparent)",
            "radial-gradient(1.1px 1.1px at 300px 120px, rgba(255,255,255,.50), transparent)",
          ].join(","),
          backgroundSize: "360px 200px",
        }}
      />
      <div
        className="absolute inset-0 animate-star-rise-slow opacity-70"
        style={{
          backgroundImage: [
            "radial-gradient(1px 1px at 60px 90px, rgba(255,255,255,.50), transparent)",
            "radial-gradient(1.3px 1.3px at 190px 20px, rgba(124,92,255,.80), transparent)",
            "radial-gradient(1px 1px at 260px 160px, rgba(255,255,255,.40), transparent)",
          ].join(","),
          backgroundSize: "300px 220px",
        }}
      />
      <div
        className="absolute inset-0 animate-silk-a blur-[30px]"
        style={{
          background:
            "radial-gradient(45% 40% at 30% 70%, rgba(124,92,255,.25), transparent 70%)",
        }}
      />
    </>
  )
}
