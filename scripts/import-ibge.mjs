import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { parseNutrient } from "./import-tbca.mjs"

export const sourceCommit = "c5eccf85aabf7bfaea9f9033e38b0a74665770c4"
export const sourceUrl = `https://raw.githubusercontent.com/renandspedrosa/tabela-taco-api/${sourceCommit}/database/seeders/scripts/ibge.sql`

// Parse data literals only. Never execute SQL downloaded from a third party.
export function parseRows(sql) {
  const rows = []
  const inserts = sql.matchAll(
    /INSERT INTO `ibges` \(([^)]+)\) VALUES\s*([\s\S]*?);/g,
  )
  for (const insert of inserts) {
    const columns = [...insert[1].matchAll(/`([^`]+)`/g)].map(
      (match) => match[1],
    )
    const tokens =
      insert[2].match(/'(?:[^'\\]|\\.|'')*'|NULL|\d+|[(),]|\s+|./gs) || []
    let row = null
    let expectValue = true
    for (const token of tokens) {
      if (/^\s+$/.test(token)) continue
      if (token === "(" && row === null) {
        row = []
        expectValue = true
        continue
      }
      if (token === ",") {
        if (row) {
          if (expectValue) throw new Error("Valor SQL ausente.")
          expectValue = true
        }
        continue
      }
      if (token === ")" && row && !expectValue) {
        if (row.length !== columns.length)
          throw new Error("Colunas IBGE inconsistentes.")
        rows.push(
          Object.fromEntries(
            columns.map((column, index) => [column, row[index]]),
          ),
        )
        row = null
        continue
      }
      if (!row || !expectValue) throw new Error("Formato SQL IBGE inválido.")
      if (token === "NULL") row.push(null)
      else if (/^\d+$/.test(token)) row.push(token)
      else if (token.startsWith("'") && token.endsWith("'"))
        row.push(
          token
            .slice(1, -1)
            .replace(/''/g, "'")
            .replace(/\\(['\\])/g, "$1"),
        )
      else throw new Error("Literal SQL IBGE inválido.")
      expectValue = false
    }
    if (row) throw new Error("Registro IBGE incompleto.")
  }
  if (!rows.length) throw new Error("A base IBGE está vazia.")
  return rows
}

export function convertFood(row) {
  const code = String(row.Codigo)
  const preparation =
    row.Codigo_de_preparacao === null ? "na" : String(row.Codigo_de_preparacao)
  if (
    !/^\d{1,10}$/.test(code) ||
    !/^(na|\d{1,3})$/.test(preparation) ||
    !row.descricacao_do_alimento?.trim()
  )
    throw new Error("Código ou descrição IBGE inválidos.")
  const detail = row.descricao_da_preparacao?.trim()
  const food = {
    id: `IBGE:${code}:${preparation}`,
    name:
      row.descricacao_do_alimento.trim() +
      (detail && detail !== "Não se aplica" ? ` · ${detail}` : ""),
    category: row.Categoria?.trim() || "",
    source: "IBGE",
  }
  const traces = []
  for (const [key, column] of Object.entries({
    calories: "Energia_kcal",
    protein: "Proteina_g",
    fat: "Lipidios_totais_g",
    carbs: "Carboi_drato_g",
  })) {
    const result = parseNutrient(row[column])
    food[key] = result.value
    if (result.trace) traces.push(key)
  }
  if (traces.length) food.traces = traces
  return food
}

export function convertCatalog(sql) {
  const foods = parseRows(sql).map(convertFood)
  if (new Set(foods.map((food) => food.id)).size !== foods.length)
    throw new Error("Códigos IBGE e preparações repetidos.")
  foods.sort((a, b) => a.id.localeCompare(b.id))
  return {
    version: 1,
    source: {
      name: "IBGE",
      repository: "https://github.com/renandspedrosa/tabela-taco-api",
      commit: sourceCommit,
      sha256: createHash("sha256").update(sql).digest("hex"),
      basisGrams: 100,
      reference:
        "https://biblioteca.ibge.gov.br/visualizacao/livros/liv50002.pdf",
    },
    foods,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let sql
  if (process.argv[2]) sql = await readFile(process.argv[2], "utf8")
  else {
    const response = await fetch(sourceUrl)
    if (!response.ok)
      throw new Error(`Falha ao baixar o IBGE (${response.status}).`)
    sql = await response.text()
  }
  const catalog = convertCatalog(sql)
  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true })
  await writeFile(
    new URL("../public/data/ibge-foods-v1.json", import.meta.url),
    JSON.stringify(catalog) + "\n",
  )
  console.log(
    JSON.stringify({
      foods: catalog.foods.length,
      complete: catalog.foods.filter((food) =>
        [food.calories, food.protein, food.carbs, food.fat].every(
          (value) => value !== null,
        ),
      ).length,
    }),
  )
}
