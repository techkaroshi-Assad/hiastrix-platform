import Link from "next/link"
import { Logo } from "@/components/brand/logo"

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-white/[0.07] px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/">
            <Logo size={26} />
          </Link>
          <Link
            href="/login"
            className="text-[13px] text-muted transition-colors hover:text-fg"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <article
          className="
            [&_h1]:text-[30px] [&_h1]:font-semibold [&_h1]:tracking-[-0.03em]
            [&_h2]:mt-10 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:tracking-[-0.015em]
            [&_p]:mt-3.5 [&_p]:text-[14.5px] [&_p]:font-light [&_p]:leading-[1.75] [&_p]:text-muted
            [&_ul]:mt-3.5 [&_ul]:space-y-2 [&_ul]:pl-5
            [&_li]:list-disc [&_li]:text-[14.5px] [&_li]:font-light [&_li]:leading-[1.7] [&_li]:text-muted
            [&_a]:text-brand-300 [&_a]:underline-offset-4 hover:[&_a]:underline
          "
        >
          {children}
        </article>
      </main>

      <footer className="border-t border-white/[0.07] px-6 py-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between text-[12px] text-subtle">
          <span>© {new Date().getFullYear()} Hi-Astrix</span>
          <span className="flex gap-5">
            <Link href="/terms" className="transition-colors hover:text-muted">Terms</Link>
            <Link href="/privacy" className="transition-colors hover:text-muted">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
