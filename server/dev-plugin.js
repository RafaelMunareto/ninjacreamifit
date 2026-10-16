import { loadEnv } from "vite"
import { resolve } from "node:path"
import { createFileStorage } from "./storage.js"
import { createService, parseAdminCredential } from "./service.js"
import { createHttpHandler } from "./http.js"

export default function creamiServer() {
  return {
    name: "creami-shared-development-server",
    configureServer(server) {
      const environment = loadEnv(server.config.mode, server.config.root, "")
      const service = createService(
        createFileStorage(resolve(server.config.root, ".data/development")),
        {
          initialAdmin: parseAdminCredential(
            environment.CREAMI_ADMIN_CREDENTIAL,
          ),
          allowSetup: true,
        },
      )
      const handler = createHttpHandler(() => service, { secureCookies: false })
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0]
        if (pathname === "/api/creami" || pathname === "/api/image")
          void handler(request, response)
        else next()
      })
    },
  }
}
