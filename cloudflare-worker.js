import { httpServerHandler } from "cloudflare:node";

let handlerPromise;

export default {
  async fetch(request, env, ctx) {
    // Cloudflare Hyperdrive provides the pooled connection to the existing Neon DB.
    if (!env.HYPERDRIVE?.connectionString) {
      return Response.json(
        { ok: false, error: "Cloudflare Hyperdrive binding is not configured." },
        { status: 503 }
      );
    }

    // Make Worker secrets available to the existing Express application.
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") process.env[key] = value;
    }
    process.env.NODE_ENV = "production";
    process.env.CLOUDFLARE_WORKERS = "1";
    process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
    process.env.DATABASE_SSL = "true";

    try {
      if (!handlerPromise) {
        handlerPromise = (async () => {
          const loaded = await import("./server.js");
          const appModule = loaded.app ? loaded : loaded.default;
          await appModule.initDb();
          appModule.app.listen(3000);
          return httpServerHandler({ port: 3000 });
        })();
      }

      const handler = await handlerPromise;
      return await handler(request, env, ctx);
    } catch (error) {
      handlerPromise = undefined;
      console.error("Fly Next Worker startup/request failed:", error?.message || error);
      return Response.json(
        { ok: false, error: "Service temporarily unavailable." },
        { status: 503 }
      );
    }
  }
};
