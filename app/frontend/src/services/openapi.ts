import type { ApiRequest, CollectionNode, HeaderRow, HttpMethod } from "../types/api";

// OpenAPI 3.x + Swagger 2.0 importer (JSON). Each operation becomes a request, grouped into
// folders by its first tag. The server URL is stored as a `{{baseUrl}}` collection variable so
// it stays editable, and request bodies are seeded with an example derived from the schema.

type AnyObj = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export function isOpenApi(value: unknown): value is AnyObj {
  if (!value || typeof value !== "object") return false;
  const v = value as AnyObj;
  return (typeof v.openapi === "string" && v.openapi.startsWith("3")) || v.swagger === "2.0";
}

export function parseOpenApi(doc: AnyObj): { collections: CollectionNode[]; environments: never[] } {
  const info = (doc.info as AnyObj) ?? {};
  const isV2 = doc.swagger === "2.0";
  const baseUrl = resolveBaseUrl(doc, isV2);
  const rootId = crypto.randomUUID();

  const nodes: CollectionNode[] = [
    {
      id: rootId,
      parentId: "workspace",
      kind: "folder",
      name: (info.title as string) || "OpenAPI",
      tags: [],
      favorite: false,
      variables: { baseUrl: { text: baseUrl, type: "text" } },
    },
  ];

  // Folder per tag, created lazily.
  const tagFolders = new Map<string, string>();
  const folderFor = (tag: string): string => {
    const existing = tagFolders.get(tag);
    if (existing) return existing;
    const id = crypto.randomUUID();
    nodes.push({ id, parentId: rootId, kind: "folder", name: tag, tags: [], favorite: false });
    tagFolders.set(tag, id);
    return id;
  };

  const paths = (doc.paths as AnyObj) ?? {};
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = pathItemRaw as AnyObj;
    const pathParams = (pathItem.parameters as AnyObj[]) ?? [];
    for (const method of METHODS) {
      const op = pathItem[method] as AnyObj | undefined;
      if (!op) continue;
      const tag = (op.tags as string[])?.[0] || "default";
      const id = crypto.randomUUID();
      const request = operationToRequest(doc, op, [...pathParams, ...(((op.parameters as AnyObj[]) ?? []))], method, path, isV2, id);
      nodes.push({
        id,
        parentId: folderFor(tag),
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

  return { collections: nodes, environments: [] };
}

function resolveBaseUrl(doc: AnyObj, isV2: boolean): string {
  if (isV2) {
    const scheme = ((doc.schemes as string[]) ?? ["https"])[0];
    const host = (doc.host as string) ?? "";
    const basePath = (doc.basePath as string) ?? "";
    return host ? `${scheme}://${host}${basePath}` : "";
  }
  const servers = doc.servers as AnyObj[] | undefined;
  return (servers?.[0]?.url as string) ?? "";
}

function operationToRequest(doc: AnyObj, op: AnyObj, params: AnyObj[], method: string, path: string, isV2: boolean, id: string): ApiRequest {
  const queryParams: HeaderRow[] = [];
  const headers: HeaderRow[] = [];
  for (const p of params) {
    const where = p.in as string;
    const name = p.name as string;
    if (!name) continue;
    const value = exampleScalar(p.schema as AnyObj, (p as AnyObj).default);
    if (where === "query") queryParams.push({ key: name, value, enabled: p.required === true });
    else if (where === "header") headers.push({ key: name, value, enabled: p.required === true });
  }

  const { bodyType, body, contentType } = requestBody(doc, op, params, isV2);
  if (contentType && !headers.some((h) => h.key.toLowerCase() === "content-type")) {
    headers.push({ key: "Content-Type", value: contentType, enabled: true });
  }

  return {
    id,
    name: (op.summary as string) || (op.operationId as string) || `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase() as HttpMethod,
    url: `{{baseUrl}}${path}`,
    queryParams,
    headers,
    bodyType,
    body,
    auth: securityToAuth(doc, op, isV2),
    tests: "",
    environment: {},
    timeoutMs: 30000,
  };
}

function requestBody(doc: AnyObj, op: AnyObj, params: AnyObj[], isV2: boolean): { bodyType: ApiRequest["bodyType"]; body: string; contentType?: string } {
  if (isV2) {
    const bodyParam = params.find((p) => p.in === "body");
    if (bodyParam?.schema) return { bodyType: "json", body: jsonExample(doc, bodyParam.schema as AnyObj), contentType: "application/json" };
    return { bodyType: "json", body: "" };
  }
  const content = ((op.requestBody as AnyObj)?.content as AnyObj) ?? {};
  const jsonKey = Object.keys(content).find((k) => k.includes("json"));
  if (jsonKey) return { bodyType: "json", body: jsonExample(doc, (content[jsonKey] as AnyObj).schema as AnyObj), contentType: jsonKey };
  const xmlKey = Object.keys(content).find((k) => k.includes("xml"));
  if (xmlKey) return { bodyType: "xml", body: "", contentType: xmlKey };
  return { bodyType: "json", body: "" };
}

function securityToAuth(doc: AnyObj, op: AnyObj, isV2: boolean): Record<string, string> {
  const requirement = ((op.security as AnyObj[]) ?? (doc.security as AnyObj[]))?.[0];
  if (!requirement) return {};
  const schemeName = Object.keys(requirement)[0];
  const schemes = isV2 ? (doc.securityDefinitions as AnyObj) : ((doc.components as AnyObj)?.securitySchemes as AnyObj);
  const scheme = schemes?.[schemeName] as AnyObj | undefined;
  if (!scheme) return {};
  const type = scheme.type as string;
  if (type === "http" && (scheme.scheme as string)?.toLowerCase() === "basic") {
    return { type: "basic", username: "{{username}}", password: "{{password}}" };
  }
  if (type === "http" || type === "oauth2") {
    return { type: "bearer", token: "{{token}}", headerName: "Authorization" };
  }
  if (type === "apiKey") {
    return { type: "apiKey", key: (scheme.name as string) || "X-API-Key", value: "{{apiKey}}", addTo: scheme.in === "query" ? "query" : "header" };
  }
  return {};
}

// ------------------------------------------------------------------- schema → example

function resolveRef(doc: AnyObj, schema: AnyObj | undefined): AnyObj | undefined {
  if (!schema) return undefined;
  const ref = schema.$ref as string | undefined;
  if (!ref) return schema;
  const parts = ref.replace(/^#\//, "").split("/");
  let node: unknown = doc;
  for (const part of parts) node = (node as AnyObj)?.[part];
  return node as AnyObj | undefined;
}

function jsonExample(doc: AnyObj, schema: AnyObj | undefined): string {
  try {
    return JSON.stringify(buildExample(doc, schema, 0, new Set()), null, 2);
  } catch {
    return "";
  }
}

function buildExample(doc: AnyObj, raw: AnyObj | undefined, depth: number, seen: Set<string>): unknown {
  const schema = resolveRef(doc, raw);
  if (!schema || depth > 6) return null;
  if ("example" in schema) return schema.example;
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum)) return (schema.enum as unknown[])[0];

  // Track $ref to avoid infinite recursion on self-referential schemas.
  const ref = raw?.$ref as string | undefined;
  if (ref) {
    if (seen.has(ref)) return null;
    seen.add(ref);
  }

  const allOf = schema.allOf as AnyObj[] | undefined;
  if (allOf) return allOf.reduce<AnyObj>((acc, part) => ({ ...acc, ...(buildExample(doc, part, depth, seen) as AnyObj) }), {});

  const type = schema.type as string | undefined;
  if (type === "object" || schema.properties) {
    const props = (schema.properties as AnyObj) ?? {};
    const out: AnyObj = {};
    for (const [key, propSchema] of Object.entries(props)) out[key] = buildExample(doc, propSchema as AnyObj, depth + 1, seen);
    return out;
  }
  if (type === "array") return [buildExample(doc, schema.items as AnyObj, depth + 1, seen)];
  return scalarFor(type, schema.format as string | undefined);
}

function exampleScalar(schema: AnyObj | undefined, fallback: unknown): string {
  if (fallback !== undefined) return String(fallback);
  if (!schema) return "";
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);
  if (Array.isArray(schema.enum)) return String((schema.enum as unknown[])[0] ?? "");
  return "";
}

function scalarFor(type?: string, format?: string): unknown {
  switch (type) {
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      if (format === "date-time") return "1970-01-01T00:00:00Z";
      if (format === "date") return "1970-01-01";
      if (format === "uuid") return "00000000-0000-0000-0000-000000000000";
      return "string";
    default:
      return null;
  }
}
