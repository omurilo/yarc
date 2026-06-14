import type { ApiRequest, ApiResponse, CollectionNode, Cookie, Environment, GrpcInvokeResponse, GrpcMethodList, GrpcRequest, HistoryEntry, SentRequestInfo, WorkspaceBootstrap } from "../types/api";
// Wails v3 exposes Go services as generated ES module bindings (not the v2 `window.go`).
// They only work inside the Wails webview, where the page is served from the wails:// origin.
import { AppService } from "../../bindings/github.com/omurilo/yarc/app/backend/api";
import { Events } from "@wailsio/runtime";
import { buildSnippet } from "./snippets";
import { downloadFile } from "./download";
import { applyDynamicVars } from "./dynamicVars";

const inWails = typeof window !== "undefined" && window.location.protocol === "wails:";

// Returns the Go backend in the desktop app, or null in the browser preview (which uses the
// dev proxy / localStorage fallbacks). Typed loosely because the generated binding models
// differ structurally from the frontend types while being JSON-compatible at runtime.
const wailsService = (): any => (inWails ? AppService : null);

const defaultEnvironments: Environment[] = [
  { id: "local", name: "Local", variables: { api_url: {text: "", type: "text"}, token: {text: "", type: "text"}, user_id: {text: "", type: "text"} }, secrets: ["token"], active: true },
  { id: "dev", name: "Dev", variables: { api_url: {text: "", type: "text"}, token: {text: "", type: "text"}, user_id: {text: "", type: "text"} }, secrets: ["token"], active: false },
  { id: "staging", name: "Staging", variables: { api_url: {text: "", type: "text"}, token: {text: "", type: "text"}, user_id: {text: "", type: "text"} }, secrets: ["token"], active: false },
  { id: "production", name: "Production", variables: { api_url: {text: "", type: "text"}, token: {text: "", type: "text"}, user_id: {text: "", type: "text"} }, secrets: ["token"], active: false },
];

export async function bootstrapWorkspace(): Promise<WorkspaceBootstrap> {
  if (wailsService()?.BootstrapWorkspace) {
    const data = await wailsService()!.BootstrapWorkspace();
    return {
      collections: data.collections.length > 0 ? data.collections : workspaceOnly(),
      environments: data.environments.length > 0 ? data.environments : defaultEnvironments,
      history: data.history,
    };
  }

  return {
    collections: readLocal("yarc.collections", workspaceOnly()),
    environments: readLocal("yarc.environments", defaultEnvironments),
    history: readLocal("yarc.history", []),
  };
}

export async function saveCollection(collection: CollectionNode): Promise<void> {
  if (wailsService()?.SaveCollection) {
    return wailsService()!.SaveCollection(collection);
  }
  const collections = readLocal<CollectionNode[]>("yarc.collections", workspaceOnly());
  const next = collections.some((item) => item.id === collection.id) ? collections.map((item) => (item.id === collection.id ? collection : item)) : [...collections, collection];
  localStorage.setItem("yarc.collections", JSON.stringify(next));
}

export async function saveCollections(collections: CollectionNode[]): Promise<void> {
  if (collections.length === 0) return;
  if (wailsService()?.SaveCollections) {
    return wailsService()!.SaveCollections(collections);
  }
  const existing = readLocal<CollectionNode[]>("yarc.collections", workspaceOnly());
  const byId = new Map(existing.map((item) => [item.id, item]));
  collections.forEach((item) => byId.set(item.id, item));
  localStorage.setItem("yarc.collections", JSON.stringify([...byId.values()]));
}

export async function deleteCollections(ids: string[]): Promise<void> {
  const removable = new Set(ids.filter((id) => id !== "workspace"));
  if (wailsService()?.DeleteCollections) {
    return wailsService()!.DeleteCollections([...removable]);
  }
  const collections = readLocal<CollectionNode[]>("yarc.collections", workspaceOnly());
  localStorage.setItem("yarc.collections", JSON.stringify(collections.filter((item) => !removable.has(item.id))));
}

// Opens a native file picker (desktop only) and returns the chosen absolute path + base name,
// for linking an environment variable to a file. Returns null in the browser preview.
export async function pickEnvFile(): Promise<{ path: string; name: string } | null> {
  if (wailsService()?.PickFile) {
    const result = await wailsService()!.PickFile();
    return result?.path ? { path: result.path, name: result.name } : null;
  }
  return null;
}

