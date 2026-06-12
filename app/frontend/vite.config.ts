import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

// `wails3 dev` injects the Vite port via WAILS_VITE_PORT; fall back to 5173 for plain `yarn dev`.
const port = Number(process.env.WAILS_VITE_PORT) || 5173;

export const PROXY_PATH = "/__yarc_proxy";
export const PROXY_STREAM_PATH = "/__yarc_proxy_stream";

// In the browser preview there is no Go backend, so `fetch()` is subject to CORS.
// This dev/preview middleware performs the request from Node (no CORS) and relays the response,
// mirroring what the Wails desktop backend does in production.
function apiProxyPlugin(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (payload: unknown) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    if (req.method !== "POST") {
      send({ error: "Proxy expects POST" });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const { url, method, headers, body } = JSON.parse(Buffer.concat(chunks).toString() || "{}");

      if (!url || typeof url !== "string") {
        send({ error: `Proxy received no target URL (method=${method ?? "?"}). Enter a valid http(s) URL.` });
        return;
      }

      const upstream = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        redirect: "follow",
      });

      const responseBody = await upstream.text();
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      send({
        statusCode: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (error) {
      send({ error: error instanceof Error ? error.message : "Proxy request failed" });
    }
  };

  // Streaming variant: writes a JSON meta line, then pipes the upstream body as it arrives.
  const streamHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");

    let url: string | undefined;
    let method: string | undefined;
    let headers: Record<string, string> | undefined;
    let body: string | undefined;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      ({ url, method, headers, body } = JSON.parse(Buffer.concat(chunks).toString() || "{}"));
    } catch {
      res.write(JSON.stringify({ error: "Invalid proxy payload" }) + "\n");
      res.end();
      return;
    }

    if (!url || typeof url !== "string") {
      res.write(JSON.stringify({ error: "Proxy received no target URL" }) + "\n");
      res.end();
      return;
    }

    try {
      const upstream = await fetch(url, { method, headers, body: body ?? undefined, redirect: "follow" });
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.write(JSON.stringify({ statusCode: upstream.status, statusText: upstream.statusText, headers: responseHeaders }) + "\n");
      req.on("close", () => upstream.body?.cancel().catch(() => {}));
      if (upstream.body) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch (error) {
      res.write(JSON.stringify({ error: error instanceof Error ? error.message : "Proxy request failed" }) + "\n");
      res.end();
    }
  };

  return {
    name: "yarc-api-proxy",
    configureServer(server) {
      server.middlewares.use(PROXY_PATH, handler);
      server.middlewares.use(PROXY_STREAM_PATH, streamHandler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(PROXY_PATH, handler);
      server.middlewares.use(PROXY_STREAM_PATH, streamHandler);
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  server: {
    port,
    strictPort: true,
  },
});
