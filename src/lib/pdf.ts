/**
 * A small PDF writer. No dependencies.
 *
 * Same reasoning as lib/xlsx.ts: the report needs text, rules, filled
 * boxes, simple bar charts and tables across several pages, in the two
 * fonts every PDF reader ships with (Helvetica and Helvetica-Bold — the
 * "standard 14", which need no embedding). That is a few hundred lines of
 * PDF 1.4, and it keeps the report route free of native font engines and
 * bundler quirks on the serverless build.
 *
 * Glyph widths for the two fonts are the AFM values (ASCII 32–126), so
 * wrapping and right-alignment are measured, not estimated. Characters
 * outside WinAnsi are replaced with a close ASCII equivalent before layout
 * — em dashes, curly quotes, ellipses and the like — so a transcript excerpt
 * cannot produce an unrenderable byte.
 *
 * Coordinates given to the API are top-down (y grows downward from the top
 * margin), which is how everyone thinks about a page; the writer flips them
 * to PDF's bottom-up space at the end.
 */

import { deflateSync } from "node:zlib"

/* ── Fonts ─────────────────────────────────────────────────────────────── */

const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]

export type Font = "regular" | "bold"

/** Replace what WinAnsi cannot show with what it can. */
export function ascii(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[•●]/g, "*")
    .replace(/·/g, "-")
    .replace(/[éèê]/g, "e").replace(/[áàâä]/g, "a")
    .replace(/[íìî]/g, "i").replace(/[óòôö]/g, "o")
    .replace(/[úùûü]/g, "u").replace(/ñ/g, "n").replace(/ç/g, "c")
    .replace(/[^\x20-\x7E\n]/g, "?")
}

export function textWidth(s: string, size: number, font: Font = "regular"): number {
  const table = font === "bold" ? W_BOLD : W_REG
  let w = 0
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    w += table[code - 32] ?? 556
  }
  return (w / 1000) * size
}

/** Greedy word wrap into lines that fit `maxWidth`. Long words are split. */
export function wrap(text: string, maxWidth: number, size: number, font: Font = "regular"): string[] {
  const out: string[] = []
  for (const para of ascii(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(""); continue }
    let line = ""
    for (let word of words) {
      // A single word wider than the column is broken by character.
      while (textWidth(word, size, font) > maxWidth) {
        let cut = word.length - 1
        while (cut > 1 && textWidth(word.slice(0, cut), size, font) > maxWidth) cut--
        if (line) { out.push(line); line = "" }
        out.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, size, font) <= maxWidth) line = candidate
      else { if (line) out.push(line); line = word }
    }
    if (line) out.push(line)
  }
  return out
}

/* ── Document ──────────────────────────────────────────────────────────── */

export type RGB = [number, number, number]

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
const num = (n: number) => (Math.round(n * 100) / 100).toString()
const rgb = (c: RGB) => `${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)}`

export class Pdf {
  readonly width: number
  readonly height: number
  readonly margin: number
  private pages: string[][] = []
  private page: string[] = []
  /** Top-down cursor on the current page. */
  y = 0
  private meta: { title: string; author: string }

  constructor(opts: { title: string; author?: string; size?: "A4" | "Letter"; margin?: number }) {
    const [w, h] = opts.size === "Letter" ? [612, 792] : [595.28, 841.89]
    this.width = w
    this.height = h
    this.margin = opts.margin ?? 48
    this.meta = { title: opts.title, author: opts.author ?? "Hi-Astrix" }
    this.newPage()
  }

  get contentWidth() { return this.width - this.margin * 2 }
  get bottom() { return this.height - this.margin }
  get pageNumber() { return this.pages.length + 1 }
  get remaining() { return this.bottom - this.y }

  newPage() {
    if (this.page.length) this.pages.push(this.page)
    this.page = []
    this.y = this.margin
  }

  /** Start a new page unless `needed` points fit below the cursor. */
  ensure(needed: number) {
    if (this.y + needed > this.bottom) this.newPage()
  }

