"use client"

/**
 * Canvas colour palette, read from CSS.
 *
 * A canvas draws with strings passed to `ctx.fillStyle` — CSS custom properties
 * never reach it. So the two auth canvases hardcoded roughly twenty rgba()
 * literals, all assuming a near-black backdrop. On a light page those render as
 * a violet smear on white.
 *
 * This reads the live values off :root once per theme change and hands the
 * canvas plain rgb triples it can compose alpha onto. Reading the custom
 * property directly (rather than a rendered element's computed colour) matters:
 * body has a 350ms colour transition, so sampling a painted element right after
 * a theme flip catches an intermediate value.
 */

export type CanvasPalette = {
  /** "r, g, b" — ready to interpolate an alpha onto. */
  node: string
  link: string
  spark: string
  deep: string
}

const FALLBACK: CanvasPalette = {
  node:  "167,139,250",
  link:  "196,181,253",
  spark: "196,181,253",
  deep:  "91,33,182",
}

/** "#A78BFA" | "rgba(167,139,250,0.5)" | "rgb(...)" → "167,139,250" */
function toTriple(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  }

  const fn = value.match(/^rgba?\(([^)]+)\)$/i)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
    if (parts.length === 3) return parts.join(",")
  }

  return null
}

export function readCanvasPalette(): CanvasPalette {
  if (typeof window === "undefined") return FALLBACK

  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) =>
    toTriple(style.getPropertyValue(name)) ?? fallback

  return {
    node:  pick("--mesh-node", FALLBACK.node),
    link:  pick("--mesh-link", FALLBACK.link),
    spark: pick("--mesh-spark", FALLBACK.spark),
    deep:  pick("--brand-700", FALLBACK.deep),
  }
}

/** `rgba(167,139,250,0.5)` from a triple and an alpha. */
export const rgba = (triple: string, alpha: number) => `rgba(${triple},${alpha})`
