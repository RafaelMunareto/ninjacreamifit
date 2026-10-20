import { useSyncExternalStore } from "react"

export type ThemePreference = "system" | "light" | "dark"
const storageKey = "ninja-creami-fit-theme"
const themeEvent = "creami:theme"
const media = window.matchMedia("(prefers-color-scheme: dark)")
function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey)
    if (value === "light" || value === "dark") return value
  } catch {
    /* The system theme remains available when storage is restricted. */
  }
  return "system"
}
let preference = readPreference()
function applyTheme() {
  const theme =
    preference === "system" ? (media.matches ? "dark" : "light") : preference
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement("meta")
    meta.name = "theme-color"
    document.head.append(meta)
  }
  meta.content = theme === "dark" ? "#101722" : "#fffaf3"
}
export function initializeTheme() {
  applyTheme()
  media.addEventListener("change", applyTheme)
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return
    preference = readPreference()
    applyTheme()
    window.dispatchEvent(new Event(themeEvent))
  })
}
function subscribe(listener: () => void) {
  window.addEventListener(themeEvent, listener)
  return () => window.removeEventListener(themeEvent, listener)
}
export function useTheme() {
  const value = useSyncExternalStore(subscribe, () => preference)
  return [
    value,
    (next: ThemePreference) => {
      preference = next
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        /* Apply for this session. */
      }
      applyTheme()
      window.dispatchEvent(new Event(themeEvent))
    },
  ] as const
}
