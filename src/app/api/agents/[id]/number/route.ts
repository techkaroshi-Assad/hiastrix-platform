/**
 * Gone. Number assignment moved to PUT /api/numbers/[id].
 *
 * This route assumed one number per agent: it detached whatever else pointed at
 * the agent before attaching, and it attached regardless of the agent's status —
 * so calling it on a paused agent put that agent back on the air, which is the
 * billing hole `applyOneAgentAvailability` exists to close.
 *
 * The file survives only so a stale client gets a clear answer instead of a
 * silent 404 from the new route tree. Delete the folder when convenient:
 *
 *   git rm -r "src/app/api/agents/[id]/number"
 */

export async function PUT() {
  return Response.json(
    { error: "This endpoint has moved to PUT /api/numbers/{numberId}." },
    { status: 410 }
  )
}
