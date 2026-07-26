import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { ThemeProvider, themeInitScript } from "@/components/theme/theme-provider"
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

/** Browser chrome follows the theme, so the address bar doesn't clash. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)",  color: "#07070A" },
    { media: "(prefers-color-scheme: light)", color: "#FBFAFF" },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // SSR default; the inline script below overwrites it before first paint.
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // The script mutates <html> before React hydrates, which React would
      // otherwise report as a mismatch.
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose — see themeInitScript. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-ink font-sans text-fg">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
