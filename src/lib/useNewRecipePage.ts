import { useSyncExternalStore } from "react"

const newRecipePath = "/receitas/nova"
const navigationEvent = "creami:navigation"

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange)
  window.addEventListener(navigationEvent, onChange)
  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(navigationEvent, onChange)
  }
}

function replaceWithHome() {
  window.history.replaceState(null, "", "/")
  window.dispatchEvent(new Event(navigationEvent))
  window.scrollTo({ top: 0 })
}

export default function useNewRecipePage() {
  const isNewRecipePage = useSyncExternalStore(
    subscribe,
    () => window.location.pathname.replace(/\/$/, "") === newRecipePath,
    () => false,
  )

  return {
    isNewRecipePage,
    openNewRecipe() {
      if (isNewRecipePage) return
      window.history.pushState({ creamiRecipePage: true }, "", newRecipePath)
      window.dispatchEvent(new Event(navigationEvent))
    },
    closeRecipePage() {
      if (window.history.state?.creamiRecipePage) window.history.back()
      else replaceWithHome()
    },
    finishRecipePage: replaceWithHome,
  }
}
