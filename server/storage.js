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
  const options = {
    access: "private",
    ...(environment.BLOB_READ_WRITE_TOKEN
      ? { token: environment.BLOB_READ_WRITE_TOKEN }
      : { storeId: environment.BLOB_STORE_ID }),
  }
  return {
    async read() {
      const result = await get(`${prefix}catalog.json`, {
        ...options,
        useCache: false,
        // Compressed responses carry a weak ETag, which cannot guard a write.
        headers: { "accept-encoding": "identity" },
      })
      if (!result) return { state: null, etag: null }
      return {
        state: await new Response(result.stream).json(),
        etag: result.blob.etag,
      }
    },
    async write(state, etag) {
      try {
        await put(`${prefix}catalog.json`, JSON.stringify(state), {
          ...options,
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: Boolean(etag),
          ...(etag ? { ifMatch: etag } : {}),
        })
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

// Used only by Vite development and integration tests. Production always uses Blob.
export function createFileStorage(directory) {
  const filename = join(directory, "catalog.json")
  let writes = Promise.resolve()
  const read = async () => {
    try {
      const source = await readFile(filename, "utf8")
      return {
        state: JSON.parse(source),
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
          await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
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
