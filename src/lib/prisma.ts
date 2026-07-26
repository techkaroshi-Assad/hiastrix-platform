/**
 * Prisma Client Singleton (Prisma 7 + pg adapter)
 *
 * Uses a Proxy for lazy initialization — PrismaClient is only instantiated
 * on first actual use (inside a request), never at module import time.
 * This prevents build-time failures when DATABASE_URL is not yet available.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

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

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client
  }

  return client
}

// Lazy proxy — PrismaClient is only instantiated on first property access,
// not at module import time. Importing this file is always safe at build time.
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop: string | symbol) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
