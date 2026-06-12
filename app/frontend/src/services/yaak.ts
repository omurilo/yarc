import type { ApiRequest, CollectionNode, Environment, FormField, HeaderRow, HttpMethod } from "../types/api";

// Yaak export format (yaakSchema 4). A single JSON file under `resources` holding workspaces,
// folders, httpRequests, environments. Requests/folders nest via `folderId`, rooting at a
// `workspaceId`. We translate that tree into Yarc collection nodes (+ environments).
// Reference: an export's top level is { yaakVersion, yaakSchema, resources: {...} }.

type YaakEntry = { name?: string; value?: string; enabled?: boolean; file?: string; contentType?: string };

type YaakRequest = {
  model: string;
  id: string;
  name?: string;
  method?: string;
  url?: string;
  folderId?: string | null;
  workspaceId?: string | null;
  headers?: YaakEntry[];
  urlParameters?: YaakEntry[];
  authentication?: Record<string, unknown>;
  authenticationType?: string | null;
  body?: Record<string, unknown>;
  bodyType?: string | null;
};

type YaakFolder = { model: string; id: string; name?: string; folderId?: string | null; workspaceId?: string | null };
type YaakWorkspace = { model: string; id: string; name?: string };
type YaakEnvironment = { model: string; id: string; name?: string; variables?: YaakEntry[]; base?: boolean };

type YaakExport = {
  yaakSchema?: number;
  resources?: {
    workspaces?: YaakWorkspace[];
    folders?: YaakFolder[];
    httpRequests?: YaakRequest[];
    environments?: YaakEnvironment[];
  };
};

export function isYaakExport(value: unknown): value is YaakExport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as YaakExport;
  return typeof candidate.yaakSchema === "number" && typeof candidate.resources === "object";
}

export function parseYaak(data: YaakExport): { collections: CollectionNode[]; environments: Environment[] } {
  const resources = data.resources ?? {};
  const workspaces = resources.workspaces ?? [];
  const folders = resources.folders ?? [];
  const requests = (resources.httpRequests ?? []).filter((request) => request.model === "http_request");

  const idMap = new Map<string, string>();
  const idFor = (yaakId: string) => {
    const existing = idMap.get(yaakId);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    idMap.set(yaakId, generated);
    return generated;
  };

  const nodes: CollectionNode[] = [];
  const wantWorkspaceFolders = workspaces.length > 1;

  // Each Yaak workspace becomes a top-level folder (only when there's more than one; a single
  // workspace's contents drop straight under the Yarc root to avoid a redundant wrapper).
  for (const workspace of workspaces) {
    if (!wantWorkspaceFolders) {
      idMap.set(workspace.id, "workspace");
      continue;
    }
    nodes.push({
      id: idFor(workspace.id),
      parentId: "workspace",
      kind: "folder",
      name: workspace.name || "Workspace",
      tags: [],
      favorite: false,
    });
  }

  const parentOf = (folderId?: string | null, workspaceId?: string | null) => {
    if (folderId) return idFor(folderId);
    if (workspaceId && idMap.has(workspaceId)) return idMap.get(workspaceId)!;
    return "workspace";
  };

  for (const folder of folders) {
    if (folder.model !== "folder") continue;
    nodes.push({
      id: idFor(folder.id),
      parentId: parentOf(folder.folderId, folder.workspaceId),
      kind: "folder",
      name: folder.name || "Folder",
      tags: [],
      favorite: false,
    });
  }

  for (const request of requests) {
    const id = idFor(request.id);
    const apiRequest = toApiRequest(request, id);
    nodes.push({
      id,
      parentId: parentOf(request.folderId, request.workspaceId),
      kind: "request",
      name: apiRequest.name,
      method: apiRequest.method,
      url: apiRequest.url,
      tags: [],
      favorite: false,
      request: apiRequest,
    });
  }

  const environments = (resources.environments ?? [])
    .filter((environment) => environment.model === "environment")
    .map((environment, index) => toEnvironment(environment, index));

  return { collections: nodes, environments };
}

function toApiRequest(request: YaakRequest, id: string): ApiRequest {
  const method = (request.method || "GET").toUpperCase() as HttpMethod;
  const { bodyType, body, formFields } = mapBody(request);
  return {
    id,
    name: request.name?.trim() || request.url || "Imported request",
    method,
    url: request.url || "",
    queryParams: mapEntries(request.urlParameters),
    headers: mapEntries(request.headers),
    bodyType,
    body,
    formFields,
    auth: mapAuth(request),
    tests: "",
    environment: {},
    timeoutMs: 30000,
  };
}

function mapEntries(entries?: YaakEntry[]): HeaderRow[] {
  return (entries ?? [])
    .filter((entry) => (entry.name ?? "") !== "")
    .map((entry) => ({ key: entry.name ?? "", value: entry.value ?? "", enabled: entry.enabled !== false }));
}

function mapBody(request: YaakRequest): { bodyType: ApiRequest["bodyType"]; body: string; formFields?: FormField[] } {
  const type = (request.bodyType ?? "").toLowerCase();
  const body = (request.body ?? {}) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : "";

  if (type.includes("json") || type === "graphql") {
    if (type === "graphql") {
      const query = typeof body.query === "string" ? body.query : "";
      const variables = typeof body.variables === "string" ? body.variables : "";
      return { bodyType: "json", body: JSON.stringify({ query, variables: safeParse(variables) }, null, 2) };
    }
    return { bodyType: "json", body: text };
  }
  if (type.includes("xml")) return { bodyType: "xml", body: text };
  if (type.includes("x-www-form-urlencoded")) return { bodyType: "form", body: "", formFields: mapForm(body.form) };
  if (type.includes("multipart")) return { bodyType: "multipart", body: "", formFields: mapForm(body.form) };
  return { bodyType: "text", body: text };
}

function mapForm(form: unknown): FormField[] {
  if (!Array.isArray(form)) return [];
  return (form as YaakEntry[])
    .filter((entry) => (entry.name ?? "") !== "" || (entry.file ?? "") !== "")
    .map((entry) => {
      const isFile = Boolean(entry.file);
      return {
        key: entry.name ?? "",
        value: isFile ? (entry.file ?? "") : entry.value ?? "",
        type: isFile ? "file" : "text",
        enabled: entry.enabled !== false,
        ...(isFile ? { fileName: (entry.file ?? "").split(/[\\/]/).pop() || "", contentType: entry.contentType } : {}),
      } as FormField;
    });
}

function mapAuth(request: YaakRequest): Record<string, string> {
  const type = (request.authenticationType ?? "").toLowerCase();
  const auth = (request.authentication ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof auth[key] === "string" ? (auth[key] as string) : "");
  switch (type) {
    case "bearer":
      return { type: "bearer", token: str("token"), headerName: "Authorization" };
    case "basic":
      return { type: "basic", username: str("username"), password: str("password") };
    case "apikey":
      return {
        type: "apiKey",
        key: str("key"),
        value: str("value"),
        addTo: (str("location") || str("addTo")) === "query" ? "query" : "header",
      };
    default:
      return {};
  }
}

function toEnvironment(environment: YaakEnvironment, index: number): Environment {
  const variables: Environment["variables"] = {};
  for (const entry of environment.variables ?? []) {
    if (!entry.name) continue;
    variables[entry.name] = { text: entry.value ?? "", type: "text" };
  }
  return {
    id: crypto.randomUUID(),
    name: environment.name || `Imported environment ${index + 1}`,
    variables,
    secrets: [],
    active: false,
  };
}

function safeParse(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return value;
  }
}
