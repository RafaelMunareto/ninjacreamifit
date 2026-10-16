import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  pbkdf2,
} from "node:crypto"
import { createClerkClient, verifyToken } from "@clerk/backend"
import { promisify } from "node:util"
import { seedRecipes, categoryColors } from "../src/data/recipes.js"
import {
  text as checkText,
  validateRecipe as checkRecipe,
} from "../src/lib/recipe-utils.js"
import { ConflictError } from "./storage.js"

const derive = promisify(pbkdf2)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHOTO = /^\/api\/image\?id=([0-9a-f-]{36})$/i
const DEFAULT_ADMIN_EMAILS = new Set([
  "rafaelmmunareto@gmail.com",
  "rafael.munareto@icloud.com",
  "vitorsalima@gmail.com",
])
const digest = (value) => createHash("sha256").update(value).digest("hex")
const text = (...args) => {
  try {
    return checkText(...args)
  } catch (error) {
    error.status = 400
    throw error
  }
}
const validateRecipe = (...args) => {
  try {
    return checkRecipe(...args)
  } catch (error) {
    error.status = 400
    throw error
  }
}
export function fail(message, status = 400) {
  const error = new Error(message)
  error.status = status
  throw error
}
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function makeAdminCredential(password) {
  if (
    typeof password !== "string" ||
    password.trim().length < 10 ||
    password.length > 128
  )
    fail("Use uma senha de 10 a 128 caracteres.")
  const salt = randomBytes(16).toString("hex")
  return {
    salt,
    iterations: 600000,
    hash: (
      await derive(password, Buffer.from(salt, "hex"), 600000, 32, "sha256")
    ).toString("hex"),
  }
}

export function parseAdminCredential(value) {
  if (!value) return null
  const credential = JSON.parse(value)
  if (
    !/^[a-f0-9]{32}$/.test(credential.salt) ||
    !/^[a-f0-9]{64}$/.test(credential.hash) ||
    credential.iterations !== 600000
  )
    throw new Error("Configuração de administrador inválida.")
  return credential
}

async function verifyPassword(password, credential) {
  if (typeof password !== "string" || !password || password.length > 128)
    return false
  const hash = (
    await derive(
      password,
      Buffer.from(credential.salt, "hex"),
      credential.iterations,
      32,
      "sha256",
    )
  ).toString("hex")
  return equal(hash, credential.hash)
}

function issueAdminSession(credential) {
  const payload = `${Date.now() + 8 * 60 * 60 * 1000}.${randomBytes(16).toString("hex")}`
  return `${payload}.${createHmac("sha256", credential.hash).update(payload).digest("hex")}`
}

function isAdmin(token, credential) {
  if (!credential || typeof token !== "string") return false
  const [expires, nonce, signature, extra] = token.split(".")
  if (
    extra ||
    !/^\d{13}$/.test(expires || "") ||
    Number(expires) < Date.now() ||
    !/^[a-f0-9]{32}$/.test(nonce || "")
  )
    return false
  const expected = createHmac("sha256", credential.hash)
    .update(`${expires}.${nonce}`)
    .digest("hex")
  return equal(signature, expected)
}

function requireAdmin(token, state, emailAdmin = false) {
  if (!emailAdmin && !isAdmin(token, state.admin))
    fail(
      "Entre como administrador para gerenciar esta receita ou alterar as avaliações.",
      403,
    )
}

function profileFor(state, tokenHash) {
  let profile = state.profiles.find(
    (profile) => profile.tokenHash === tokenHash,
  )
  if (!profile) {
    profile = {
      id: randomUUID(),
      tokenHash,
      name: "Você",
      favorites: [],
      imports: [],
      preferences: [],
    }
    state.profiles.push(profile)
  }
  return profile
}

function recipeFor(state, id) {
  if (typeof id !== "string" || (!UUID.test(id) && !/^[1-6]$/.test(id)))
    fail("Identificador de receita inválido.")
  const recipe = state.recipes.find((recipe) => recipe.id === id)
  if (!recipe) fail("Esta receita não está mais disponível.", 404)
  return recipe
}

