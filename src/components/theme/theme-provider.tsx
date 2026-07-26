"use client"

/**
 * Theme provider — system / light / dark.
 *
 * No dependency. next-themes would be ~3kB and a hydration story for something
 * that is four lines of DOM work.
 *
 * The provider does NOT drive first paint. `themeInitScript` runs blocking in
 * <head> and sets the attribute before React exists; the provider then adopts
 * whatever it decided. That ordering is what prevents a flash of the wrong
 * theme, which reads as a bug rather than a preference.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

/** Namespaced so it can't collide with another app on the same origin. */
export const THEME_STORAGE_KEY = "hiastrix.theme"

export type ThemeSetting = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

type ThemeContextValue = {
  theme: ThemeSetting
  resolved: ResolvedTheme
  setTheme: (next: ThemeSetting) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches

function readStored(): ThemeSetting {
  if (typeof window === "undefined") return "system"
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") return stored
  } catch {
    // Private browsing or blocked storage — fall back to system rather than throw.
  }
  return "system"
}

/** The entire DOM contract. */
function apply(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.setAttribute("data-theme", resolved)
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSetting>("system")
  const [resolved, setResolved] = useState<ResolvedTheme>("dark")

  // Adopt what the blocking script already decided.
  useEffect(() => {
    const stored = readStored()
    setThemeState(stored)
    setResolved(stored === "system" ? (systemPrefersDark() ? "dark" : "light") : stored)
  }, [])

  // Follow the OS for as long as the setting is "system".
  useEffect(() => {
    if (theme !== "system") return
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const next: ResolvedTheme = query.matches ? "dark" : "light"
      setResolved(next)
      apply(next)
    }
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = useCallback((next: ThemeSetting) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Preference simply won't persist; the session still switches.
    }
    const nextResolved: ResolvedTheme =
      next === "system" ? (systemPrefersDark() ? "dark" : "light") : next
    setResolved(nextResolved)
    apply(nextResolved)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>")
  return ctx
}

/**
 * Applies the stored theme before first paint.
 *
 * Inlined and render-blocking on purpose. Deferring it means the page paints
 * dark and then snaps to light, which every user reads as a glitch.
 */
export const themeInitScript = `
(function(){
  try {
    var s = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
    var dark = s === 'dark' || (s === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var t = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`.trim()