  /* ── Primitives (top-down y) ─────────────────────────────────────── */

  private flipY(y: number) { return this.height - y }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; lineWidth?: number } = {}) {
    const ops: string[] = []
    if (opts.fill) ops.push(`${rgb(opts.fill)} rg`)
    if (opts.stroke) ops.push(`${rgb(opts.stroke)} RG ${num(opts.lineWidth ?? 0.5)} w`)
    ops.push(`${num(x)} ${num(this.flipY(y + h))} ${num(w)} ${num(h)} re`)
    ops.push(opts.fill && opts.stroke ? "B" : opts.fill ? "f" : "S")
    this.page.push(`q ${ops.join(" ")} Q`)
  }

  line(x1: number, y1: number, x2: number, y2: number, colour: RGB = [220, 220, 228], width = 0.5) {
    this.page.push(`q ${rgb(colour)} RG ${num(width)} w ${num(x1)} ${num(this.flipY(y1))} m ${num(x2)} ${num(this.flipY(y2))} l S Q`)
  }

  /** One line of text with its baseline at `y`. Returns its width. */
  text(s: string, x: number, y: number, opts: { size?: number; font?: Font; colour?: RGB; align?: "left" | "right" | "center"; maxWidth?: number } = {}): number {
    const size = opts.size ?? 10
    const font = opts.font ?? "regular"
    let t = ascii(s)
    if (opts.maxWidth !== undefined && textWidth(t, size, font) > opts.maxWidth) {
      while (t.length > 1 && textWidth(`${t}...`, size, font) > opts.maxWidth) t = t.slice(0, -1)
      t = `${t}...`
    }
    const w = textWidth(t, size, font)
    let tx = x
    if (opts.align === "right") tx = x - w
    if (opts.align === "center") tx = x - w / 2
    const f = font === "bold" ? "/F2" : "/F1"
    this.page.push(`BT ${rgb(opts.colour ?? [20, 20, 28])} rg ${f} ${num(size)} Tf ${num(tx)} ${num(this.flipY(y))} Td (${esc(t)}) Tj ET`)
    return w
  }

  /* ── Flow helpers (advance the cursor) ───────────────────────────── */

  heading(s: string, opts: { size?: number; colour?: RGB; gapAfter?: number } = {}) {
    const size = opts.size ?? 15
    this.ensure(size * 2)
    this.y += size
    this.text(s, this.margin, this.y, { size, font: "bold", colour: opts.colour })
    this.y += opts.gapAfter ?? size * 0.7
  }

  paragraph(s: string, opts: { size?: number; colour?: RGB; font?: Font; gapAfter?: number; width?: number; x?: number } = {}) {
    const size = opts.size ?? 9.5
    const lh = size * 1.4
    const lines = wrap(s, opts.width ?? this.contentWidth, size, opts.font ?? "regular")
    for (const l of lines) {
      this.ensure(lh)
      this.y += lh
      this.text(l, opts.x ?? this.margin, this.y - size * 0.25, { size, font: opts.font, colour: opts.colour })
    }
    this.y += opts.gapAfter ?? size * 0.6
  }

  space(h: number) { this.y += h }

  rule(colour: RGB = [225, 225, 232]) {
    this.ensure(8)
    this.y += 4
    this.line(this.margin, this.y, this.width - this.margin, this.y, colour)
    this.y += 6
  }

  /** A row of KPI boxes: big number, small label, optional sub-line. */
  kpis(items: { label: string; value: string; sub?: string }[], opts: { columns?: number; accent?: RGB } = {}) {
    const cols = opts.columns ?? Math.min(4, items.length)
    const gap = 8
    const w = (this.contentWidth - gap * (cols - 1)) / cols
    const h = 58
    const rows = Math.ceil(items.length / cols)
    for (let r = 0; r < rows; r++) {
      this.ensure(h + gap)
      for (let c = 0; c < cols; c++) {
        const it = items[r * cols + c]
        if (!it) continue
        const x = this.margin + c * (w + gap)
        this.rect(x, this.y, w, h, { fill: [246, 245, 252], stroke: [228, 226, 240] })
        this.text(it.label.toUpperCase(), x + 10, this.y + 15, { size: 6.5, colour: [110, 108, 130], font: "bold" })
        this.text(it.value, x + 10, this.y + 37, { size: 18, font: "bold", colour: opts.accent ?? [40, 32, 90], maxWidth: w - 20 })
        if (it.sub) this.text(it.sub, x + 10, this.y + 50, { size: 7.5, colour: [110, 108, 130], maxWidth: w - 20 })
      }
      this.y += h + gap
    }
  }

  /**
   * Horizontal bars with labels and values — the chart that survives a
   * black-and-white printer.
   */
  bars(rows: { label: string; value: number; colour?: RGB }[], opts: { format?: (v: number) => string; max?: number; barHeight?: number; labelWidth?: number } = {}) {
    const max = Math.max(1, opts.max ?? Math.max(...rows.map(r => r.value)))
    const bh = opts.barHeight ?? 11
    const lw = opts.labelWidth ?? 130
    const fmt = opts.format ?? (v => String(v))
    const valueW = 56
    const barX = this.margin + lw + 6
    const barW = this.contentWidth - lw - 6 - valueW
    for (const r of rows) {
      this.ensure(bh + 6)
      this.text(r.label, this.margin, this.y + bh - 2, { size: 8.5, maxWidth: lw })
      this.rect(barX, this.y, barW, bh, { fill: [238, 237, 246] })
      const w = Math.max(0, (r.value / max) * barW)
      if (w > 0) this.rect(barX, this.y, w, bh, { fill: r.colour ?? [111, 84, 220] })
      this.text(fmt(r.value), this.width - this.margin, this.y + bh - 2, { size: 8.5, align: "right", colour: [70, 68, 90] })
      this.y += bh + 6
    }
    this.y += 4
  }

  /** Vertical columns across the width — a daily volume chart. */
  columns(points: { label: string; value: number }[], opts: { height?: number; format?: (v: number) => string; colour?: RGB; labelEvery?: number } = {}) {
    const h = opts.height ?? 90
    this.ensure(h + 28)
    const max = Math.max(1, ...points.map(p => p.value))
    const n = Math.max(1, points.length)
    const gap = n > 40 ? 1 : 2
    const cw = (this.contentWidth - gap * (n - 1)) / n
    const top = this.y + 10
    const base = top + h
    this.line(this.margin, base, this.width - this.margin, base, [200, 198, 212])
    // Max label
    this.text((opts.format ?? String)(max), this.margin, top - 2, { size: 6.5, colour: [130, 128, 150] })
    points.forEach((p, i) => {
      const x = this.margin + i * (cw + gap)
      const bh = (p.value / max) * h
      if (bh > 0) this.rect(x, base - bh, cw, bh, { fill: opts.colour ?? [111, 84, 220] })
    })
    const every = opts.labelEvery ?? Math.max(1, Math.ceil(n / 10))
    points.forEach((p, i) => {
      if (i % every !== 0 && i !== n - 1) return
      const x = this.margin + i * (cw + gap) + cw / 2
      this.text(p.label, x, base + 10, { size: 6.5, colour: [130, 128, 150], align: "center" })
    })
    this.y = base + 20
  }

  /**
   * A table with wrapped cells and a repeated header on page breaks.
   * `widths` are fractions of the content width.
   */
  table(a: {
    columns: { header: string; width: number; align?: "left" | "right" }[]
    rows: (string | number | null | undefined)[][]
    size?: number
    zebra?: boolean
    boldLast?: boolean
  }) {
    const size = a.size ?? 8
    const lh = size * 1.35
    const pad = 4
    const total = a.columns.reduce((s, c) => s + c.width, 0)
    const widths = a.columns.map(c => (c.width / total) * this.contentWidth)
    const xs: number[] = []
    let acc = this.margin
    for (const w of widths) { xs.push(acc); acc += w }

    const headerLines = a.columns.map((c, i) => wrap(c.header, widths[i]! - pad * 2, size, "bold"))
    const headerRows = Math.max(1, ...headerLines.map(l => l.length))
    const header = () => {
      const hh = headerRows * lh + pad * 2
      this.ensure(hh + lh)
      this.rect(this.margin, this.y, this.contentWidth, hh, { fill: [237, 233, 254] })
      a.columns.forEach((c, i) => {
        const x = c.align === "right" ? xs[i]! + widths[i]! - pad : xs[i]! + pad
        // Bottom-aligned, so a one-line header sits level with the last
        // line of a two-line neighbour.
        const ls = headerLines[i]!
        ls.forEach((l, k) => {
          const row = headerRows - ls.length + k
          this.text(l, x, this.y + pad + size + row * lh, { size, font: "bold", align: c.align, colour: [50, 40, 100] })
        })
      })
      this.y += hh
    }

    header()
    a.rows.forEach((row, ri) => {
      const cells = a.columns.map((c, i) => {
        const v = row[i]
        const s = v === null || v === undefined ? "" : String(v)
        return wrap(s, widths[i]! - pad * 2, size, "regular")
      })
      const lines = Math.max(1, ...cells.map(c => c.length))
      const rh = lines * lh + pad * 2
      if (this.y + rh > this.bottom) { this.newPage(); header() }
      if (a.zebra && ri % 2 === 1) this.rect(this.margin, this.y, this.contentWidth, rh, { fill: [249, 248, 253] })
      const bold = a.boldLast && ri === a.rows.length - 1
      cells.forEach((ls, i) => {
        const c = a.columns[i]!
        ls.forEach((l, k) => {
          const x = c.align === "right" ? xs[i]! + widths[i]! - pad : xs[i]! + pad
          this.text(l, x, this.y + pad + size + k * lh, { size, align: c.align, font: bold ? "bold" : "regular" })
        })
      })
      this.y += rh
      this.line(this.margin, this.y, this.width - this.margin, this.y, [232, 230, 240])
    })
    this.y += 8
  }

  /* ── Output ──────────────────────────────────────────────────────── */

  /** Runs `fn` on every page with its number, for headers and footers. */
  finish(decorate?: (p: Pdf, pageNo: number, pageCount: number) => void): Buffer {
    if (this.page.length || this.pages.length === 0) this.pages.push(this.page)
    this.page = []
    const count = this.pages.length
    if (decorate) {
      this.pages.forEach((content, i) => {
        this.page = content
        decorate(this, i + 1, count)
      })
      this.page = []
    }

    // Object layout: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page, content.
    const objects: string[] = []
    const add = (body: string) => { objects.push(body); return objects.length }

    const catalog = add("") // placeholder, filled below
    const pagesObj = add("")
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")

    const pageIds: number[] = []
    for (const content of this.pages) {
      const stream = deflateSync(Buffer.from(content.join("\n"), "latin1"))
      const contentId = add(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n` + stream.toString("latin1") + "\nendstream")
      const pageId = add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
      pageIds.push(pageId)
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`
    const info = add(`<< /Title (${esc(ascii(this.meta.title))}) /Author (${esc(ascii(this.meta.author))}) /Producer (Hi-Astrix) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`)

    const parts: string[] = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"]
    const offsets: number[] = []
    let pos = Buffer.byteLength(parts[0]!, "latin1")
    objects.forEach((body, i) => {
      offsets.push(pos)
      const s = `${i + 1} 0 obj\n${body}\nendobj\n`
      parts.push(s)
      pos += Buffer.byteLength(s, "latin1")
    })
    const xref = pos
    let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const o of offsets) table += `${String(o).padStart(10, "0")} 00000 n \n`
    parts.push(table)
    parts.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
    return Buffer.from(parts.join(""), "latin1")
  }
}
