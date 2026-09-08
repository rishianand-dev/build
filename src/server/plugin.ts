import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

const httpFile = resolve(process.cwd(), "src/server/http.ts");

type HandleApi = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

function apiMiddleware(server?: ViteDevServer): Connect.NextHandleFunction {
  return (req, res, next) => {
    const loaded = server
      ? server.ssrLoadModule(httpFile)
      : import(httpFile);
    void loaded
      .then((mod: { handleApi: HandleApi }) => mod.handleApi(req, res))
      .then((handled) => {
        if (!handled) next();
      }, next);
  };
}

export function captureApiPlugin(): Plugin {
  return {
    name: "honebi-capture-api",
    configureServer(server) {
      server.middlewares.use(apiMiddleware(server));
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware(server as unknown as ViteDevServer));
    },
  };
}