// Saves text content to a file. In the desktop app this opens a native save dialog (WKWebView
// ignores anchor/blob downloads); in the browser preview it falls back to a blob download.
export async function saveResponseFile(name: string, content: string, mime = "application/octet-stream"): Promise<boolean> {
  if (wailsService()?.SaveResponseFile) {
    return wailsService()!.SaveResponseFile(name, content);
  }
  downloadFile(name, content, mime);
  return true;
}

// Cookie jar (desktop only). The Go backend auto-attaches matching cookies to requests and
// stores Set-Cookie responses; these power the manual cookie manager. No-ops in the browser.
export async function listCookies(): Promise<Cookie[]> {
  if (wailsService()?.ListCookies) return wailsService()!.ListCookies();
  return [];
}

export async function saveCookie(cookie: Cookie): Promise<void> {
  if (wailsService()?.SaveCookie) return wailsService()!.SaveCookie(cookie);
}

export async function deleteCookie(domain: string, path: string, name: string): Promise<void> {
  if (wailsService()?.DeleteCookie) return wailsService()!.DeleteCookie(domain, path, name);
}

export async function clearCookies(domain: string): Promise<void> {
  if (wailsService()?.ClearCookies) return wailsService()!.ClearCookies(domain);
}

// ---- OAuth 2.0 -------------------------------------------------------------
export type OAuth2Config = {
  grantType: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  username: string;
  password: string;
  refreshToken: string;
  clientAuth: string;
};
export type OAuth2TokenResult = { accessToken: string; tokenType: string; expiresIn: number; refreshToken: string; raw: string; error: string };

export async function fetchOAuth2Token(config: OAuth2Config): Promise<OAuth2TokenResult> {
  if (wailsService()?.FetchOAuth2Token) return wailsService()!.FetchOAuth2Token(config);
  // Browser preview: POST the form through the relay (token endpoints often block CORS directly).
  const form = new URLSearchParams();
  form.set("grant_type", config.grantType || "client_credentials");
  if (config.scope) form.set("scope", config.scope);
  if (config.grantType === "password") {
    form.set("username", config.username);
    form.set("password", config.password);
  } else if (config.grantType === "refresh_token") {
    form.set("refresh_token", config.refreshToken);
  }
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (config.clientAuth === "basic") headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  else {
    if (config.clientId) form.set("client_id", config.clientId);
    if (config.clientSecret) form.set("client_secret", config.clientSecret);
  }
  const result = await relayRequest({ url: config.tokenUrl, method: "POST", headers, body: form.toString() });
  if (result.error) return { accessToken: "", tokenType: "", expiresIn: 0, refreshToken: "", raw: "", error: result.error };
  try {
    const json = JSON.parse(result.body);
    if (!json.access_token) return { accessToken: "", tokenType: "", expiresIn: 0, refreshToken: "", raw: result.body, error: json.error_description || json.error || "No access_token in response" };
    return { accessToken: json.access_token, tokenType: json.token_type ?? "", expiresIn: json.expires_in ?? 0, refreshToken: json.refresh_token ?? "", raw: result.body, error: "" };
  } catch {
    return { accessToken: "", tokenType: "", expiresIn: 0, refreshToken: "", raw: result.body, error: "Token response was not JSON" };
  }
}

// ---- WebSocket (desktop backend; supports custom headers) ------------------
export type WsHandlers = { onOpen: (status: string) => void; onMessage: (data: string) => void; onClose: (reason: string) => void; onError: (error: string) => void };
export type WsController = { send: (payload: string) => void; close: () => void };

// Opens a WebSocket through the Go backend (custom headers work, unlike the browser's native
// WebSocket). Returns null in the browser preview so the panel can fall back to native WebSocket.
export async function openBackendWebSocket(url: string, headers: { key: string; value: string; enabled: boolean }[], handlers: WsHandlers): Promise<WsController | null> {
  if (!inWails) return null;
  const id = crypto.randomUUID();
  const base = `yarc:ws:${id}`;
  const offs: Array<() => void> = [];
  offs.push(Events.On(`${base}:open`, (event: { data: any }) => handlers.onOpen(event.data?.status ?? "")));
  offs.push(Events.On(`${base}:message`, (event: { data: any }) => handlers.onMessage(typeof event.data === "string" ? event.data : String(event.data ?? ""))));
  offs.push(
    Events.On(`${base}:close`, (event: { data: any }) => {
      handlers.onClose(event.data?.reason ?? "");
      offs.forEach((off) => off());
    }),
  );
  const error: string = await (AppService as any).OpenWebSocket(id, url, headers);
  if (error) {
    offs.forEach((off) => off());
    handlers.onError(error);
    return null;
  }
  return {
    send: (payload: string) => void (AppService as any).SendWebSocket(id, payload),
    close: () => void (AppService as any).CloseWebSocket(id),
  };
}

