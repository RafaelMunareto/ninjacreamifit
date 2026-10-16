import {
  get,
  put,
  del,
  BlobError,
  BlobPreconditionFailedError,
} from "@vercel/blob"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { encodeSqlite, decodeCatalog, isSqlite } from "./sqlite.js"

export class ConflictError extends Error {}

export function createBlobStorage(environment = process.env) {
  if (!environment.BLOB_READ_WRITE_TOKEN && !environment.BLOB_STORE_ID) {
    const error = new Error(
      "O armazenamento online ainda não está conectado. Conecte um Vercel Blob privado ao projeto e publique novamente.",
    )
    error.status = 503
    throw error
  }
  const dataset =
    environment.CREAMI_DATASET || environment.VERCEL_ENV || "development"
  if (!/^[a-z0-9-]{1,50}$/i.test(dataset))
    throw new Error("Identificador de armazenamento inválido.")
  const prefix = `creami/${dataset}/`
  const sqlitePath = `${prefix}catalog.sqlite`
  const legacyPath = `${prefix}catalog.json`
  let catalogPath
  const options = {
    access: "private",
    ...(environment.BLOB_READ_WRITE_TOKEN
      ? { token: environment.BLOB_READ_WRITE_TOKEN }
      : { storeId: environment.BLOB_STORE_ID }),
  }
  return {
    async read() {
      const readOptions = {
        ...options,
        useCache: false,
        // Compressed responses carry a weak ETag, which cannot guard a write.
        headers: { "accept-encoding": "identity" },
      }
      let path = catalogPath || sqlitePath
      let result = await get(path, readOptions)
      if (!result && !catalogPath) {
        path = legacyPath
        result = await get(path, readOptions)
      }
      if (!result) return { state: null, etag: null }
      catalogPath = path
      const bytes = new Uint8Array(
        await new Response(result.stream).arrayBuffer(),
      )
      return {
        state: await decodeCatalog(bytes),
        etag: {
          value: result.blob.etag,
          path,
          legacy: !isSqlite(bytes) ? bytes : null,
        },
      }
    },
    async write(state, etag) {
      const bytes = await encodeSqlite(state)
      // Keep an existing object's key and conditional-write guard during the
      // format migration so in-flight requests cannot overwrite newer data.
      const path = etag?.path || sqlitePath
      if (etag?.legacy) {
        const fingerprint = createHash("sha256")
          .update(etag.legacy)
          .digest("hex")
        try {
          await put(
            `${prefix}backups/before-sqlite-${fingerprint}.json`,
            etag.legacy,
            {
              ...options,
              contentType: "application/json",
              addRandomSuffix: false,
            },
          )
        } catch (error) {
          if (
            !(
              error instanceof BlobError &&
              error.message.startsWith("Vercel Blob: This blob already exists")
            )
          )
            throw error
        }
      }
      try {
        await put(path, bytes, {
          ...options,
          contentType: "application/vnd.sqlite3",
          addRandomSuffix: false,
          allowOverwrite: Boolean(etag),
          ...(etag ? { ifMatch: etag.value } : {}),
        })
        catalogPath = path
      } catch (error) {
        if (
          error instanceof BlobPreconditionFailedError ||
          (!etag &&
            error instanceof BlobError &&
            error.message.startsWith("Vercel Blob: This blob already exists"))
        )
          throw new ConflictError()
        throw error
      }
    },
    async writeImage(id, bytes, contentType) {
      await put(`${prefix}images/${id}`, bytes, {
        ...options,
        contentType,
        addRandomSuffix: false,
      })
    },
    async readImage(id) {
      const result = await get(`${prefix}images/${id}`, options)
      if (!result) return null
      return { body: result.stream, contentType: result.blob.contentType }
    },
    async deleteImage(id) {
      await del(`${prefix}images/${id}`, options)
    },
  }
}

// Vite development and integration tests use a SQLite file on the local server.
export function createFileStorage(directory) {
  const filename = join(directory, "catalog.sqlite")
  const legacyFilename = join(directory, "catalog.json")
  let writes = Promise.resolve()
  const read = async () => {
    try {
      const source = await readFile(filename).catch((error) => {
        if (error.code !== "ENOENT") throw error
        return readFile(legacyFilename)
      })
      return {
        state: await decodeCatalog(source),
        etag: createHash("sha256").update(source).digest("hex"),
      }
    } catch (error) {
      if (error.code === "ENOENT") return { state: null, etag: null }
      throw error
    }
  }
  return {
    read,
    write(state, etag) {
      const operation = writes
        .catch(() => {})
        .then(async () => {
          const current = await read()
          if (current.etag !== etag) throw new ConflictError()
          await mkdir(directory, { recursive: true })
          const temporary = `${filename}.${randomUUID()}.tmp`
          await writeFile(temporary, await encodeSqlite(state), { mode: 0o600 })
          await rename(temporary, filename)
        })
      writes = operation
      return operation
    },
    async writeImage(id, bytes, contentType) {
      await mkdir(join(directory, "images"), { recursive: true })
      await writeFile(join(directory, "images", id), bytes)
      await writeFile(join(directory, "images", `${id}.mime`), contentType)
    },
    async readImage(id) {
      try {
        return {
          body: await readFile(join(directory, "images", id)),
          contentType: await readFile(
            join(directory, "images", `${id}.mime`),
            "utf8",
          ),
        }
      } catch (error) {
        if (error.code === "ENOENT") return null
        throw error
      }
    },
    async deleteImage(id) {
      await Promise.all(
        [id, `${id}.mime`].map((name) =>
          unlink(join(directory, "images", name)).catch((error) => {
            if (error.code !== "ENOENT") throw error
          }),
        ),
      )
    },
  }
}
