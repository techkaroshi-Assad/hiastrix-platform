/**
 * POST /api/webhooks/vapi — inbound call lifecycle events.
 *
 * Authenticated with a shared secret (VAPI_WEBHOOK_SECRET) compared in
 * constant time. Unauthenticated requests get a bare 401 with no detail.
 *
 * Vapi's server messages are handled by `message.type`. We care about three:
 *   status-update        → call started / status transitions
 *   end-of-call-report   → final duration, recording, transcript → billing
 *   transcript           → incremental transcript updates
 *
 * Handlers are idempotent: Vapi retries, and a retried event must not bill
 * twice. Every write keys off the unique vapiCallId.
 */

import { NextRequest } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { processCallEnded } from "@/lib/billing/cap-enforcement"

export const dynamic = "force-dynamic"

function authorised(request: NextRequest) {
  const expected = process.env.VAPI_WEBHOOK_SECRET
  if (!expected) return false

  const header =
    request.headers.get("x-vapi-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""

  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Vapi's endedReason vocabulary → our CallStatus enum. */
function mapStatus(endedReason?: string): "COMPLETED" | "FAILED" | "NO_ANSWER" | "BUSY" {
  const r = (endedReason ?? "").toLowerCase()
  if (r.includes("no-answer") || r.includes("noanswer")) return "NO_ANSWER"
  if (r.includes("busy")) return "BUSY"
  if (r.includes("error") || r.includes("failed") || r.includes("rejected")) return "FAILED"
  return "COMPLETED"
}

function mapDirection(raw?: string): "INBOUND" | "OUTBOUND" | "WEB" {
  const t = (raw ?? "").toLowerCase()
  if (t.includes("web")) return "WEB"
  if (t.includes("outbound")) return "OUTBOUND"
  return "INBOUND"
}

type VapiCall = {
  id?: string
  type?: string
  customer?: { number?: string }
  phoneNumberId?: string
  assistantId?: string
  startedAt?: string
  endedAt?: string
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return new Response(null, { status: 401 })
  }

  let body: { message?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }

  const message = body.message ?? {}
  const type = String(message.type ?? "")
  const call = (message.call ?? {}) as VapiCall
  const vapiCallId = call.id

  // Nothing we can key on — acknowledge so Vapi stops retrying.
  if (!vapiCallId) return Response.json({ ok: true })

  try {
    const assistantId =
      call.assistantId ?? (message.assistant as { id?: string } | undefined)?.id

    const agent = assistantId
      ? await prisma.agent.findUnique({
          where: { vapiAssistantId: assistantId },
          select: { id: true, tenantId: true },
        })
      : null

    // An event for an assistant we don't own isn't ours to record.
    if (!agent) return Response.json({ ok: true })

    const phoneNumber = call.phoneNumberId
      ? await prisma.phoneNumber.findUnique({
          where: { vapiPhoneNumberId: call.phoneNumberId },
          select: { id: true },
        })
      : null

    switch (type) {
      /* ── Call opened ──────────────────────────────────────────────── */
      case "status-update": {
        const status = String(message.status ?? "")
        if (status !== "in-progress") break

        await prisma.call.upsert({
          where: { vapiCallId },
          create: {
            vapiCallId,
            tenantId:      agent.tenantId,
            agentId:       agent.id,
            phoneNumberId: phoneNumber?.id ?? null,
            direction:     mapDirection(call.type),
            callerNumber:  call.customer?.number ?? null,
            status:        "IN_PROGRESS",
            startedAt:     call.startedAt ? new Date(call.startedAt) : new Date(),
          },
          update: { status: "IN_PROGRESS" },
        })
        break
      }

      /* ── Call finished — the billing trigger ──────────────────────── */
      case "end-of-call-report": {
        const durationSeconds = Math.max(
          0,
          Math.round(Number(message.durationSeconds ?? 0))
        )

        // Recording can arrive at the top level or nested under artifact,
        // depending on the assistant's artifact plan.
        const artifact = (message.artifact ?? {}) as Record<string, unknown>
        const recordingUrl =
          (message.recordingUrl as string | undefined) ??
          (message.stereoRecordingUrl as string | undefined) ??
          (artifact.recordingUrl as string | undefined) ??
          null

        const transcript =
          (message.transcript as string | undefined) ??
          (artifact.transcript as string | undefined) ??
          null

        const messages =
          (artifact.messages as unknown[] | undefined) ??
          (message.messages as unknown[] | undefined) ??
          null

        // Analysis is only present when the agent has analysisPlan enabled.
        const analysis = (message.analysis ?? {}) as Record<string, unknown>
        const summary = (analysis.summary as string | undefined) ?? null
        const endedReason = (message.endedReason as string | undefined) ?? null

        const analysisPayload =
          analysis.structuredData !== undefined ||
          analysis.successEvaluation !== undefined
            ? {
                structuredData:    analysis.structuredData ?? null,
                successEvaluation: analysis.successEvaluation ?? null,
              }
            : null

        const status = mapStatus(endedReason ?? undefined)

        const record = await prisma.call.upsert({
          where: { vapiCallId },
          create: {
            vapiCallId,
            tenantId:      agent.tenantId,
            agentId:       agent.id,
            phoneNumberId: phoneNumber?.id ?? null,
            direction:     mapDirection(call.type),
            callerNumber:  call.customer?.number ?? null,
            status,
            durationSeconds,
            recordingUrl,
            transcript,
            summary,
            endedReason,
            ...(analysisPayload ? { analysis: analysisPayload } : {}),
            ...(messages ? { messages } : {}),
            startedAt: call.startedAt ? new Date(call.startedAt) : null,
            endedAt:   call.endedAt ? new Date(call.endedAt) : new Date(),
          },
          update: {
            status,
            durationSeconds,
            recordingUrl,
            transcript,
            summary,
            endedReason,
            ...(analysisPayload ? { analysis: analysisPayload } : {}),
            ...(messages ? { messages } : {}),
            endedAt: call.endedAt ? new Date(call.endedAt) : new Date(),
          },
          select: { id: true, minutesBilled: true },
        })

        // Idempotency guard: a retried report must not bill a second time.
        if (record.minutesBilled === 0 && durationSeconds > 0) {
          await processCallEnded({
            tenantId: agent.tenantId,
            callId:   record.id,
            durationSeconds,
          })
        }
        break
      }

      /* ── Late-arriving artefacts ──────────────────────────────────── */
      case "transcript": {
        const transcript = message.transcript as string | undefined
        if (!transcript) break
        await prisma.call.updateMany({
          where: { vapiCallId, tenantId: agent.tenantId },
          data:  { transcript },
        })
        break
      }

      default:
        break
    }

    return Response.json({ ok: true })
  } catch (error) {
    // Log server-side and return 500 so Vapi retries a genuine failure.
    console.error("[webhooks/vapi]", error)
    return new Response(null, { status: 500 })
  }
}
