import { useDeferredValue, useEffect, useRef, useState } from "react"
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser"
import type { FoodReference, LocalFood, Nutrition } from "../types"
import {
  calculateNutrition,
  foodDescriptions,
  foodReferences,
  hasCompleteNutrition,
  loadFoodCatalog,
  searchFoodApi,
  restoreApiFoods,
  searchFoodsWithFallback,
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
  const source = "all"
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [limit, setLimit] = useState(20)
  const [results, setResults] =
    useState<Awaited<ReturnType<typeof searchFoodsWithFallback>>>({
      foods: [],
      total: 0,
      source: "TBCA",
      fallback: false,
    })
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanStreamRef = useRef<MediaStream | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const [error, setError] = useState("")
  const [restoreError, setRestoreError] = useState("")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setError("")
    setRestoreError("")
    void loadFoodCatalog()
      .then(async (data) => {
        const missing = initial
          .filter((item) => !data.byId.has(item.foodId))
          .map((item) => item.foodId)
        const restoredFoods = await restoreApiFoods(missing, controller.signal)
        const available = new Map(data.byId)
        for (const food of restoredFoods) available.set(food.id, food)
        if (cancelled) return
        setCatalog(data)
        const restored: FoodLine[] = []
        for (const reference of initial) {
          const food = available.get(reference.foodId)
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
      controller.abort()
    }
  }, [initial, onRestore, retry])

  useEffect(() => {
    if (!catalog) return
    const controller = new AbortController()
    let active = true
    setSearchError("")
    setResults({ foods: [], total: 0, source: "TBCA", fallback: false })
    const valid = deferredQuery.trim().length >= 2
    setSearching(valid)
    const timer = window.setTimeout(
      () => {
        void searchFoodsWithFallback(
          catalog,
          deferredQuery,
          limit,
          source,
          (term, count) => searchFoodApi(term, count, controller.signal),
        )
          .then((data) => {
            if (active) setResults(data)
          })
          .catch(() => {
            if (active)
              setSearchError(
                "A busca complementar está indisponível. Tente outro nome ou preencha manualmente.",
              )
          })
          .finally(() => {
            if (active) setSearching(false)
          })
      },
      valid ? 300 : 0,
    )
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [catalog, deferredQuery, limit, source])
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

  const scanBarcode = async () => {
    const video = videoRef.current
    if (!video) return
    setSearchError("")
    setScanning(true)
    try {
      const reader = new BrowserMultiFormatReader()
      scannerControlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result, _error, controls) => {
          const value = result?.getText().trim()
          if (!value) return
          controls.stop()
          scannerControlsRef.current = null
          scanStreamRef.current?.getTracks().forEach((track) => track.stop())
          scanStreamRef.current = null
          setQuery(value)
          setScanning(false)
        },
      )
    } catch {
      scannerControlsRef.current = null
      setSearchError(
        "Não foi possível acessar a câmera. Confira a permissão ou digite o código manualmente.",
      )
      setScanning(false)
    }
  }
  const closeScanner = () => {
    scannerControlsRef.current?.stop()
    scannerControlsRef.current = null
    scanStreamRef.current?.getTracks().forEach((track) => track.stop())
    scanStreamRef.current = null
    setScanning(false)
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
          TBCA + IBGE
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void scanBarcode()}
              className="rounded-full bg-[#ef4f78] px-4 py-2.5 text-xs font-bold text-white"
            >
              {scanning ? "Lendo código…" : "Ler código de barras"}
            </button>
            <button
              type="button"
              disabled
              className="rounded-full border border-[#e5d8cc] bg-white px-4 py-2.5 text-xs font-bold text-[#8a776b]"
            >
              Identificar por foto (IA) · em breve
            </button>
          </div>
          <div
            className={`relative mt-3 overflow-hidden rounded-2xl bg-black ${
              scanning ? "" : "hidden"
            }`}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-video w-full object-cover"
              aria-label="Câmera para leitura do código de barras"
            />
            <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-20 -translate-y-1/2 rounded-xl border-2 border-[#b8e46c] shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
            <button
              type="button"
              onClick={closeScanner}
              className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-2 text-xs font-bold text-white"
            >
              Fechar câmera
            </button>
          </div>
          {query.trim().length < 2 && (
            <p className="mt-2 text-xs text-[#8a776b]">
              Digite pelo menos 2 letras. Você pode combinar palavras, como
              “leite desnatado”.
            </p>
          )}
          {query.trim().length >= 2 && (
            <p role="status" className="mt-3 text-xs text-[#8a776b]">
              {searching
                ? "Buscando alimento…"
                : searchError
                  ? searchError
                  : results.total
                    ? `${results.total.toLocaleString("pt-BR")} alimentos encontrados`
                    : "Nenhum alimento encontrado. Tente outro nome ou use o preenchimento manual abaixo."}
            </p>
          )}
          {!searching &&
            !searchError &&
            results.fallback &&
            results.total > 0 && (
              <p role="status" className="mt-2 text-xs text-[#78665b]">
                Resultados da busca complementar:{" "}
                {results.source === "IBGE" ? "da API IBGE" : "da TBCA"}.
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
                      aria-label={`Adicionar ${food.name} · ${food.source || "TBCA"}`}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#eadfd5] p-3 text-left transition hover:border-[#ef4f78] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <strong className="block break-words text-sm">
                          {food.name}
                        </strong>
                        <span className="mt-1 block text-[11px] text-[#8a776b]">
                          {food.source || "TBCA"} · {food.category} · {food.id}
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
                          {item.food.source || "TBCA"} · {item.food.id}
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
        Valores por 100 g da parte comestível. Escolha a preparação
        correspondente ao alimento pesado. Fontes: TBCA, via{" "}
        <a
          href="https://github.com/raul-rznd/web-scraping-tbca"
          target="_blank"
          rel="noreferrer"
          className="font-bold underline"
        >
          arquivo de raul-rznd
        </a>
        , e IBGE, via{" "}
        <a
          href="https://github.com/renandspedrosa/tabela-taco-api"
          target="_blank"
          rel="noreferrer"
          className="font-bold underline"
        >
          tabela-taco-api
        </a>
        . A busca tenta a TBCA primeiro e consulta a API IBGE do site quando
        necessário. O cálculo por peso acontece neste aparelho. As bases podem
        apresentar valores diferentes para alimentos semelhantes.
      </p>
    </section>
  )
}
