import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"

export const sourceCommit = "467b7b06c9420ab5f9f0ba92167f1235b5cf1f03"
export const sourceUrl = `https://raw.githubusercontent.com/raul-rznd/web-scraping-tbca/${sourceCommit}/alimentos.txt`
const nutrients = {
  calories: ["Energia", "kcal"],
  protein: ["Proteína", "g"],
  carbs: ["Carboidrato total", "g"],
  fat: ["Lipídios", "g"],
}

export function parseNutrient(value) {
  const text = String(value ?? "").trim()
  if (text.toLowerCase() === "tr") return { value: 0, trace: true }
  if (!/^\d+(?:[,.]\d+)?$/.test(text)) return { value: null, trace: false }
  const parsed = Number(text.replace(",", "."))
  return { value: Number.isFinite(parsed) ? parsed : null, trace: false }
}

export function convertFood(row) {
  if (
    !/^[A-Z]\d{4}[A-Z]$/.test(row.codigo) ||
    typeof row.descricao !== "string" ||
    !Array.isArray(row.nutrientes)
  )
    throw new Error("Registro TBCA inválido.")
  const food = {
    id: row.codigo,
    name: row.descricao.trim().replace(/,+$/, ""),
    category: String(row.classe || ""),
  }
  const traces = []
  for (const [key, [name, unit]] of Object.entries(nutrients)) {
    const values = row.nutrientes
      .filter((entry) => entry.Componente === name && entry.Unidades === unit)
      .map((entry) => parseNutrient(entry["Valor por 100g"]))
    const distinct = new Set(
      values.map((entry) => `${entry.value}:${entry.trace}`),
    )
    // Identical repeated rows can be merged. Conflicting or absent values stay unknown.
    const result =
      distinct.size === 1 ? values[0] : { value: null, trace: false }
    food[key] = result.value
    if (result.trace) traces.push(key)
  }
  if (traces.length) food.traces = traces
  return food
}

export function convertCatalog(text) {
  const foods = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => convertFood(JSON.parse(line)))
  if (
    !foods.length ||
    new Set(foods.map((food) => food.id)).size !== foods.length
  )
    throw new Error("A base TBCA contém códigos repetidos ou está vazia.")
  foods.sort((a, b) => a.id.localeCompare(b.id))
  return {
    version: 1,
    source: {
      name: "TBCA",
      repository: "https://github.com/raul-rznd/web-scraping-tbca",
      commit: sourceCommit,
      sha256: createHash("sha256").update(text).digest("hex"),
      basisGrams: 100,
      carbohydrate: "total",
    },
    foods,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let text
  if (process.argv[2]) text = await readFile(process.argv[2], "utf8")
  else {
    const response = await fetch(sourceUrl)
    if (!response.ok)
      throw new Error(`Não foi possível baixar a TBCA (${response.status}).`)
    text = await response.text()
  }
  const catalog = convertCatalog(text)
  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true })
  const destination = new URL(
    "../public/data/tbca-foods-v1.json",
    import.meta.url,
  )
  const content = JSON.stringify(catalog)
  await writeFile(destination, content + "\n")
  const complete = catalog.foods.filter((food) =>
    Object.keys(nutrients).every((key) => food[key] !== null),
  ).length
  console.log(
    JSON.stringify({
      foods: catalog.foods.length,
      complete,
      incomplete: catalog.foods.length - complete,
      bytes: Buffer.byteLength(content),
    }),
  )
}
