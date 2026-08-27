/**
 * POST   /api/agents/[id]/knowledge — add a document: an uploaded file, or a
 *        website address fetched and converted server-side.
 * DELETE /api/agents/[id]/knowledge?fileId=… — remove one.
 *
 * The first multipart route in this codebase — everything else stays JSON on
 * purpose (see lib/dialer/csv.ts), but there is no JSON-safe way to carry a
 * PDF. Kept to exactly this one route rather than becoming a second pattern
 * to maintain everywhere else.
 *
 * Either way, the knowledge tool is rebuilt and the assistant re-pushed to
 * Vapi inside this same request — a file sitting in `knowledgeFiles` with no
 * tool actually attached would be a setting that silently does nothing,
 * which is the one failure shape this whole platform is built to avoid.
 */

import { randomUUID } from "crypto"
import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiAssistants } from "@/lib/vapi/client"
import { AgentConfigInputSchema, readConfig, type KnowledgeFile } from "@/lib/vapi/config"
import { buildAssistantPayload } from "@/lib/vapi/payload"
import { uploadKnowledgeFile, fetchUrlAsKnowledgeFile, rebuildKnowledgeTool } from "@/lib/vapi/knowledge"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

/** Matches lib/vapi/knowledge.ts's guidance to stay well under the provider's
 *  own ~300KB recommendation, applied here so an oversized upload is refused
 *  before it ever leaves this request. */
const MAX_UPLOAD_BYTES = 300_000

const EXTENSION_MIME: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
  json: "application/json", xml: "application/xml", yaml: "application/x-yaml", yml: "application/x-yaml",
  log: "text/plain", pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

const UrlBodySchema = z.object({ url: z.string().trim().min(1).max(2000) })

async function loadOwnedAgent(id: string) {
  const ctx = await getTenantContext()
  if (!ctx) return { error: apiError(ERRORS.UNAUTHORIZED, 401) as Response }

  const agent = await prisma.agent.findFirst({ where: { id, tenantId: ctx.tenant.id } })
  if (!agent) return { error: apiError(ERRORS.NOT_FOUND, 404) as Response }

  return { agent }
}

/** Push the merged config to Vapi, then persist it — the same order the main
 *  agent PATCH route uses, and for the same reason: our own record should
 *  only reflect a config the provider has actually accepted. */
async function saveKnowledgeFiles(
  agent: { id: string; vapiAssistantId: string; name: string; systemPrompt: string | null
           firstMessage: string | null; voice: string | null; model: string | null
           recordingEnabled: boolean; transcriptionEnabled: boolean; config: unknown },
  files: KnowledgeFile[]
) {
  const stored = readConfig(agent.config)
  const { knowledgeToolId } = await rebuildKnowledgeTool({
    agentName: agent.name,
    files,
    previousToolId: stored.knowledgeToolId,
  })

  const nextConfig = AgentConfigInputSchema.parse({
    ...stored,
    knowledgeFiles: files,
    knowledgeToolId,
  })

  await vapiAssistants.update(
    agent.vapiAssistantId,
    buildAssistantPayload(
      {
        name: agent.name,
        systemPrompt: agent.systemPrompt ?? "",
        firstMessage: agent.firstMessage ?? "",
        voice: agent.voice ?? "",
        model: agent.model ?? "",
        recordingEnabled: agent.recordingEnabled,
        transcriptionEnabled: agent.transcriptionEnabled,
      },
      nextConfig
    )
  )

  await prisma.agent.update({ where: { id: agent.id }, data: { config: nextConfig } })
  // Both are handed back, not just the files — the caller's local draft holds
  // a full copy of `config` and has to replace both together, or a save made
  // moments later would re-send a knowledgeToolId that no longer matches the
  // file list it was just rebuilt from.
  return { files: nextConfig.knowledgeFiles, knowledgeToolId: nextConfig.knowledgeToolId }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const found = await loadOwnedAgent(id)
    if ("error" in found) return found.error
    const { agent } = found

    const stored = readConfig(agent.config)
    if (stored.knowledgeFiles.length >= 20) {
      return apiError("This agent already has 20 documents, which is the most it can hold at once.")
    }

    const contentType = request.headers.get("content-type") ?? ""
    let entry: KnowledgeFile

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData()
      const file = form.get("file")
      if (!(file instanceof File)) return apiError("No file was attached.")
      if (file.size === 0) return apiError("That file is empty.")
      if (file.size > MAX_UPLOAD_BYTES) {
        return apiError(`That file is too large — keep it under ${Math.floor(MAX_UPLOAD_BYTES / 1000)}KB so it stays quick to search.`)
      }

      const ext = (file.name.split(".").pop() ?? "").toLowerCase()
      const mime = EXTENSION_MIME[ext]
      if (!mime) {
        return apiError("That file type isn't supported. Use a text, PDF, or Word document, or a spreadsheet export.")
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      let vapiFileId: string
      try {
        ;({ vapiFileId } = await uploadKnowledgeFile(buffer, file.name, mime))
      } catch (err) {
        return apiError(sanitiseError(err, "agents/knowledge/upload/provider"))
      }

      entry = { id: randomUUID(), name: file.name, vapiFileId, source: "upload" }
    } else {
      const parsed = UrlBodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return apiError("I need a file or a web address.")

      let result: { vapiFileId: string; name: string }
      try {
        result = await fetchUrlAsKnowledgeFile(parsed.data.url)
      } catch (err) {
        // These are already written for a person — see fetchUrlAsKnowledgeFile —
        // so they pass through rather than being laundered into something generic.
        return apiError(err instanceof Error ? err.message : ERRORS.FALLBACK)
      }

      entry = {
        id: randomUUID(),
        name: result.name,
        vapiFileId: result.vapiFileId,
        source: "url",
        sourceUrl: parsed.data.url,
      }
    }

    const result = await saveKnowledgeFiles(agent, [...stored.knowledgeFiles, entry])
    return Response.json(result)
  } catch (error) {
    return apiError(sanitiseError(error, "agents/knowledge/add"))
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const found = await loadOwnedAgent(id)
    if ("error" in found) return found.error
    const { agent } = found

    const fileId = request.nextUrl.searchParams.get("fileId")
    if (!fileId) return apiError("Which document to remove wasn't specified.")

    const stored = readConfig(agent.config)
    const remaining = stored.knowledgeFiles.filter(f => f.id !== fileId)
    if (remaining.length === stored.knowledgeFiles.length) {
      return apiError(ERRORS.NOT_FOUND, 404)
    }

    const result = await saveKnowledgeFiles(agent, remaining)
    return Response.json(result)
  } catch (error) {
    return apiError(sanitiseError(error, "agents/knowledge/remove"))
  }
}
