import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

const input = process.argv[2]
if (!input) {
  console.error("Uso: node scripts/import-fatsecret.mjs caminho/para/export.csv")
  process.exit(1)
}

const parseCsv = (text) => {
  const rows = []
  let row = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (char === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
    } else cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    if (row.some((value) => value.trim())) rows.push(row)
  }
  return rows
}

const number = (value) => {
  const parsed = Number(String(value ?? "").replace(",", "."))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

// FatSecretData exports a CSV whose cells contain Python dictionaries using
// single quotes. This extracts the known fields without executing the file.
const fieldFromPythonDict = (value, key) => {
  const match = String(value).match(
    new RegExp(`['"]${key}['"]\\s*:\\s*['"]([\\s\\S]*?)['"](?=\\s*,\\s*['"]\\w+['"]\\s*:|\\s*}$)`),
  )
  return match?.[1]?.replace(/\\(['"])/g, "$1") || ""
}

const field = (headers, values, names, rawFallback = "") => {
  for (const name of names) {
    const index = headers.findIndex(
      (header) => header.trim().toLowerCase() === name,
    )
    if (index >= 0 && values[index]?.trim()) return values[index].trim()
  }
  for (const name of names) {
    const value = fieldFromPythonDict(rawFallback, name)
    if (value) return value
  }
  return ""
}

const text = await readFile(resolve(input), "utf8")
const rows = parseCsv(text)
if (rows.length < 2) throw new Error("O CSV não possui registros.")
const looksLikeNumberedExport = rows[0].every((value, index) => value.trim() === String(index))
const headers = looksLikeNumberedExport ? [] : rows.shift().map((value) => value.trim())
const foods = new Map()
for (const values of rows) {
  const raw = values.join(",")
  const name = field(headers, values, ["food_entry_name", "food_name", "name", "food"], raw)
  if (!name) continue
  const idValue = field(headers, values, ["food_id", "id"], raw)
  const id = `FATSECRET:${idValue || createHash("sha1").update(name.toLocaleLowerCase()).digest("hex").slice(0, 16)}`
  const calories = number(field(headers, values, ["calories", "energy_kcal"], raw))
  const protein = number(field(headers, values, ["protein", "proteins"], raw))
  const carbs = number(field(headers, values, ["carbohydrate", "carbohydrates", "carbs"], raw))
  const fat = number(field(headers, values, ["fat", "fats"], raw))
  if ([calories, protein, carbs, fat].some((value) => value === null)) continue
  let amount = number(
    field(headers, values, ["metric_serving_amount", "serving_size"], raw),
  )
  if (!amount) {
    const description = field(
      headers,
      values,
      ["food_entry_description", "serving_description"],
      raw,
    )
    const amountMatch = description.match(
      /(\d+(?:[.,]\d+)?)\s*(kg|g|ml)\b/i,
    )
    if (amountMatch) {
      amount = number(amountMatch[1])
      if (amount && amountMatch[2].toLowerCase() === "kg") amount *= 1000
    }
  }
  // An entry with only "1 serving" does not tell us the serving's weight.
  // Do not add a misleading per-100-g food to the local catalog.
  if (!amount || amount <= 0) continue
  const scale = 100 / amount
  foods.set(id, {
    id,
    name,
    category: "FatSecret importado",
    source: "FatSecret",
    calories: Math.round(calories * scale * 100) / 100,
    protein: Math.round(protein * scale * 100) / 100,
    carbs: Math.round(carbs * scale * 100) / 100,
    fat: Math.round(fat * scale * 100) / 100,
  })
}
if (!foods.size) throw new Error("Nenhum alimento com calorias e macros completos foi encontrado.")
const output = {
  version: 1,
  source: { name: "FatSecret export", importedFrom: basename(input), basisGrams: 100 },
  foods: [...foods.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
}
await writeFile(
  new URL("../public/data/fatsecret-foods-v1.json", import.meta.url),
  `${JSON.stringify(output)}\n`,
)
console.log(`Importados ${foods.size} alimentos para public/data/fatsecret-foods-v1.json`)
