import { loadEnv } from "vite"
import { createRepassafacilProxy } from "./repassafacil-proxy.js"

export default function creamiServer() {
  return {
    name: "creami-repassafacil-api",
    configureServer(server) {
      const environment = {
        ...process.env,
        ...loadEnv(server.config.mode, server.config.root, ""),
      }
      environment.REPASSAFACIL_API_URL ||= "http://127.0.0.1:5075"
      const routes = new Map(["creami", "image", "foods", "food-ai", "food-catalog"].map(name => {
        const path = `/api/${name}`
        return [path, createRepassafacilProxy(path, { environment })]
      }))
      server.middlewares.use((request, response, next) => {
        const handler = routes.get(request.url?.split("?")[0])
        if (handler) void handler(request, response)
        else next()
      })
    },
  }
}
