/**
 * Prisma Client Singleton (Prisma 7 + pg adapter)
 *
 * Prisma 7 requires an explicit database adapter — the connection string
 * is no longer set in schema.prisma. We use @prisma/adapter-pg for
 * standard PostgreSQL (Supabase).
 *
 * The singleton pattern prevents connection pool exhaustion in serverless.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    // Build-time safety: DATABASE_URL not available during `next build`
    // Runtime calls will throw — expected until env vars are set in Vercel
    return new PrismaClient()
  }
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