function aggregate(state, recipe) {
  const ratings = state.ratings.filter(
    (rating) => rating.recipeId === recipe.id,
  )
  const votes = recipe.votes + ratings.length
  return {
    votes,
    rating: votes
      ? Math.round(
          ((recipe.rating * recipe.votes +
            ratings.reduce((sum, rating) => sum + rating.value, 0)) /
            votes) *
            10,
        ) / 10
      : 0,
  }
}

function snapshotOf(state, profile, adminToken, emailAdmin = false) {
  const profiles = new Map(
    state.profiles.map((profile) => [profile.id, profile]),
  )
  return {
    profile: { id: profile.id, name: profile.name },
    admin: {
      configured: Boolean(state.admin),
      authenticated: emailAdmin || isAdmin(adminToken, state.admin),
    },
    recipes: state.recipes
      .map((recipe) => ({
        ...recipe,
        author:
          !recipe.authorOverride && profiles.has(recipe.authorId)
            ? profiles.get(recipe.authorId).name
            : recipe.author,
        ...aggregate(state, recipe),
        ownRating:
          state.ratings.find(
            (rating) =>
              rating.recipeId === recipe.id && rating.profileId === profile.id,
          )?.value || 0,
        isFavorite: profile.favorites.includes(recipe.id),
      }))
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      ),
  }
}

function updateRating(state, profile, id, value) {
  recipeFor(state, id)
  if (!Number.isInteger(value) || value < 1 || value > 5)
    fail("A nota deve ser um número inteiro de 1 a 5.")
  const previous = state.ratings.find(
    (rating) => rating.recipeId === id && rating.profileId === profile.id,
  )
  if (previous) previous.value = value
  else state.ratings.push({ recipeId: id, profileId: profile.id, value })
}

