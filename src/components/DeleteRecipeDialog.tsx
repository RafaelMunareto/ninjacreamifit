import { useRef, useState } from "react"
import type { Recipe } from "../types"
import { errorMessage } from "../lib/api.js"
import Modal from "./Modal"

export default function DeleteRecipeDialog({
  recipe,
  onClose,
  onDelete,
}: {
  recipe: Recipe
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const locked = useRef(false)
  const confirm = async () => {
    if (locked.current) return
    locked.current = true
    setPending(true)
    setError("")
    try {
      await onDelete()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  return (
    <Modal
      titleId="delete-own-recipe-title"
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <div className="p-6 sm:p-9">
        <h2
          id="delete-own-recipe-title"
          className="font-display text-2xl font-black"
        >
          Excluir minha receita?
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          A receita <strong>{recipe.title}</strong> será excluída do site junto
          com suas avaliações e favoritos. Essa ação não pode ser desfeita.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-sm font-bold text-[#b92e53]">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            disabled={pending}
            onClick={() => void confirm()}
            className="rounded-full bg-[#d63f68] px-6 py-3 text-sm font-bold text-white"
          >
            {pending ? "Excluindo…" : "Confirmar exclusão"}
          </button>
          <button
            disabled={pending}
            onClick={onClose}
            className="rounded-full border border-outline bg-surface px-6 py-3 text-sm font-bold"
          >
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}
