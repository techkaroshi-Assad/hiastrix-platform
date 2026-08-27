/**
 * Wiring a tenant's own documents into their agent — SERVER ONLY.
 *
 * Vapi's native knowledge base is file-based: upload a file, get an id back,
 * point a "query" tool at a list of those ids, attach the tool to the
 * assistant. There is no first-class "here's a URL" version of that — their
 * own docs say to convert a page to a file first — so a pasted website is
 * fetched and turned into a text file ourselves. The agent never learns the
 * difference, and neither does the vendor boundary this platform otherwise
 * keeps everywhere else: nothing here says which provider is doing the
 * retrieval, in the UI or in an error message.
 */

import { vapiFiles, vapiTools } from "./client"
import type { KnowledgeFile } from "./config"

/** Vapi's own guidance: keep files well under 300KB for quick processing. */
const MAX_TEXT_BYTES = 280_000

/**
 * Strip markup down to plain text worth handing a language model.
 *
 * Deliberately simple — this is not a rendering engine, just enough to turn
 * a page into the "clear, well-structured, plain language" shape Vapi's own
 * best-practice guidance asks for. A tenant who needs a faithful copy of a
 * complex page should upload a PDF instead; this is for "here's what our
 * pricing page says", not a design fidelity requirement.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export async function uploadKnowledgeFile(
  content: Buffer,
  filename: string,
  mimeType: string
): Promise<{ vapiFileId: string }> {
  const created = await vapiFiles.upload(content, filename, mimeType)
  return { vapiFileId: created.id }
}

/**
 * Fetch a page and upload its text as a file.
 *
 * Only http/https, and only after `new URL` accepts it — the one guard that
 * matters here, since this is a server making an outbound request to
 * whatever address a tenant types in.
 */
/**
 * Below this, a fetch almost certainly landed on a JavaScript shell rather
 * than real content — a `<div id="root">` and a script tag, no visible text.
 * This platform has no browser to render a page with; it only ever reads
 * what the server sent back. Worth surfacing at the point of upload rather
 * than let a tenant discover it three questions into a call, the way "why
 * doesn't it know what we do" surfaced here.
 */
const THIN_CONTENT_CHARS = 200

export async function fetchUrlAsKnowledgeFile(
  url: string
): Promise<{ vapiFileId: string; name: string; preview: string; thin: boolean }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("That doesn't look like a valid web address.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https addresses are supported.")
  }

  let res: Response
  try {
    res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HiAstrixBot/1.0; +https://app.hiastrix.com)" },
    })
  } catch {
    throw new Error("That page couldn't be reached.")
  }
  if (!res.ok) throw new Error(`That page couldn't be read (it answered with ${res.status}).`)

  const html = await res.text()
  const text = htmlToText(html).slice(0, MAX_TEXT_BYTES)
  if (!text.trim()) throw new Error("That page didn't have any readable text on it.")

  const created = await vapiFiles.upload(
    Buffer.from(text, "utf-8"),
    `${parsed.hostname.replace(/[^a-z0-9.-]/gi, "_")}.txt`,
    "text/plain"
  )
  return {
    vapiFileId: created.id,
    name: `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, ""),
    preview: text.slice(0, 220),
    thin: text.length < THIN_CONTENT_CHARS,
  }
}

/**
 * Recreate the query tool from the current file list — never patched in
 * place. Only the create shape is documented with certainty, and this runs
 * rarely enough (a tenant adding or removing one document at a time) that an
 * extra round trip is not a real cost. The old tool is deleted best-effort;
 * an orphaned one costs nothing and nothing will ever reference it again
 * once the assistant's `toolIds` stops pointing at it.
 */
export async function rebuildKnowledgeTool(a: {
  agentName: string
  files: KnowledgeFile[]
  previousToolId: string
}): Promise<{ knowledgeToolId: string }> {
  if (a.previousToolId) {
    try {
      await vapiTools.delete(a.previousToolId)
    } catch {
      /* best-effort cleanup; a leftover tool object is inert */
    }
  }

  if (!a.files.length) return { knowledgeToolId: "" }

  const created = await vapiTools.createQuery({
    name: `${a.agentName} documents`.slice(0, 80),
    description: "Documents and pages this agent has been given to answer questions from.",
    fileIds: a.files.map(f => f.vapiFileId),
  })
  return { knowledgeToolId: created.id }
}
