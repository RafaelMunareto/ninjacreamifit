import { mkdir, writeFile, readFile, chmod } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { parseEnv } from "node:util"
import { createBlobStorage, createFileStorage } from "./legacy-server/storage.js"

// Only reads the source. The export includes private profile hashes and must stay outside Git/public.
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const index = argument.indexOf("=")
  return index < 0 ? [argument.replace(/^--/, ""), true] : [argument.slice(2, index), argument.slice(index + 1)]
}))
if (!options.output || !["local", "blob"].includes(options.source))
  throw new Error("Use --source=local|blob --output=/caminho/privado/export.json [--dataset=production --env-file=.env.migration.local]")
let environment = { ...process.env }
if (options["env-file"]) {
  const values = parseEnv(await readFile(resolve(options["env-file"]), "utf8"))
  for (const [key, value] of Object.entries(values)) if (value && value !== "[SENSITIVE]") environment[key] = value
}
if (options.source === "blob" && !options.dataset) throw new Error("Escolha explicitamente --dataset para exportar o Blob.")
const storage = options.source === "blob"
  ? createBlobStorage({ ...environment, CREAMI_DATASET: options.dataset })
  : createFileStorage(resolve(options.directory || ".data/development"))
const { state } = await storage.read()
if (!state) throw new Error("O catálogo de origem não existe; nenhum arquivo foi exportado.")
const ids = [...new Set(state.recipes.map(recipe => /^\/api\/image\?id=([0-9a-f-]{36})$/i.exec(recipe.image)?.[1]).filter(Boolean))]
const images = []
for (const id of ids) {
  const image = await storage.readImage(id)
  if (!image) throw new Error(`Foto ausente: ${id}. Exportação cancelada.`)
  const bytes = image.body instanceof ReadableStream ? Buffer.from(await new Response(image.body).arrayBuffer()) : Buffer.from(image.body)
  images.push({ id, contentType: image.contentType, base64: bytes.toString("base64") })
}
const output = resolve(options.output)
await mkdir(dirname(output), { recursive: true, mode: 0o700 })
await writeFile(output, JSON.stringify({ version: 1, state, images }), { mode: 0o600, flag: "wx" })
await chmod(output, 0o600)
console.log(JSON.stringify({ source: options.source, dataset: options.dataset || "development", recipes: state.recipes.length, profiles: state.profiles.length, ratings: state.ratings.length, images: images.length }))