// ---- Updater ---------------------------------------------------------------
export type UpdateInfo = { currentVersion: string; latestVersion: string; updateAvailable: boolean; url: string; notes: string; error: string };

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (wailsService()?.CheckForUpdate) return wailsService()!.CheckForUpdate();
  return null;
}

export async function openReleasePage(url: string): Promise<void> {
  if (wailsService()?.OpenReleasePage) return wailsService()!.OpenReleasePage(url);
  if (typeof window !== "undefined") window.open(url, "_blank");
}

// Downloads the matching build, replaces the running binary, and relaunches. Resolves with an
// error string ("" on success, just before the app restarts). Desktop only.
export async function performUpdate(): Promise<string> {
  if (wailsService()?.PerformUpdate) return wailsService()!.PerformUpdate();
  return "Auto-update is only available in the desktop app.";
}

export async function saveEnvironment(environment: Environment): Promise<void> {
  if (wailsService()?.SaveEnvironment) {
    return wailsService()!.SaveEnvironment(environment);
  }
  const environments = readLocal<Environment[]>("yarc.environments", defaultEnvironments);
  const next = environments.some((item) => item.id === environment.id) ? environments.map((item) => (item.id === environment.id ? environment : item)) : [...environments, environment];
  localStorage.setItem("yarc.environments", JSON.stringify(next));
}

// Kept in sync with PROXY_PATH in vite.config.ts. The dev/preview server performs the
// request from Node so the browser preview is not blocked by CORS.
const PROXY_PATH = "/__yarc_proxy";

type ProxyResult = {
  statusCode?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
};

export type RawRequest = { url: string; method: string; headers: Record<string, string>; body?: string };
export type RawResponse = { statusCode: number; statusText: string; headers: Record<string, string>; body: string; error?: string };

