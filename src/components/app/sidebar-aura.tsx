/**
 * The sidebar's living background.
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────
 *
 * The sign-in page has a neural-mesh canvas: fifty-six nodes bouncing around,
 * a distance check between every pair on every frame, links drawn wherever two
 * happen to be close, and a `requestAnimationFrame` loop that never stops. It
 * looks superb and it is the right thing there — somebody looks at that page
 * for nine seconds and then leaves.
 *
 * A sidebar is not that. It is open for eight hours next to somebody's inbox,
 * on a laptop, on battery. A loop computing 1,540 pairwise distances sixty
 * times a second in that context is a fan spinning up, and I have already made
 * the argument in `shell.tsx` for not doing it.
 *
 * So this is the same *idea* with the arithmetic removed. The constellation is
 * a fixed SVG — the node positions were chosen by hand, once — and nothing is
 * computed at runtime. What moves is opacity and a couple of `translate3d`s,
 * which the compositor animates on its own thread without ever waking the main
 * one. It is, as far as the CPU is concerned, a still image.
 *
 * ── WHY IT READS AS ALIVE ANYWAY ──────────────────────────────────────
 *
 * Three things, and the third is the one that matters.
 *
 * 1. Two groups drift in different directions on different periods, so the
 *    links between them appear to change length.
 * 2. The whole mesh breathes in opacity, so it surfaces and recedes.
 * 3. **The durations do not divide into one another.** 19s, 23s, 31s, 17s,
 *    38s. Anything on 10s / 20s / 30s resynchronises constantly, and a
 *    background with a detectable period stops being a background and starts
 *    being a metronome you cannot unsee.
 *
 * ── THE MASK, WHICH IS THE WHOLE DESIGN ───────────────────────────────
 *
 * The first version had no mask, and rendering it showed the problem
 * immediately: the links ran straight through "Analytics" and "Phone numbers".
 * A diagram behind a text label is not atmosphere, it is a legibility bug — the
 * same mistake as the grain overlay that had to be taken out of `shell.tsx`,
 * arriving by a different route.
 *
 * So the mesh is masked vertically. It is faint behind the logo, **gone**
 * across the whole navigation band, and strongest in the empty region below
 * the last nav item, which on any real viewport is half the rail and has
 * nothing in it. The constellation is unmistakably present and never crosses a
 * word.
 *
 * The gradient stops are proportions of the rail rather than pixels, so they
 * hold at any viewport height. Nine nav items at ~44px occupy roughly the top
 * 16–60% of a rail; the transparent band covers that with room either side.
 *
 * The band stops at 86% rather than running to the bottom, and that number was
 * arrived at by rendering it. An earlier version faded out at 100%, which put
 * full-strength links straight through the email address and the sign-out
 * button on a 860px viewport — the same defect at the other end of the rail.
 * Checked at 760px, 900px and 1180px; the mesh sits in the genuinely empty
 * middle-lower region at all three.
 *
 * ── SUBTLETY ──────────────────────────────────────────────────────────
 *
 * If it is ever legible as "there is a diagram behind my navigation", it is too
 * strong. It is texture, not content — hence `aria-hidden` and no pointer
 * events.
 *
 * `prefers-reduced-motion` is handled globally in `globals.css`, which clamps
 * every animation to a single 0.01ms iteration. The mesh remains, and stops.
 */

/**
 * Faint at the top, absent across the nav, present below it.
 *
 * Written once and applied with both the standard and the `-webkit-` property,
 * because Safari still needs the prefixed one and a mask that silently does
 * not apply is a mesh drawn straight across the navigation.
 */
const NAV_SAFE_MASK =
  "linear-gradient(to bottom," +
  " rgba(0,0,0,0.5) 0%," +    // behind the logo: a hint
  " transparent 16%," +       // navigation begins
  " transparent 60%," +       // navigation ends
  " black 72%," +             // the empty rail: full strength
  " black 78%," +
  " transparent 86%)"         // and out before the theme toggle and email

/**
 * Node positions in a 248 × 900 box — the sidebar's own dimensions.
 *
 * Split into two groups that drift independently. The links list is explicit
 * rather than "join anything within N pixels", because a distance rule at this
 * node count produces either a spiderweb or almost nothing, and choosing the
 * dozen edges that look right takes less code than tuning a threshold.
 */
