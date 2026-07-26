import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Hi-Astrix",
    template: "%s · Hi-Astrix",
  },
  description: "AI voice calling platform — deploy agents under your own brand.",
  // No `icons` key on purpose: Next's file convention picks up
  // `src/app/icon.svg` (the Signal Arc mark) automatically. An explicit path
  // here would override that and win even if the file it points at is missing.
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-ink text-fg">{children}</body>
    </html>
  )
}
