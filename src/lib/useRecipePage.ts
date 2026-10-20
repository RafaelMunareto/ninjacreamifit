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

export default function useRecipePage() {
  const route = useSyncExternalStore(
    subscribe,
    () => window.location.pathname + window.location.search,
    () => "/",
  )
  const url = new URL(route, window.location.origin)
  const pathname = url.pathname.replace(/\/$/, "")
  const isNewRecipePage = pathname === newRecipePath
  const editingRecipeId =
    /^\/receitas\/([a-zA-Z0-9-]+)\/editar$/.exec(pathname)?.[1] ?? null
  const fromAdmin = url.searchParams.get("origem") === "administracao"

  function open(path: string, admin = false) {
    window.history.pushState(
      { creamiRecipePage: true },
      "",
      path + (admin ? "?origem=administracao" : ""),
    )
    window.dispatchEvent(new Event(navigationEvent))
  }

  return {
    isNewRecipePage,
    isRecipePage: isNewRecipePage || editingRecipeId !== null,
    editingRecipeId,
    fromAdmin,
    openNewRecipe() {
      if (isNewRecipePage) return
      open(newRecipePath)
    },
    openEditRecipe(id: string, admin = false) {
      open(`/receitas/${encodeURIComponent(id)}/editar`, admin)
    },
    closeRecipePage() {
      if (window.history.state?.creamiRecipePage) window.history.back()
      else replaceWithHome()
    },
    finishRecipePage: replaceWithHome,
  }
}
