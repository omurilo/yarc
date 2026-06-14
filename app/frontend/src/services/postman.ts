import type { ApiRequest, CollectionNode, Environment, FormField, HeaderRow, HttpMethod } from "../types/api";

// Postman Collection v2.1 + Environment importer. Postman uses the same `{{var}}` template syntax
// and a `pm.*` scripting API, both compatible with Yarc, so requests/scripts map over directly.

type PmKV = { key?: string; value?: string; disabled?: boolean };
type PmUrl = string | { raw?: string; protocol?: string; host?: string[] | string; path?: string[] | string; query?: PmKV[] };
type PmFormData = { key?: string; value?: string; src?: string; type?: string; contentType?: string; disabled?: boolean };
type PmBody = {
  mode?: string;
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: PmKV[];
  formdata?: PmFormData[];
  graphql?: { query?: string; variables?: string };
};
type PmAuth = { type?: string; bearer?: PmKV[]; basic?: PmKV[]; apikey?: PmKV[] };
type PmEvent = { listen?: string; script?: { exec?: string[] | string } };
type PmRequest = { method?: string; header?: PmKV[]; url?: PmUrl; body?: PmBody; auth?: PmAuth };
type PmItem = { name?: string; item?: PmItem[]; request?: PmRequest; event?: PmEvent[] };
type PmCollection = { info?: { name?: string; schema?: string }; item?: PmItem[]; variable?: PmKV[]; auth?: PmAuth };
type PmEnvironment = { name?: string; values?: PmKV[]; _postman_variable_scope?: string };

export function isPostmanCollection(value: unknown): value is PmCollection {
  if (!value || typeof value !== "object") return false;
  const v = value as PmCollection;
  return Array.isArray(v.item) && typeof v.info?.schema === "string" && v.info.schema.includes("getpostman");
}

export function isPostmanEnvironment(value: unknown): value is PmEnvironment {
  if (!value || typeof value !== "object") return false;
  const v = value as PmEnvironment;
  return Array.isArray(v.values) && (v._postman_variable_scope === "environment" || typeof v.name === "string");
}

export function parsePostmanEnvironment(env: PmEnvironment): Environment {
  const variables: Environment["variables"] = {};
  for (const entry of env.values ?? []) {
    if (entry.key) variables[entry.key] = { text: entry.value ?? "", type: "text" };
  }
  return { id: crypto.randomUUID(), name: env.name || "Imported environment", variables, secrets: [], active: false };
}

export function parsePostman(collection: PmCollection): { collections: CollectionNode[]; environments: Environment[] } {
  const nodes: CollectionNode[] = [];
  const rootId = crypto.randomUUID();

  const variables = kvToVars(collection.variable);
  nodes.push({
    id: rootId,
    parentId: "workspace",
    kind: "folder",
    name: collection.info?.name || "Postman collection",
    tags: [],
    favorite: false,
    ...(Object.keys(variables).length ? { variables } : {}),
  });

  const walk = (items: PmItem[] | undefined, parentId: string) => {
    for (const item of items ?? []) {
      if (Array.isArray(item.item)) {
        const id = crypto.randomUUID();
        nodes.push({ id, parentId, kind: "folder", name: item.name || "Folder", tags: [], favorite: false });
        walk(item.item, id);
      } else if (item.request) {
        const id = crypto.randomUUID();
        const request = toApiRequest(item, id);
        nodes.push({
          id,
          parentId,
          kind: "request",
          name: request.name,
          method: request.method,
          url: request.url,
          tags: [],
          favorite: false,
          request,
        });
      }
    }
  };
  walk(collection.item, rootId);

  return { collections: nodes, environments: [] };
}

function toApiRequest(item: PmItem, id: string): ApiRequest {
  const req = item.request ?? {};
  const { bodyType, body, formFields } = mapBody(req.body);
  return {
    id,
    name: item.name?.trim() || urlString(req.url) || "Imported request",
    method: (req.method || "GET").toUpperCase() as HttpMethod,
    url: urlString(req.url),
    queryParams: mapKV(typeof req.url === "object" ? req.url?.query : undefined),
    headers: mapKV(req.header),
    bodyType,
    body,
    formFields,
    auth: mapAuth(req.auth),
    preRequestScript: scriptFor(item, "prerequest"),
    tests: scriptFor(item, "test"),
    environment: {},
    timeoutMs: 30000,
  };
}