const GROUP_A = [
  [ 42,  70], [128,  38], [196, 104], [ 74, 158], [166, 210],
  [ 30, 250], [116, 296], [210, 268],
] as const

const GROUP_B = [
  [ 60, 380], [150, 424], [ 34, 486], [124, 548], [206, 500],
  [ 78, 622], [178, 664], [ 46, 726], [140, 790], [212, 846],
] as const

const LINKS_A: [number, number][] = [
  [0, 1], [1, 2], [0, 3], [3, 4], [2, 4], [3, 5], [5, 6], [6, 7], [4, 7],
]

const LINKS_B: [number, number][] = [
  [0, 1], [1, 4], [0, 2], [2, 3], [3, 4], [3, 5], [5, 6], [6, 8], [5, 7],
  [7, 8], [8, 9], [6, 9],
]

/** Which nodes flicker, and how far into the cycle each one does it. */
const SPARKS: { group: "a" | "b"; index: number; delay: string }[] = [
  { group: "a", index: 2, delay: "0s" },
  { group: "a", index: 6, delay: "6.5s" },
  { group: "b", index: 1, delay: "3.2s" },
  { group: "b", index: 6, delay: "11s" },
  { group: "b", index: 9, delay: "8.1s" },
]

function Mesh({
  nodes,
  links,
  sparks,
}: {
  nodes: readonly (readonly [number, number])[]
  links: [number, number][]
  sparks: { index: number; delay: string }[]
}) {
  const sparkAt = new Map(sparks.map(s => [s.index, s.delay]))

  return (
    <>
      {links.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={nodes[a]![0]} y1={nodes[a]![1]}
          x2={nodes[b]![0]} y2={nodes[b]![1]}
          stroke="var(--mesh-link)"
          strokeWidth={1.1}
        />
      ))}

      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={2.2} fill="var(--mesh-node)" />
          {sparkAt.has(i) && (
            // A second, brighter dot on the same spot that fades up and out.
            // Drawn separately so the base node never disappears — a mesh with
            // holes in it reads as a rendering bug.
            <circle
              cx={x} cy={y} r={4.2}
              fill="var(--mesh-spark)"
              className="animate-mesh-spark"
              style={{ animationDelay: sparkAt.get(i), transformOrigin: `${x}px ${y}px` }}
            />
          )}
        </g>
      ))}
    </>
  )
}

export function SidebarAura() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The bloom. Two of them, wandering on different periods, so the light
          in the rail is never quite where it was. Heavily blurred, so what
          reaches the eye is a gradient rather than a shape.
       *
       * Painted from `--brand-500` at 20% rather than from `--glow`. `--glow`
       * is already a 10%-alpha violet, and putting a 56px blur on a 10% colour
       * produces nothing at all — the first render of this component had two
       * invisible blobs in it. The token is right for a wash sitting directly
       * on a surface and wrong for something this diffused. */}
      <div
        className="animate-aura-wander absolute -left-14 top-[6%] h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--brand-500), transparent 70%)" }}
      />
      <div
        className="animate-aura-wander absolute -right-16 top-[56%] h-72 w-72 rounded-full opacity-15 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--brand-600), transparent 70%)",
          animationDelay: "-14s",
          animationDuration: "47s",
        }}
      />

      {/* The constellation. `preserveAspectRatio="xMidYMin slice"` crops rather
          than squashes on a short viewport — a stretched mesh looks wrong in a
          way that is hard to name and easy to see. */}
      <svg
        className="animate-mesh-breathe absolute inset-0 h-full w-full"
        viewBox="0 0 248 900"
        preserveAspectRatio="xMidYMin slice"
        style={{ maskImage: NAV_SAFE_MASK, WebkitMaskImage: NAV_SAFE_MASK }}
      >
        <g className="animate-mesh-drift-a">
          <Mesh
            nodes={GROUP_A}
            links={LINKS_A}
            sparks={SPARKS.filter(s => s.group === "a")}
          />
        </g>
        <g className="animate-mesh-drift-b">
          <Mesh
            nodes={GROUP_B}
            links={LINKS_B}
            sparks={SPARKS.filter(s => s.group === "b")}
          />
        </g>
      </svg>

    </div>
  )
}
