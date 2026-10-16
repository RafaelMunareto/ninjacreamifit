import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import type { FoodReference, LocalFood, Nutrition } from "../types"
import {
  calculateNutrition,
  foodDescriptions,
  foodReferences,
  hasCompleteNutrition,
  loadFoodCatalog,
  searchFoods,
} from "../lib/nutrition.js"
import Icon from "./Icon"

type FoodLine = {
  key: string
  food: LocalFood
  grams: string
}
type Catalog = Awaited<ReturnType<typeof loadFoodCatalog>>
type Props = {
  initialItems: FoodReference[]
  initialLabels: string[]
  onRestore: (lines: string[]) => void
  onChange: (
    items: FoodReference[],
    lines: string[],
    totals: Nutrition | null,
  ) => void
  onDetach: () => void
}

const display = (value: number | null) =>
  value === null ? "não informado" : value.toLocaleString("pt-BR")

export default function FoodCalculator({
  initialItems,
  initialLabels,
  onRestore,
  onChange,
  onDetach,
}: Props) {
  const initial = useRef(initialItems).current
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [items, setItems] = useState<FoodLine[]>([])
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [limit, setLimit] = useState(20)
  const [error, setError] = useState("")
  const [restoreError, setRestoreError] = useState("")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError("")
    setRestoreError("")
    void loadFoodCatalog()
      .then((data) => {
        if (cancelled) return
        setCatalog(data)
        const restored: FoodLine[] = []
        for (const reference of initial) {
          const food = data.byId.get(reference.foodId)
          if (!food || !hasCompleteNutrition(food)) {
            setRestoreError(
              "Um alimento salvo não está disponível para cálculo nesta base. Os ingredientes e macros da receita foram preservados.",
            )
            return
          }
          restored.push({
            key: crypto.randomUUID(),
            food,
            grams: String(reference.grams),
          })
        }
        setItems(restored)
        if (restored.length) onRestore(foodDescriptions(restored))
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Não foi possível carregar a tabela de alimentos. Tente novamente ou preencha os dados manualmente.",
          )
      })
    return () => {
      cancelled = true
    }
  }, [initial, onRestore, retry])

  const results = useMemo(
    () =>
      catalog
        ? searchFoods(catalog, deferredQuery, limit)
        : { foods: [], total: 0 },
    [catalog, deferredQuery, limit],
  )
  const publish = (updated: FoodLine[]) => {
    setItems(updated)
    onChange(
      foodReferences(updated),
      foodDescriptions(updated),
      updated.length ? calculateNutrition(updated) : null,
    )
  }
  const add = (food: LocalFood) => {
    if (items.length >= 50 || !hasCompleteNutrition(food)) return
    publish([...items, { key: crypto.randomUUID(), food, grams: "100" }])
    setQuery("")
    setLimit(20)
  }

  return (
    <section
      aria-label="Calculadora de alimentos"
      className="rounded-3xl border border-[#eadfd5] bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-black">
          Alimentos e peso do pote
        </h3>
        <span className="rounded-full bg-[#eef8dd] px-3 py-1 text-[11px] font-extrabold text-[#52642f]">
          Tabela brasileira · TBCA
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[#78665b]">
        Escolha cada alimento e informe o peso em gramas. Calorias e macros
        serão somados automaticamente, incluindo os toppings que você adicionar
        aqui.
      </p>
      {!catalog && !error && (
        <p role="status" className="mt-4 text-sm text-[#78665b]">
          Carregando a tabela de alimentos…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-[#fff6d8] p-3 text-sm text-[#78665b]"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="mt-2 font-bold underline"
          >
            Tentar novamente
          </button>
        </div>
      )}
      {restoreError && (
        <div className="mt-4 rounded-2xl bg-[#fff6d8] p-4 text-sm text-[#78665b]">
          <p>{restoreError}</p>
          <ul className="mt-2 space-y-1">
            {initialLabels.map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onDetach}
            className="mt-3 font-bold underline"
          >
            Editar estes ingredientes manualmente
          </button>
        </div>
      )}
      {catalog && !restoreError && (
        <>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-extrabold">
              Buscar alimento
            </span>
            <div className="flex items-center gap-3 rounded-2xl border border-[#e5d8cc] bg-[#fffaf3] px-4">
              <Icon name="search" size={18} />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setLimit(20)
                }}
                maxLength={100}
                placeholder="Ex: banana, leite desnatado, cacau…"
                className="min-w-0 flex-1 bg-transparent py-3.5 text-sm outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault()
                }}
              />
            </div>
          </label>
          {query.trim().length < 2 && (
            <p className="mt-2 text-xs text-[#8a776b]">
              Digite pelo menos 2 letras. Você pode combinar palavras, como
              “leite desnatado”.
            </p>
          )}
          {query.trim().length >= 2 && (
            <p role="status" className="mt-3 text-xs text-[#8a776b]">
              {results.total
                ? `${results.total.toLocaleString("pt-BR")} alimentos encontrados`
                : "Nenhum alimento encontrado. Tente outro nome ou use o preenchimento manual abaixo."}
            </p>
          )}
          {!!results.foods.length && (
            <ul
              aria-label="Resultados de alimentos"
              className="mt-3 max-h-80 space-y-2 overflow-y-auto overscroll-contain"
            >
              {results.foods.map((food) => {
                const complete = hasCompleteNutrition(food)
                return (
                  <li key={food.id}>
                    <button
                      type="button"
                      disabled={!complete || items.length >= 50}
                      onClick={() => add(food)}
                      aria-label={`Adicionar ${food.name}`}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#eadfd5] p-3 text-left transition hover:border-[#ef4f78] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <strong className="block break-words text-sm">
                          {food.name}
                        </strong>
                        <span className="mt-1 block text-[11px] text-[#8a776b]">
                          {food.category} · {food.id}
                        </span>
                        <span className="mt-1 block text-xs text-[#78665b]">
                          {complete
                            ? `Por 100 g: ${display(food.calories)} kcal · P ${display(food.protein)} g · C ${display(food.carbs)} g · G ${display(food.fat)} g`
                            : "Dados incompletos na base · preencha manualmente"}
                        </span>
                      </span>
                      {complete && (
                        <span className="shrink-0 text-[#ef4f78]">
                          <Icon name="plus" />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {results.total > limit && (
            <button
              type="button"
              onClick={() => setLimit((value) => value + 20)}
              className="mt-3 rounded-full border border-[#eadfd5] px-4 py-2 text-xs font-bold"
            >
              Mostrar mais alimentos
            </button>
          )}
          {!!items.length && (
            <ul aria-label="Alimentos do pote" className="mt-5 space-y-3">
              {items.map((item, index) => {
                const nutrition = calculateNutrition([item])
                return (
                  <li key={item.key} className="rounded-2xl bg-[#fffaf3] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block break-words text-sm">
                          {item.food.name}
                        </strong>
                        <span className="text-[11px] text-[#8a776b]">
                          {item.food.id}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          publish(
                            items.filter((_, position) => position !== index),
                          )
                        }
                        aria-label={`Remover ${item.food.name}`}
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#b92e53]"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-xs font-bold">
                      Peso (g)
                      </span>
                      <input
                        type="number"
                      aria-label={`Peso (g) · ${item.food.name}`}
                        name={`food_grams_${index}`}
                        required
                        min={0.01}
                        max={10000}
                        step="any"
                        value={item.grams}
                        onChange={(event) =>
                          publish(
                            items.map((row, position) =>
                              position === index
                                ? { ...row, grams: event.target.value }
                                : row,
                            ),
                          )
                        }
                        className="form-input bg-white"
                      />
                    </label>
                    {nutrition && (
                      <p className="mt-2 text-xs leading-relaxed text-[#78665b]">
                        {display(nutrition.calories)} kcal · P{" "}
                        {display(nutrition.protein)} g · C{" "}
                        {display(nutrition.carbs)} g · G{" "}
                        {display(nutrition.fat)} g
                      </p>
                    )}
                    {!!item.food.traces?.length && (
                      <p className="mt-1 text-xs text-[#8a776b]">
                        A base indica traços em parte dos nutrientes; o cálculo
                        considera esses traços como aproximadamente zero.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {items.length >= 50 && (
            <p role="status" className="mt-3 text-xs text-[#78665b]">
              Limite de 50 alimentos por receita.
            </p>
          )}
        </>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-[#8a776b]">
        Porções da base: 100 g. Carboidratos totais. Fonte: TBCA, via{" "}
        <a
          href="https://github.com/raul-rznd/web-scraping-tbca"
          target="_blank"
          rel="noreferrer"
          className="font-bold underline"
        >
          arquivo de raul-rznd
        </a>
        . A busca e os cálculos acontecem neste aparelho.
      </p>
    </section>
  )
}
