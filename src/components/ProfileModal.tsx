import { useRef, useState, type FormEvent } from "react"
import type { Profile, Recipe } from "../types"
import { errorMessage } from "../lib/local-api.js"
import Modal from "./Modal"
import Icon from "./Icon"

export default function ProfileModal({
  profile,
  recipes,
  onClose,
  onSave,
  onCollection,
  onAdmin,
}: {
  profile: Profile
  recipes: Recipe[]
  onClose: () => void
  onSave: (name: string) => Promise<void>
  onCollection: (collection: "favorites" | "mine") => void
  onAdmin: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const locked = useRef(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked.current) return
    const data = new FormData(event.currentTarget)
    locked.current = true
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      await onSave(String(data.get("name") || ""))
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      locked.current = false
      setSaving(false)
    }
  }
  return (
    <Modal
      titleId="profile-title"
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <div className="p-6 sm:p-9">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ef4f78]">
              seu cantinho cremoso
            </p>
            <h2
              id="profile-title"
              className="mt-2 font-display text-3xl font-black"
            >
              Meu perfil
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white"
            aria-label="Fechar perfil"
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[#78665b]">
          Basta escolher seu nome para criar receitas. Em Minhas receitas, você
          pode editar e excluir o que enviou, sem senha. Seu perfil e suas
          receitas serão lembrados neste navegador.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-extrabold">
              Seu nome nas receitas
            </span>
            <input
              name="name"
              required
              maxLength={60}
              defaultValue={profile.name === "Você" ? "" : profile.name}
              placeholder="Como você quer aparecer nas receitas?"
              onChange={() => setSaved(false)}
              className="form-input"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[#342820] px-6 py-3 text-sm font-extrabold text-white"
          >
            {saving ? "Salvando…" : "Salvar perfil"}
          </button>
          {error && (
            <p role="alert" className="text-sm font-bold text-[#b92e53]">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm font-bold text-[#52642f]">
              Perfil salvo!
            </p>
          )}
        </form>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            disabled={saving}
            onClick={() => onCollection("mine")}
            className="rounded-3xl bg-[#b8e46c] p-5 text-left"
          >
            <strong className="block font-display text-3xl font-black">
              {
                recipes.filter((recipe) => recipe.authorId === profile.id)
                  .length
              }
            </strong>
            <span className="mt-1 block text-sm font-extrabold">
              Minhas receitas →
            </span>
          </button>
          <button
            disabled={saving}
            onClick={() => onCollection("favorites")}
            className="rounded-3xl bg-[#ffadc4] p-5 text-left"
          >
            <strong className="block font-display text-3xl font-black">
              {recipes.filter((recipe) => recipe.isFavorite).length}
            </strong>
            <span className="mt-1 block text-sm font-extrabold">
              Meus favoritos →
            </span>
          </button>
        </div>
        <div className="mt-6 border-t border-[#e7d9ce] pt-5">
          <button
            disabled={saving}
            onClick={onAdmin}
            className="flex w-full items-center justify-between rounded-2xl bg-[#342820] px-5 py-4 text-sm font-extrabold text-white"
          >
            Administração <Icon name="arrow" size={18} />
          </button>
          <p className="mt-2 text-xs text-[#8a776b]">
            Acesso com senha para gerenciar todas as receitas e os totais de
            avaliações.
          </p>
        </div>
      </div>
    </Modal>
  )
}