async function requestViaProxy(input: RawRequest): Promise<ProxyResult | null> {
  try {
    const response = await fetch(PROXY_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return null;
    const data = (await response.json()) as ProxyResult;
    if (typeof data.statusCode !== "number" && typeof data.error !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

// Sends a request through the dev/preview proxy (no CORS); falls back to a direct fetch
// when the proxy middleware is unavailable (e.g. a static build with no server).
export async function relayRequest(input: RawRequest): Promise<RawResponse> {
  const proxied = await requestViaProxy(input);
  if (proxied) {
    if (proxied.error) return { statusCode: 0, statusText: "", headers: {}, body: "", error: proxied.error };
    return { statusCode: proxied.statusCode ?? 0, statusText: proxied.statusText ?? "", headers: proxied.headers ?? {}, body: proxied.body ?? "" };
  }
  try {
    const response = await fetch(input.url, { method: input.method, headers: input.headers, body: input.body });
    const body = await response.text();
    return { statusCode: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), body };
  } catch (error) {
    return { statusCode: 0, statusText: "", headers: {}, body: "", error: error instanceof Error ? error.message : "Request failed" };
  }
}

// Resolves a request into what actually goes over the wire (variables, query params, auth, body).
function resolveOutgoing(request: ApiRequest): RawRequest {
  const variables = request.environment ?? {};
  const url = applyAuthToURL(resolveVariables(applyQuery(request.url, request.queryParams), variables), request);
  const headers = buildHeaders(request);
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.body ? resolveVariables(request.body, variables) : undefined;
  return { url, method: request.method, headers, body };
}

export async function executeHttpRequest(request: ApiRequest): Promise<ApiResponse> {
  if (wailsService()?.ExecuteHTTPRequest) {
    return wailsService()!.ExecuteHTTPRequest(request);
  }

  const started = performance.now();
  const outgoing = resolveOutgoing(request);

  if (!outgoing.url || !/^https?:\/\//i.test(outgoing.url)) {
    return { statusCode: 0, status: "Invalid URL", headers: {}, body: "", bodySize: 0, durationMs: 0, receivedAt: new Date().toISOString(), resolvedUrl: outgoing.url ?? "", error: "Enter a valid URL starting with http:// or https://" };
  }

  const result = await relayRequest(outgoing);
  const durationMs = Math.round(performance.now() - started);
  const receivedAt = new Date().toISOString();

  if (result.error) {
    return { statusCode: 0, status: "Request failed", headers: {}, body: "", bodySize: 0, durationMs, receivedAt, resolvedUrl: outgoing.url, error: result.error };
  }
  return {
    statusCode: result.statusCode,
    status: `${result.statusCode} ${result.statusText}`.trim(),
    headers: result.headers,
    body: result.body,
    bodySize: result.body.length,
    durationMs,
    receivedAt,
    resolvedUrl: outgoing.url,
  };
}

const PROXY_STREAM_PATH = "/__yarc_proxy_stream";

export type StreamMeta = { statusCode: number; status: string; headers: Record<string, string>; resolvedUrl: string; sent?: SentRequestInfo };
export type StreamHandlers = { onMeta: (meta: StreamMeta) => void; onChunk: (text: string) => void };
export type StreamResult = { error?: string };

function sentInfo(outgoing: RawRequest): SentRequestInfo {
  return { method: outgoing.method, url: outgoing.url, headers: outgoing.headers, body: outgoing.body ?? "" };
}

// Streams an HTTP response, invoking onChunk as bytes arrive. In the desktop app it drives the Go
// backend over Wails events (cancellable); in the browser preview it streams through the dev proxy.
export async function streamHttpRequest(request: ApiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
  const outgoing = resolveOutgoing(request);
  if (!outgoing.url || !/^https?:\/\//i.test(outgoing.url)) {
    return { error: "Enter a valid URL starting with http:// or https://" };
  }

  if (inWails) {
    return new Promise<StreamResult>((resolve) => {
      const id = crypto.randomUUID();
      const base = `yarc:stream:${id}`;
      const offs: Array<() => void> = [];
      let settled = false;
      const finish = (result: StreamResult) => {
        if (settled) return;
        settled = true;
        offs.forEach((off) => off());
        resolve(result);
      };
      offs.push(Events.On(`${base}:meta`, (event: { data: any }) => {
        const meta = event.data ?? {};
        handlers.onMeta({ statusCode: meta.statusCode, status: meta.status ?? "", headers: meta.headers ?? {}, resolvedUrl: meta.resolvedUrl ?? outgoing.url, sent: meta.sent });
      }));
      offs.push(Events.On(`${base}:chunk`, (event: { data: any }) => {
        handlers.onChunk(typeof event.data === "string" ? event.data : String(event.data ?? ""));
      }));
      offs.push(Events.On(`${base}:done`, (event: { data: any }) => finish({ error: event.data?.error })));
      if (signal) {
        signal.addEventListener("abort", () => {
          void (AppService as any).CancelHTTPStream(id);
          finish({ error: "Aborted" });
        });
      }
      void (AppService as any).ExecuteHTTPStream(id, request).catch((error: unknown) => finish({ error: error instanceof Error ? error.message : "Request failed" }));
    });
  }

  // Browser/dev preview: stream through the Node proxy (no CORS).
  try {
    const response = await fetch(PROXY_STREAM_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outgoing),
      signal,
    });
    if (!response.ok || !response.body) {
      // Proxy unavailable (e.g. static build) — fall back to a single buffered chunk.
      const buffered = await relayRequest(outgoing);
      handlers.onMeta({ statusCode: buffered.statusCode, status: `${buffered.statusCode} ${buffered.statusText}`.trim(), headers: buffered.headers, resolvedUrl: outgoing.url, sent: sentInfo(outgoing) });
      if (buffered.error) return { error: buffered.error };
      handlers.onChunk(buffered.body);
      return {};
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let metaParsed = false;
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (!metaParsed) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) continue;
        const meta = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        metaParsed = true;
        if (meta.error) return { error: meta.error };
        handlers.onMeta({ statusCode: meta.statusCode, status: `${meta.statusCode} ${meta.statusText ?? ""}`.trim(), headers: meta.headers ?? {}, resolvedUrl: outgoing.url, sent: sentInfo(outgoing) });
      }
      if (buffer) {
        handlers.onChunk(buffer);
        buffer = "";
      }
    }
    return {};
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") return { error: "Aborted" };
    return { error: error instanceof Error ? error.message : "Request failed" };
  }
}

export async function listHistory(query: string): Promise<HistoryEntry[]> {
  if (wailsService()?.ListHistory) {
    return wailsService()!.ListHistory(query);
  }
  const history = readLocal<HistoryEntry[]>("yarc.history", []);
  if (!query) return history;
  const lower = query.toLowerCase();
  return history.filter((entry) => `${entry.request.method} ${entry.request.url} ${entry.response.status}`.toLowerCase().includes(lower));
}

export async function generateSnippet(language: string, request: ApiRequest): Promise<string> {
  // The Go backend resolves file-type variables from disk (so the snippet shows real content,
  // not the linked path). The browser preview can't read the filesystem, so it falls back to
  // the client-side generator, which substitutes the variable's stored text.
  if (wailsService()?.GenerateSnippet) {
    return wailsService()!.GenerateSnippet({ language, request });
  }
  return buildSnippet(language, request);
}