function mapKV(entries?: PmKV[]): HeaderRow[] {
  return (entries ?? [])
    .filter((entry) => (entry.key ?? "") !== "")
    .map((entry) => ({ key: entry.key ?? "", value: entry.value ?? "", enabled: entry.disabled !== true }));
}

function kvToVars(entries?: PmKV[]): Record<string, { text: string; type: string }> {
  const vars: Record<string, { text: string; type: string }> = {};
  for (const entry of entries ?? []) {
    if (entry.key) vars[entry.key] = { text: entry.value ?? "", type: "text" };
  }
  return vars;
}

function urlString(url?: PmUrl): string {
  if (!url) return "";
  if (typeof url === "string") return stripQuery(url);
  if (url.raw) return stripQuery(url.raw);
  const host = Array.isArray(url.host) ? url.host.join(".") : url.host ?? "";
  const path = Array.isArray(url.path) ? url.path.join("/") : url.path ?? "";
  const proto = url.protocol ? `${url.protocol}://` : "";
  return `${proto}${host}${path ? `/${path}` : ""}`;
}

function stripQuery(raw: string): string {
  const q = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}

function mapBody(body?: PmBody): { bodyType: ApiRequest["bodyType"]; body: string; formFields?: FormField[] } {
  if (!body || !body.mode) return { bodyType: "json", body: "" };
  switch (body.mode) {
    case "raw": {
      const lang = body.options?.raw?.language;
      const type: ApiRequest["bodyType"] = lang === "xml" ? "xml" : lang === "json" || !lang ? "json" : "text";
      return { bodyType: type, body: body.raw ?? "" };
    }
    case "urlencoded":
      return { bodyType: "form", body: "", formFields: mapForm(body.urlencoded) };
    case "formdata":
      return { bodyType: "multipart", body: "", formFields: mapForm(body.formdata) };
    case "graphql":
      return { bodyType: "json", body: JSON.stringify({ query: body.graphql?.query ?? "", variables: safeParse(body.graphql?.variables) }, null, 2) };
    default:
      return { bodyType: "text", body: body.raw ?? "" };
  }
}

function mapForm(entries?: (PmKV | PmFormData)[]): FormField[] {
  return (entries ?? [])
    .filter((entry) => (entry.key ?? "") !== "")
    .map((entry) => {
      const fd = entry as PmFormData;
      const isFile = fd.type === "file" || Boolean(fd.src);
      return {
        key: entry.key ?? "",
        value: isFile ? fd.src ?? "" : entry.value ?? "",
        type: isFile ? "file" : "text",
        enabled: entry.disabled !== true,
        ...(isFile ? { fileName: (fd.src ?? "").split(/[\\/]/).pop() || "", contentType: fd.contentType } : {}),
      } as FormField;
    });
}

function mapAuth(auth?: PmAuth): Record<string, string> {
  if (!auth?.type) return {};
  const pick = (list: PmKV[] | undefined, key: string) => list?.find((entry) => entry.key === key)?.value ?? "";
  switch (auth.type) {
    case "bearer":
      return { type: "bearer", token: pick(auth.bearer, "token"), headerName: "Authorization" };
    case "basic":
      return { type: "basic", username: pick(auth.basic, "username"), password: pick(auth.basic, "password") };
    case "apikey":
      return {
        type: "apiKey",
        key: pick(auth.apikey, "key"),
        value: pick(auth.apikey, "value"),
        addTo: pick(auth.apikey, "in") === "query" ? "query" : "header",
      };
    default:
      return {};
  }
}

function scriptFor(item: PmItem, listen: string): string {
  const event = item.event?.find((e) => e.listen === listen);
  const exec = event?.script?.exec;
  if (!exec) return "";
  return Array.isArray(exec) ? exec.join("\n") : exec;
}

function safeParse(value?: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return value ?? {};
  }
}