function apply(state, profile, adminToken, action, data, emailAdmin = false) {
  if (action === "profile") {
    profile.name = text(data.name, "seu nome", 60)
    return {}
  }
  if (action === "rate") {
    updateRating(state, profile, data.id, data.value)
    return {}
  }
  if (action === "favorite") {
    recipeFor(state, data.id)
    const favorite =
      typeof data.value === "boolean"
        ? data.value
        : !profile.favorites.includes(data.id)
    profile.favorites = profile.favorites.filter((id) => id !== data.id)
    if (favorite) profile.favorites.push(data.id)
    return {}
  }
  if (action === "importPreference") {
    if (profile.preferences.includes(data.id)) return {}
    recipeFor(state, data.id)
    if (data.rating) updateRating(state, profile, data.id, data.rating)
    if (data.favorite && !profile.favorites.includes(data.id))
      profile.favorites.push(data.id)
    profile.preferences.push(data.id)
    return {}
  }
  if (action === "delete") {
    const recipe = recipeFor(state, data.id)
    if (recipe.authorId !== profile.id)
      requireAdmin(adminToken, state, emailAdmin)
    state.recipes = state.recipes.filter((item) => item.id !== recipe.id)
    state.ratings = state.ratings.filter(
      (rating) => rating.recipeId !== recipe.id,
    )
    for (const owner of state.profiles)
      owner.favorites = owner.favorites.filter((id) => id !== recipe.id)
    return {
      obsoleteImage: state.recipes.some((item) => item.image === recipe.image)
        ? null
        : recipe.image,
    }
  }
  if (action !== "save" && action !== "import") fail("Operação desconhecida.")
  if (action === "import") {
    if (!UUID.test(data.legacyId || ""))
      fail("Identificador da receita antiga inválido.")
    const imported = profile.imports.find(
      (item) => item.legacyId === data.legacyId,
    )
    if (imported) return { id: imported.id, alreadyImported: true }
  }
  const existing = data.id ? recipeFor(state, data.id) : null
  if (existing && existing.authorId !== profile.id)
    requireAdmin(adminToken, state, emailAdmin)
  if (data.details) requireAdmin(adminToken, state, emailAdmin)
  const input = data.input
  if (!input || typeof input !== "object") fail("Informe os dados da receita.")
  const allowedImage = PHOTO.test(input.image || "")
    ? input.image
    : existing?.image
  const values = validateRecipe(input, allowedImage)
  if (input.foodItems === undefined && existing?.foodItems !== undefined)
    values.foodItems = structuredClone(existing.foodItems)
  const localName =
    !data.details && input.authorName !== undefined
      ? text(input.authorName, "seu nome", 60)
      : profile.name
  let author = existing?.author || localName
  let authorOverride = existing?.authorOverride || false
  let rating = existing?.rating || 0
  let votes = existing?.votes || 0
  const authorId = existing ? existing.authorId : profile.id
  if (
    !data.details &&
    authorId === profile.id &&
    input.authorName !== undefined
  ) {
    author = localName
    authorOverride = false
  }
  if (data.details) {
    const details = data.details
    author = text(details.author, "o nome do autor", 60)
    const displayedAuthor =
      existing && !existing.authorOverride
        ? state.profiles.find((owner) => owner.id === existing.authorId)
            ?.name || existing.author
        : existing?.author
    if (author !== displayedAuthor) authorOverride = true
    if (
      !Number.isInteger(details.votes) ||
      details.votes < 0 ||
      details.votes > 10000000
    )
      fail("O total de avaliações deve ser um inteiro entre 0 e 10.000.000.")
    if (
      !Number.isFinite(details.rating) ||
      details.rating < 0 ||
      details.rating > 5 ||
      Math.abs(details.rating * 10 - Math.round(details.rating * 10)) > 0.00001
    )
      fail(
        "A média de estrelas deve estar entre 0 e 5, com até uma casa decimal.",
      )
    if (
      (!details.votes && details.rating !== 0) ||
      (details.votes > 0 && details.rating < 1)
    )
      fail(
        "Use média 0 quando não houver avaliações, ou de 1 a 5 quando houver.",
      )
    const current = existing
      ? aggregate(state, existing)
      : { rating: 0, votes: 0 }
    if (
      details.ratingsChanged !== false &&
      (current.rating !== details.rating || current.votes !== details.votes)
    ) {
      rating = details.rating
      votes = details.votes
      if (existing)
        state.ratings = state.ratings.filter(
          (item) => item.recipeId !== existing.id,
        )
    }
  }
  const id = existing?.id || randomUUID()
  const recipe = {
    ...values,
    id,
    author,
    authorId,
    authorOverride,
    color: categoryColors[values.category],
    rating,
    votes,
    createdAt: existing?.createdAt || new Date().toISOString(),
  }
  if (!data.details && authorId === profile.id) profile.name = localName
  if (existing) state.recipes[state.recipes.indexOf(existing)] = recipe
  else state.recipes.push(recipe)
  if (action === "import") {
    profile.imports.push({ legacyId: data.legacyId, id })
    if (data.ownRating) updateRating(state, profile, id, data.ownRating)
    if (data.favorite) profile.favorites.push(id)
  }
  return {
    id,
    obsoleteImage:
      existing &&
      existing.image !== recipe.image &&
      !state.recipes.some((item) => item.image === existing.image)
        ? existing.image
        : null,
  }
}

