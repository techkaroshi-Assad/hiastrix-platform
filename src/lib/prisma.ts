/**
 * Prisma Client Singleton (Prisma 7 + pg adapter)
 *
 * Uses a Proxy for lazy initialisation — PrismaClient is only instantiated
 * on first actual use (inside a request), never at module import time.
 * This prevents build-time failures when DATABASE_URL is not yet available.
 *
 * Pool is capped at 5 connections per function instance — safe for serverless
 * (Supabase free tier allows 60 direct connections; 5 × ≤12 warm instances = 60).
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "[Prisma] DATABASE_URL is not set. Add it to your Vercel environment variables."
    )
  }

  const pool    = new Pool({ connectionString, max: 5 })
  const adapter = new PrismaPg(pool)
  const client  = new PrismaClient({ adapter })

  // Always cache on globalThis — both dev and prod.
  // Dev: prevents exhausting connections across hot-reloads.
  // Prod: reuses the pool across warm invocations of the same function instance.
  globalForPrisma.prisma = client

  return client
}

// Lazy proxy — PrismaClient is only instantiated on first property access,
// not at module import time. Importing this file is always safe at build time.
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop: string | symbol) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
