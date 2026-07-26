/**
 * Canvas background animations for auth pages.
 *
 * NeuralMeshCanvas  — bouncing nodes + weighted connections, mouse-reactive.
 *                     Used on: sign-in right panel, forgot-password, update-password.
 *
 * MagneticFieldCanvas — three-pole field with streaming field lines.
 *                        Used on: split layout left (marketing) panel.
 *
 * Both are client components. ResizeObserver handles canvas sizing.
 * Canvas tracks mouse for subtle interactive response.
 */

"use client"

import { useEffect, useRef } from "react"
import { useTheme } from "@/components/theme/theme-provider"
import { readCanvasPalette, rgba } from "@/lib/canvas-palette"

/* ── Neural Mesh ──────────────────────────────────────────── */

export function NeuralMeshCanvas({ className }: { className?: string }) {
  const { resolved } = useTheme()
  const cvs   = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    const P = readCanvasPalette()
    const canvas = cvs.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    let raf: number

    const N      = 56
    const THRESH = 148
    const PUSH   = 85

    type Pt = { x: number; y: number; vx: number; vy: number; phase: number }
    let pts: Pt[] = []
    let W = 0, H = 0

    function resize() {
      if (!canvas) return
      const r = window.devicePixelRatio || 1
      W = canvas.offsetWidth
      H = canvas.offsetHeight
      canvas.width  = W * r
      canvas.height = H * r
      ctx.setTransform(r, 0, 0, r, 0, 0)
    }

    function init() {
      resize()
      pts = Array.from({ length: N }, () => ({
        x:     Math.random() * W,
        y:     Math.random() * H,
        vx:    (Math.random() - 0.5) * 0.62,
        vy:    (Math.random() - 0.5) * 0.62,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    init()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onLeave = () => { mouse.current = { x: -9999, y: -9999 } }
    canvas.addEventListener("mousemove", onMove)
    canvas.addEventListener("mouseleave", onLeave)

    let t = 0

    function draw() {
      t += 0.008
      ctx.clearRect(0, 0, W, H)

      const mx = mouse.current.x
      const my = mouse.current.y

      // Update positions
      for (const p of pts) {
        // Mouse repulsion
        const dx = p.x - mx, dy = p.y - my
        const d  = Math.sqrt(dx * dx + dy * dy)
        if (d < PUSH && d > 1) {
          const f = ((PUSH - d) / PUSH) * 0.38
          p.vx += (dx / d) * f
          p.vy += (dy / d) * f
        }
        // Speed cap
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
        if (spd > 1.4) { p.vx = (p.vx / spd) * 1.4; p.vy = (p.vy / spd) * 1.4 }

        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > W) p.vx *= -1
        if (p.y < 0 || p.y > H) p.vy *= -1
      }

      // Draw connections
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = pts[i].x - pts[j].x
          const dy = pts[i].y - pts[j].y
          const d  = Math.sqrt(dx * dx + dy * dy)
          if (d >= THRESH) continue

          // Boost near mouse
          const mi = Math.min(
            Math.hypot(pts[i].x - mx, pts[i].y - my),
            Math.hypot(pts[j].x - mx, pts[j].y - my)
          )
          const boost = mi < 110 ? 1 + (1 - mi / 110) * 2.2 : 1
          const a     = (1 - d / THRESH) * 0.26 * boost

          const g = ctx.createLinearGradient(pts[i].x, pts[i].y, pts[j].x, pts[j].y)
          g.addColorStop(0, rgba(P.node, a))
          g.addColorStop(1, rgba(P.node, a * 0.7))

          ctx.beginPath()
          ctx.moveTo(pts[i].x, pts[i].y)
          ctx.lineTo(pts[j].x, pts[j].y)
          ctx.strokeStyle = g
          ctx.lineWidth   = 0.82
          ctx.stroke()
        }
      }

      // Draw nodes
      for (const p of pts) {
        const twinkle = 0.5 + 0.5 * Math.sin(t * 2.6 + p.phase)
        const md      = Math.hypot(p.x - mx, p.y - my)
        const mb      = md < 100 ? 1 + (1 - md / 100) * 1.6 : 1
        const r       = (1.6 + twinkle * 1.2) * mb

        // Halo
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.2)
        g.addColorStop(0, rgba(P.node, 0.18 * twinkle * mb))
        g.addColorStop(1, rgba(P.node, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 4.2, 0, Math.PI * 2)
        ctx.fill()

        // Core dot
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = rgba(P.node, 0.55 + 0.38 * twinkle)
        ctx.fill()
      }

      // Mouse cursor glow
      if (mx > 0 && mx < W && my > 0 && my < H) {
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 60)
        g.addColorStop(0, rgba(P.node, 0.10))
        g.addColorStop(1, rgba(P.node, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(mx, my, 60, 0, Math.PI * 2)
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener("mousemove", onMove)
      canvas.removeEventListener("mouseleave", onLeave)
    }
    // `resolved` in deps: the canvas must repaint when the theme flips,
    // since these colours were sampled from CSS at setup time.
  }, [resolved])

  return (
    <canvas
      ref={cvs}
      className={className ?? "absolute inset-0 h-full w-full"}
      aria-hidden="true"
    />
  )
}

/* ── Magnetic Field ───────────────────────────────────────── */

export function MagneticFieldCanvas({ className }: { className?: string }) {
  const { resolved } = useTheme()
  const cvs   = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -9999, y: -9999, active: false })

  useEffect(() => {
    const P = readCanvasPalette()
    const canvas = cvs.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    let raf: number
    let W = 0, H = 0

    type Pole = { bx: number; by: number; t0: number; spd: number; q: 1 | -1 }

    const poles: Pole[] = [
      { bx: 0.22, by: 0.30, t0: 0,   spd: 0.15, q:  1 },
      { bx: 0.76, by: 0.62, t0: 1.1, spd: 0.11, q:  1 },
      { bx: 0.50, by: 0.82, t0: 2.3, spd: 0.19, q: -1 },
    ]

    const LINES = 22
    const STEPS = 145
    const STEP  = 3.6

    function resize() {
      if (!canvas) return
      const r = window.devicePixelRatio || 1
      W = canvas.offsetWidth
      H = canvas.offsetHeight
      canvas.width  = W * r
      canvas.height = H * r
      ctx.setTransform(r, 0, 0, r, 0, 0)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, active: true }
    }
    const onLeave = () => { mouse.current = { x: -9999, y: -9999, active: false } }
    canvas.addEventListener("mousemove", onMove)
    canvas.addEventListener("mouseleave", onLeave)

    function polePos(p: Pole, t: number) {
      return {
        x: (p.bx + 0.09 * Math.sin(t * p.spd + p.t0)) * W,
        y: (p.by + 0.07 * Math.cos(t * p.spd * 1.35 + p.t0)) * H,
      }
    }

    function fieldAt(
      px: number, py: number,
      pos: Array<{ x: number; y: number }>,
      mx: number, my: number, mActive: boolean
    ) {
      let fx = 0, fy = 0
      for (let i = 0; i < poles.length; i++) {
        const dx = px - pos[i].x, dy = py - pos[i].y
        const d2 = dx * dx + dy * dy + 280
        const d  = Math.sqrt(d2)
        const s  = poles[i].q * 2600 / d2
        fx += s * dx / d
        fy += s * dy / d
      }
      // Mouse as weak positive pole
      if (mActive) {
        const dx = px - mx, dy = py - my
        const d2 = dx * dx + dy * dy + 280
        const d  = Math.sqrt(d2)
        const s  = 950 / d2
        fx += s * dx / d
        fy += s * dy / d
      }
      return { fx, fy }
    }

    let t = 0

    function draw() {
      t += 0.011
      ctx.clearRect(0, 0, W, H)

      const pos    = poles.map(p => polePos(p, t))
      const { x: mx, y: my, active: mActive } = mouse.current

      // Field lines from positive poles
      for (let pi = 0; pi < poles.length; pi++) {
        if (poles[pi].q < 0) continue
        const { x: sx, y: sy } = pos[pi]

        for (let li = 0; li < LINES; li++) {
          const ang = (li / LINES) * Math.PI * 2
          let cx = sx + Math.cos(ang) * 9
          let cy = sy + Math.sin(ang) * 9

          const path: Array<[number, number]> = [[cx, cy]]

          for (let s = 0; s < STEPS; s++) {
            const { fx, fy } = fieldAt(cx, cy, pos, mx, my, mActive)
            const len = Math.sqrt(fx * fx + fy * fy)
            if (len < 1e-5) break
            cx += (fx / len) * STEP
            cy += (fy / len) * STEP
            if (cx < -20 || cx > W + 20 || cy < -20 || cy > H + 20) break
            path.push([cx, cy])
          }

          if (path.length < 4) continue

          const g = ctx.createLinearGradient(
            path[0][0], path[0][1],
            path[path.length - 1][0], path[path.length - 1][1]
          )
          g.addColorStop(0,   rgba(P.node, 0.50))
          g.addColorStop(0.45,rgba(P.node, 0.28))
          g.addColorStop(1,   rgba(P.deep, 0.04))

          ctx.beginPath()
          ctx.moveTo(path[0][0], path[0][1])
          for (let k = 1; k < path.length; k++) ctx.lineTo(path[k][0], path[k][1])
          ctx.strokeStyle = g
          ctx.lineWidth   = 0.88
          ctx.stroke()
        }
      }

      // Mouse lines when active
      if (mActive && mx > 0 && mx < W) {
        for (let li = 0; li < 10; li++) {
          const ang = (li / 10) * Math.PI * 2
          let cx = mx + Math.cos(ang) * 7
          let cy = my + Math.sin(ang) * 7
          const path: Array<[number,number]> = [[cx, cy]]
          for (let s = 0; s < 65; s++) {
            const { fx, fy } = fieldAt(cx, cy, pos, mx, my, mActive)
            const len = Math.sqrt(fx * fx + fy * fy)
            if (len < 1e-5) break
            cx += (fx / len) * STEP
            cy += (fy / len) * STEP
            if (cx < -20 || cx > W+20 || cy < -20 || cy > H+20) break
            path.push([cx, cy])
          }
          if (path.length < 3) continue
          ctx.beginPath()
          ctx.moveTo(path[0][0], path[0][1])
          for (let k = 1; k < path.length; k++) ctx.lineTo(path[k][0], path[k][1])
          ctx.strokeStyle = rgba(P.link, 0.38)
          ctx.lineWidth   = 0.7
          ctx.stroke()
        }
      }

      // Pole glows
      for (let i = 0; i < poles.length; i++) {
        const { x, y } = pos[i]
        const isPos = poles[i].q > 0
        const r = isPos ? 34 : 22

        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        if (isPos) {
          g.addColorStop(0,   rgba(P.node, 0.62))
          g.addColorStop(0.42,rgba(P.node, 0.30))
          g.addColorStop(1,   rgba(P.deep, 0))
        } else {
          g.addColorStop(0, rgba(P.link, 0.42))
          g.addColorStop(1, rgba(P.node, 0))
        }
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()

        // Ring for positive pole
        if (isPos) {
          ctx.beginPath()
          ctx.arc(x, y, r * 0.52, 0, Math.PI * 2)
          ctx.strokeStyle = rgba(P.node, 0.22)
          ctx.lineWidth   = 1
          ctx.stroke()
        }

        // Core dot
        ctx.beginPath()
        ctx.arc(x, y, isPos ? 5 : 3.5, 0, Math.PI * 2)
        ctx.fillStyle = isPos ? rgba(P.node, 1) : rgba(P.link, 1)
        ctx.fill()
      }

      // Mouse cursor indicator
      if (mActive && mx > 0 && mx < W && my > 0 && my < H) {
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 22)
        g.addColorStop(0, rgba(P.link, 0.38))
        g.addColorStop(1, rgba(P.node, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(mx, my, 22, 0, Math.PI * 2)
        ctx.fill()

        ctx.beginPath()
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = rgba(P.spark, 0.85)
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener("mousemove", onMove)
      canvas.removeEventListener("mouseleave", onLeave)
    }
    // `resolved` in deps: the canvas must repaint when the theme flips,
    // since these colours were sampled from CSS at setup time.
  }, [resolved])

  return (
    <canvas
      ref={cvs}
      className={className ?? "absolute inset-0 h-full w-full"}
      aria-hidden="true"
    />
  )
}