export function createService(
  storage,
  {
    initialAdmin = null,
    allowSetup = false,
    clerkSecretKey = "",
    adminEmails = DEFAULT_ADMIN_EMAILS,
  } = {},
) {
  const emailAdmins = new Set(
    adminEmails instanceof Set
      ? [...adminEmails].map((email) => String(email).trim().toLowerCase())
      : String(adminEmails || "")
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
  )
  const clerk = clerkSecretKey
    ? createClerkClient({ secretKey: clerkSecretKey })
    : null
  const initialState = () => ({
    version: 1,
    recipes: structuredClone(seedRecipes),
    profiles: [],
    ratings: [],
    admin: initialAdmin,
  })
  const mutate = async (callback) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const { state: persisted, etag } = await storage.read()
      const state = persisted ? structuredClone(persisted) : initialState()
      const value = callback(state)
      try {
        await storage.write(state, etag)
        return value
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error
      }
    }
    fail(
      "O catálogo recebeu outras alterações ao mesmo tempo. Tente salvar novamente.",
      409,
    )
  }
  const identify = async (token) => {
    if (typeof token !== "string" || !token) {
      fail("Identificação do perfil inválida.", 401)
    }
    let tokenHash
    let emailAdmin = false
    if (/^[a-f0-9]{64}$/.test(token)) {
      tokenHash = digest(token)
    } else if (clerkSecretKey) {
      try {
        const claims = await verifyToken(token, { secretKey: clerkSecretKey })
        if (typeof claims.sub !== "string" || !claims.sub)
          fail("Sessão do usuário inválida.", 401)
        tokenHash = digest(`clerk:${claims.sub}`)
        if (clerk && emailAdmins.size) {
          try {
            const user = await clerk.users.getUser(claims.sub)
            const email = user.primaryEmailAddress?.emailAddress
            emailAdmin =
              typeof email === "string" &&
              emailAdmins.has(email.trim().toLowerCase())
          } catch {
            emailAdmin = false
          }
        }
      } catch {
        fail("Sessão do usuário inválida.", 401)
      }
    } else {
      fail("Identificação do perfil inválida.", 401)
    }
    let { state } = await storage.read()
    if (!state?.profiles.some((profile) => profile.tokenHash === tokenHash)) {
      await mutate((state) => profileFor(state, tokenHash))
      ;({ state } = await storage.read())
    }
    return {
      state,
      tokenHash,
      emailAdmin,
      profile: state.profiles.find(
        (profile) => profile.tokenHash === tokenHash,
      ),
    }
  }
  return {
    async snapshot(token, adminToken) {
      const { state, profile, emailAdmin } = await identify(token)
      return snapshotOf(state, profile, adminToken, emailAdmin)
    },
    async perform(action, data, token, adminToken) {
      const { state, tokenHash, profile, emailAdmin } = await identify(token)
      if (action === "logout") return { value: null, adminToken: null }
      if (action === "login") {
        if (!state.admin || !(await verifyPassword(data.password, state.admin)))
          fail("Senha incorreta.", 401)
        return { value: null, adminToken: issueAdminSession(state.admin) }
      }
      if (action === "setup") {
        if (!allowSetup)
          fail(
            "A senha de administrador é configurada pelo responsável no servidor.",
            403,
          )
        const credential = await makeAdminCredential(data.password)
        await mutate((state) => {
          if (state.admin) fail("Já existe uma senha de administrador.", 409)
          state.admin = credential
        })
        return { value: null, adminToken: issueAdminSession(credential) }
      }
      if (action === "changePassword") {
        requireAdmin(adminToken, state, emailAdmin)
        if (!(await verifyPassword(data.currentPassword, state.admin)))
          fail("Senha atual incorreta.", 401)
        const credential = await makeAdminCredential(data.newPassword)
        await mutate((current) => {
          requireAdmin(adminToken, current, emailAdmin)
          if (current.admin.hash !== state.admin.hash)
            fail("A senha foi alterada. Entre novamente.", 401)
          current.admin = credential
        })
        return { value: null, adminToken: issueAdminSession(credential) }
      }
      const prepared = structuredClone(data)
      const preview = apply(
        structuredClone(state),
        structuredClone(profile),
        adminToken,
        action,
        prepared,
        emailAdmin,
      )
      if (preview.alreadyImported) return { value: preview.id }
      let newImage
      if (
        (action === "save" || action === "import") &&
        prepared.input.image.startsWith("data:image/")
      ) {
        const match =
          /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
            prepared.input.image,
          )
        if (!match) fail("Adicione uma foto válida.")
        newImage = randomUUID()
        await storage.writeImage(
          newImage,
          Buffer.from(match[2], "base64"),
          match[1],
        )
        prepared.input.image = `/api/image?id=${newImage}`
      }
      try {
        const result = await mutate((state) =>
          apply(
            state,
            profileFor(state, tokenHash),
            adminToken,
            action,
            prepared,
            emailAdmin,
          ),
        )
        if (result.alreadyImported && newImage)
          await storage.deleteImage(newImage).catch(() => {})
        const obsolete = PHOTO.exec(result.obsoleteImage || "")?.[1]
        if (obsolete) await storage.deleteImage(obsolete).catch(() => {})
        return { value: result.id || null }
      } catch (error) {
        if (newImage) await storage.deleteImage(newImage).catch(() => {})
        throw error
      }
    },
    async image(id) {
      if (!UUID.test(id || "")) fail("Imagem inválida.")
      const image = await storage.readImage(id)
      if (!image) fail("Imagem não encontrada.", 404)
      return image
    },
  }
}
