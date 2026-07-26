/**
 * Invitation tokens.
 *
 * SERVER ONLY — uses node:crypto.
 *
 * We store sha256(token), never the token. Lookup is by that indexed hash of a
 * 256-bit secret, so no constant-time comparison is needed: we never compare
 * user input against a stored secret directly, we look up its digest.
 */

import { randomBytes, createHash } from "node:crypto"

export const INVITE_TTL_DAYS = 7

/** How many live invitations a workspace may hold at once. */
export const MAX_PENDING_INVITES = 10

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url")
  return { token, hash: hashToken(token) }
}

/**
 * Temporary password for the no-email path. Long and random rather than
 * memorable — it is copied once, not typed from memory.
 */
export const newTempPassword = () => randomBytes(12).toString("base64url")

export function inviteExpiry() {
  const at = new Date()
  at.setDate(at.getDate() + INVITE_TTL_DAYS)
  return at
}

export const inviteUrl = (token: string) =>
  `${process.env.APP_URL ?? "https://app.hiastrix.com"}/invite/${token}`
