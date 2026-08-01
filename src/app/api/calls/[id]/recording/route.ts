/**
 * GET /api/calls/:id/recording — the audio, served by us.
 *
 * Two problems, one route.
 *
 * ── It did not work ────────────────────────────────────────────────────────
 *
 * The page put the provider's own URL straight into an <audio> tag. That URL
 * points at a private object store and carries no signature, so playing it and
 * downloading it both came back as
 *
 *   <Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
 *
 * Nothing to do with HIPAA — that add-on is switched off on this account, and
 * the bucket merely happens to be named for it. The provider simply publishes
 * the unsigned path on the webhook and keeps the signed one behind their API.
 *
 * ── It named the vendor ────────────────────────────────────────────────────
 *
 * Even had it worked, clicking Download took a tenant to a hostname that says
 * exactly who we run underneath. Nothing in this platform is allowed to do
 * that, and an audio player is no exception. The bytes now come from us, from a
 * path with our own name on it.
 *
 * ── And it was unscoped ────────────────────────────────────────────────────
 *
 * A provider URL is a bearer token in disguise: anyone holding it has the
 * recording, whatever workspace they belong to. This route reads the call
 * scoped by tenant first, so another tenant's call id is a 404 and not an
 * audio file.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"

export const dynamic = "force-dynamic"

/**
 * Ask the provider for the bytes.
 *
 * The URL stored on the call — the one that arrives on the end-of-call webhook —
 * is an unsigned path into a private bucket. It opens for nobody, with or
 * without an API key, and both the browser and an authenticated fetch get the
 * same refusal:
 *
 *   <Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
 *
 * The playable URL lives on a *different field entirely*. Reading the call back
 * through the provider's API returns `presignedMonoUrl` and its siblings —
 * properly signed, and valid for thirty minutes. The unsigned `recordingUrl`
 * sits right beside them on the same object, which is why this took two wrong
 * guesses to find: every obvious field name is the one that does not work.
 *
 * The signed link is fetched with **no** Authorization header. It carries its
 * own signature in the query string, and adding a bearer token on top is how
 * you turn a valid request into a rejected one.
 *
 * Because the signature expires, this is fetched fresh on every play. There is
 * nothing here worth caching — a stored signed URL is a broken link with a
 * thirty-minute fuse.
 */
async function fetchRecording(vapiCallId: string | null): Promise<Response | null> {
  const key = process.env.VAPI_API_KEY
  if (!key || !vapiCallId) return null

  try {
    const res = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[calls/recording] call lookup ${res.status}`)
      return null
    }

    const call = await res.json() as {
      artifact?: {
        presignedMonoUrl?: string
        presignedStereoUrl?: string
      }
    }

    // Mono first: it is both sides of the conversation mixed together, which is
    // what somebody reviewing a call wants. Stereo splits agent and caller onto
    // separate channels — useful, but not the default anyone expects to hear.
    const signed = call.artifact?.presignedMonoUrl ?? call.artifact?.presignedStereoUrl
    if (!signed) {
      console.warn("[calls/recording] no presigned url on the call")
      return null
    }

    const audio = await fetch(signed, { cache: "no-store" })
    if (audio.ok) return audio

    console.warn(`[calls/recording] signed fetch ${audio.status}`)
  } catch (error) {
    console.error("[calls/recording]", error)
  }

  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const ctx = await getTenantContext()
  if (!ctx) return new Response(null, { status: 401 })

  // Scoped by tenant, so another workspace's call is simply not found.
  const call = await prisma.call.findFirst({
    where:  { id, tenantId: ctx.tenant.id },
    select: { recordingUrl: true, vapiCallId: true, startedAt: true, createdAt: true },
  })

  if (!call?.recordingUrl) return new Response(null, { status: 404 })

  const upstream = await fetchRecording(call.vapiCallId)
  if (!upstream?.body) {
    // Deliberately plain. The tenant does not need to know whose bucket it is.
    return Response.json(
      { error: "That recording isn't available to play right now." },
      { status: 502 }
    )
  }

  const stamp = (call.startedAt ?? call.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")
  const download = request.nextUrl.searchParams.get("download") === "1"

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length")! }
        : {}),
      // Inline for the player, attachment for the button — same bytes, and the
      // filename is one a person can find again in a downloads folder.
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="call-${stamp}.wav"`,
      // A recording is somebody's customer's voice. It does not belong in a
      // shared cache, and it must not be indexed.
      "Cache-Control": "private, max-age=0, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}