const grpcBrowserUnavailable = "gRPC runs over HTTP/2 and is only available in the Yarc desktop app, not the browser preview.";

export async function listGrpcMethods(request: GrpcRequest): Promise<GrpcMethodList> {
  if (wailsService()?.ListGRPCMethods) {
    return wailsService()!.ListGRPCMethods(request);
  }
  if (request.useReflection) {
    return { methods: [], error: grpcBrowserUnavailable };
  }
  return { methods: parseProtoMethods(request.protoSource), error: "" };
}

export async function invokeGrpc(request: GrpcRequest): Promise<GrpcInvokeResponse> {
  if (wailsService()?.InvokeGRPC) {
    return wailsService()!.InvokeGRPC(request);
  }
  return {
    body: "",
    statusCode: 0,
    status: "Error",
    trailers: {},
    durationMs: 0,
    error: grpcBrowserUnavailable,
  };
}

function parseProtoMethods(source: string): GrpcMethodList["methods"] {
  const methods: GrpcMethodList["methods"] = [];
  const packageMatch = source.match(/package\s+([\w.]+)\s*;/);
  const pkg = packageMatch ? packageMatch[1] : "";
  const serviceRegex = /service\s+(\w+)\s*\{([\s\S]*?)\}/g;
  for (const serviceMatch of source.matchAll(serviceRegex)) {
    const [, serviceName, body] = serviceMatch;
    const fullService = pkg ? `${pkg}.${serviceName}` : serviceName;
    const rpcRegex = /rpc\s+(\w+)\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([\w.]+)\s*\)/g;
    for (const rpcMatch of body.matchAll(rpcRegex)) {
      methods.push({
        service: fullService,
        method: rpcMatch[1],
        fullMethod: `${fullService}/${rpcMatch[1]}`,
        requestType: rpcMatch[3],
        responseType: rpcMatch[5],
        clientStreaming: Boolean(rpcMatch[2]),
        serverStreaming: Boolean(rpcMatch[4]),
      });
    }
  }
  return methods;
}

function resolveVariables(value: string, variables: Record<string, { text: string; type: string; fileName?: string; }> | undefined) {
  const withEnv = Object.entries(variables ?? {}).reduce((next, [key, variable]) => next.replaceAll(`{{${key}}}`, variable.text), value ?? "");
  return applyDynamicVars(withEnv);
}

function applyQuery(url: string, params: ApiRequest["queryParams"]) {
  const enabled = params.filter((param) => param.enabled && param.key);
  if (enabled.length === 0) return url;

  const [base, rawQuery = ""] = url.split("?");
  const search = new URLSearchParams(rawQuery);
  enabled.forEach((param) => search.set(param.key, param.value));
  return `${base}?${search.toString()}`;
}

function buildHeaders(request: ApiRequest) {
  const headers = Object.fromEntries(request.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, resolveVariables(h.value, request.environment)]));
  if (request.auth.type === "bearer" && request.auth.token) {
    headers[request.auth.headerName || "Authorization"] = `Bearer ${resolveVariables(request.auth.token, request.environment)}`;
  }
  if (request.auth.type === "basic") {
    headers.Authorization = `Basic ${btoa(`${resolveVariables(request.auth.username ?? "", request.environment)}:${resolveVariables(request.auth.password ?? "", request.environment)}`)}`;
  }
  if (request.auth.type === "apiKey" && request.auth.addTo !== "query" && request.auth.key) {
    headers[resolveVariables(request.auth.key, request.environment)] = resolveVariables(request.auth.value ?? "", request.environment);
  }
  const oauthToken = request.auth.accessToken || request.auth.token;
  if (request.auth.type === "oauth2" && oauthToken) {
    headers[request.auth.headerName || "Authorization"] = `${request.auth.headerPrefix || "Bearer"} ${resolveVariables(oauthToken, request.environment)}`;
  }
  return headers;
}

function applyAuthToURL(url: string, request: ApiRequest) {
  if (request.auth.type !== "apiKey" || request.auth.addTo !== "query" || !request.auth.key) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(resolveVariables(request.auth.key, request.environment), resolveVariables(request.auth.value ?? "", request.environment));
  return parsed.toString();
}

function workspaceOnly(): CollectionNode[] {
  return [{ id: "workspace", kind: "workspace", name: "Workspace", tags: [], favorite: false }];
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}
