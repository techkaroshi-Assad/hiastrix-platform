/**
 * Hi-Astrix brand mark.
 *
 * MarkSignalArc — the platform identity:
 *   Bold diagonal arc (bottom-left → top-right) = A's spine
 *   Two inner concentric arcs from origin = H crossbar echoes
 *   Origin dot at (14,62) = H/A junction
 *   Terminal dot at (62,14) = A's peak
 *
 * Switch the whole platform identity: change ACTIVE_MARK below.
 */

"use client"

import { useId, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

type MarkProps = {
  size?: number
  className?: string
  animated?: boolean
}

/* ── Signal + Arc + H_A  (primary identity) ───────────────── */
export function MarkSignalArc({ size = 32, className, animated = true }: MarkProps) {
  const id      = useId()
  const svgRef  = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!animated) return
    const svg = svgRef.current
    if (!svg) return

    const s2  = svg.querySelector<SVGPathElement>(".ha-s2")
    const s1  = svg.querySelector<SVGPathElement>(".ha-s1")
    const arc = svg.querySelector<SVGPathElement>(".ha-arc")
    const dot = svg.querySelector<SVGCircleElement>(".ha-dot")
    if (!s2 || !s1 || !arc || !dot) return

    const els = [
      { el: s2,  len: 44, delay:   0 },
      { el: s1,  len: 24, delay: 110 },
      { el: arc, len: 76, delay: 230 },
    ]

    // Set up draw-in
    for (const { el, len } of els) {
      el.style.strokeDasharray  = String(len)
      el.style.strokeDashoffset = String(len)
    }

    // Animate origin dot pulse after draw
    dot.style.opacity = "0"

    const timers: ReturnType<typeof setTimeout>[] = []

    for (const { el, delay } of els) {
      timers.push(
        setTimeout(() => {
          el.style.transition    = "stroke-dashoffset 0.70s cubic-bezier(0.4,0,0.2,1)"
          el.style.strokeDashoffset = "0"
        }, delay)
      )
    }

    // Reveal dot after arcs finish
    timers.push(
      setTimeout(() => {
        dot.style.transition = "opacity 0.35s ease"
        dot.style.opacity    = "1"
      }, 700)
    )

    return () => timers.forEach(clearTimeout)
  }, [animated])

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 72 72"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}g`} x1="14" y1="62" x2="62" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%"  stopColor="var(--mark-hi)" />
          <stop offset="55%" stopColor="var(--mark-mid)" />
          <stop offset="100%" stopColor="var(--mark-lo)" />
        </linearGradient>
      </defs>

      {/* Outer echo arc — H crossbar far */}
      <path
        className="ha-s2"
        d="M14 33 A29 29 0 0 1 43 62"
        stroke="var(--mark-hi)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* Inner signal arc — H crossbar near */}
      <path
        className="ha-s1"
        d="M14 47 A15 15 0 0 1 29 62"
        stroke="var(--mark-hi)"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Main bold arc — A spine + H vertical */}
      <path
        className="ha-arc"
        d="M14 62 A48 48 0 0 1 62 14"
        stroke={`url(#${id}g)`}
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* Origin dot — junction of H & A */}
      <circle className="ha-dot" cx="14" cy="62" r="4.5" fill="var(--mark-mid)" />

      {/* Peak dot — A tip */}
      <circle cx="62" cy="14" r="1.8" fill="var(--mark-hi)" opacity="0.7" />
    </svg>
  )
}

/* ── Orbit mark (legacy, kept for reference) ──────────────── */
export function MarkOrbit({ size = 32, className, animated = true }: MarkProps) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mark-hi)" />
          <stop offset="1" stopColor="var(--mark-lo)" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="21" stroke={`url(#${id})`} strokeWidth="2.4" opacity="0.5" />
      <circle cx="32" cy="32" r="13" stroke={`url(#${id})`} strokeWidth="2.4" opacity="0.8" />
      <circle cx="32" cy="32" r="7"  fill={`url(#${id})`} />
      <g className={cn(animated && "animate-orbit")} style={{ transformOrigin: "32px 32px" }}>
        <circle cx="53" cy="32" r="4" fill="var(--mark-dot)" />
      </g>
      <g className={cn(animated && "animate-orbit-rev")} style={{ transformOrigin: "32px 32px" }}>
        <circle cx="45" cy="32" r="2.6" fill="var(--mark-mid)" opacity="0.85" />
      </g>
    </svg>
  )
}

/* ── Active identity ──────────────────────────────────────── *
 * One-line swap to restyle the entire platform:              *
 *   MarkSignalArc | MarkOrbit                                *
 * ─────────────────────────────────────────────────────────── */
export const BrandMark = MarkSignalArc

/* ── Logo lockup — mark + wordmark ───────────────────────── */
export function Logo({
  size = 28,
  className,
  showWordmark = true,
  animated = true,
}: MarkProps & { showWordmark?: boolean }) {
  const textPx = Math.max(13, Math.round(size * 0.52))

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <BrandMark size={size} animated={animated} />

      {showWordmark && (
        <span
          style={{ fontSize: textPx, lineHeight: 1, letterSpacing: "-0.025em" }}
          className="font-semibold"
        >
          <span style={{ color: "var(--fg-2)" }}>Hi</span>
          <span className="text-gradient-brand">-Astrix</span>
        </span>
      )}
    </span>
  )
}
