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
 * The organisation has HIPAA mode switched on at the voice provider, and in
 * that mode recordings are kept in a private bucket that the returned URL
 * cannot open. The provider's own documentation is explicit that the artifact
 * has to be fetched through their API with the private key instead.
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
 * Two ways, because the private-bucket URL and the API-mediated fetch are both
 * plausible readings of the documentation and only one of them is going to work
 * for a given organisation. Trying the cheap one first and falling back costs a
 * round trip on the path that fails and nothing at all on the path that works —
 * which is a better trade than shipping one guess and finding out from a
 * customer.
 *
 * Whichever succeeds is logged, so this stops being a guess after the first
 * real request.
 */
async function fetchRecording(
  storedUrl: string,
  vapiCallId: string | null
): Promise<Response | null> {
  const key = process.env.VAPI_API_KEY
  if (!key) return null

  // 1 · The stored URL, authenticated. Works when the object store accepts the
  //     provider's bearer token, and when the bucket is public.
  try {
    const direct = await fetch(storedUrl, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    })
    if (direct.ok) return direct
    console.warn(`[calls/recording] direct fetch ${direct.status}`)
  } catch (error) {
    console.error("[calls/recording] direct", error)
  }

  // 2 · Re-read the call through the API, which is what the provider tells
  //     HIPAA organisations to do, and take whatever URL it hands back now —
  //     typically a freshly signed one.
  if (!vapiCallId) return null

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
      recordingUrl?: string
      artifact?: { recordingUrl?: string; recording?: { stereoUrl?: string; mono?: { combinedUrl?: string } } }
    }

    const fresh =
      call.artifact?.recording?.mono?.combinedUrl ??
      call.artifact?.recording?.stereoUrl ??
      call.artifact?.recordingUrl ??
      call.recordingUrl

    // A URL identical to the one we already hold is not a fresh one, and
    // fetching it again would only repeat the failure above.
    if (!fresh || fresh === storedUrl) return null

    const second = await fetch(fresh, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    })
    if (second.ok) {
      console.info("[calls/recording] served via API re-read")
      return second
    }
    console.warn(`[calls/recording] refreshed fetch ${second.status}`)
  } catch (error) {
    console.error("[calls/recording] refresh", error)
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

  const upstream = await fetchRecording(call.recordingUrl, call.vapiCallId)
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
