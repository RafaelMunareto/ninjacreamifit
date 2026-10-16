import { createBlobStorage } from "./storage.js"
import { createService, parseAdminCredential } from "./service.js"
import { createHttpHandler } from "./http.js"

let service
export default createHttpHandler(() => {
  if (!service)
    service = createService(createBlobStorage(), {
      initialAdmin: parseAdminCredential(process.env.CREAMI_ADMIN_CREDENTIAL),
      clerkSecretKey: process.env.CLERK_SECRET_KEY,
    })
  return service
})
