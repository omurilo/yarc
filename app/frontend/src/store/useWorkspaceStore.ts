import { create } from "zustand";
import { deleteCollections, saveCollection, saveCollections, saveEnvironment } from "../services/apiClient";
import type { ApiRequest, ApiResponse, CollectionNode, Environment, HistoryEntry, WorkspaceBootstrap } from "../types/api";

const starterRequest: ApiRequest = {
  id: "draft",
  name: "Untitled request",
  method: "GET",
  url: "",
  queryParams: [],
  headers: [{ key: "Accept", value: "application/json", enabled: true }],
  bodyType: "json",
  body: "",
  auth: {},
  tests: "",
  environment: {},
  timeoutMs: 30000,
};

type WorkspaceState = {
  activeView: "rest" | "graphql" | "websocket" | "grpc" | "flows" | "history" | "settings";
  commandOpen: boolean;
  activeRequest: ApiRequest;
  activeResponse?: ApiResponse;
  history: HistoryEntry[];
  environments: Environment[];
  activeEnvironmentId: string;
  collections: CollectionNode[];
  selectedCollectionId: string;
  hydrate: (bootstrap: WorkspaceBootstrap) => void;
  setActiveView: (view: WorkspaceState["activeView"]) => void;
  setCommandOpen: (open: boolean) => void;
  updateRequest: (patch: Partial<ApiRequest>) => void;
  setResponse: (response: ApiResponse) => void;
  clearResponse: () => void;
  addHistory: (entry: HistoryEntry) => void;
  clearHistory: (requestId: string) => void;
  addCollection: (kind: "folder" | "request") => void;
  addCollectionInside: (parentId: string, kind: "folder" | "request") => void;
  selectCollection: (id: string) => void;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  moveCollection: (id: string, parentId: string) => void;
  openCollectionRequest: (node: CollectionNode) => void;
  saveActiveRequest: () => void;
  persistActiveRequest: () => void;
  duplicateActiveRequest: () => void;
  importRequest: (request: ApiRequest, parentId?: string) => void;
  importCollections: (nodes: CollectionNode[]) => void;
  importEnvironments: (environments: Environment[]) => void;
  setActiveEnvironment: (id: string) => void;
  addEnvironment: () => void;
  updateEnvironment: (environment: Environment) => void;
  deleteEnvironment: (id: string) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeView: "rest",
  commandOpen: false,
  activeRequest: starterRequest,
  history: [],
  activeEnvironmentId: "local",
  environments: [],
  collections: [{ id: "workspace", kind: "workspace", name: "Workspace", tags: [], favorite: false }],
  selectedCollectionId: "workspace",
  hydrate: (bootstrap) => {
    const activeEnvironment = bootstrap.environments.find((env) => env.active) ?? bootstrap.environments[0];
    set({
      collections: bootstrap.collections.length > 0 ? bootstrap.collections : get().collections,
      environments: bootstrap.environments,
      history: bootstrap.history,
      activeEnvironmentId: activeEnvironment?.id ?? "local",
    });
  },
  setActiveView: (activeView) => set({ activeView }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  updateRequest: (patch) => set({ activeRequest: { ...get().activeRequest, ...patch } }),
  setResponse: (activeResponse) => set({ activeResponse }),
  clearResponse: () => set({ activeResponse: undefined }),
  addHistory: (entry) => {
    const history = [entry, ...get().history].slice(0, 200);
    localStorage.setItem("yarc.history", JSON.stringify(history));
    set({ history });
  },
  clearHistory: (requestId) => {
    const history = get().history.filter((entry) => entry.request.id !== requestId);
    localStorage.setItem("yarc.history", JSON.stringify(history));
    set({ history });
  },
  addCollection: (kind) => {
    get().addCollectionInside(get().selectedCollectionId, kind);
  },
  addCollectionInside: (targetId, kind) => {
    const id = crypto.randomUUID();
    const selected = get().collections.find((node) => node.id === targetId);
    const parentId = selected?.kind === "folder" ? selected.id : selected?.parentId || "workspace";
    const node: CollectionNode =
      kind === "folder"
        ? { id, parentId, kind, name: "New folder", tags: [], favorite: false }
        : {
            id,
            parentId,
            kind,
            name: "New request",
            method: "GET",
            url: "",
            tags: [],
            favorite: false,
            request: { ...starterRequest, id, name: "New request" },
          };
    const collections = [...get().collections, node];
    set({ collections, selectedCollectionId: id });
    void saveCollection(node);
    if (node.kind === "request") {
      get().openCollectionRequest(node);
    }
  },
  selectCollection: (id) => set({ selectedCollectionId: id }),
  renameCollection: (id, name) => {
    const collections = get().collections.map((node) => (node.id === id ? { ...node, name } : node));
    set({
      collections,
      activeRequest: get().activeRequest.id === id ? { ...get().activeRequest, name } : get().activeRequest,
    });
    const updated = collections.find((node) => node.id === id);
    if (updated) void saveCollection(updated);
  },
  deleteCollection: (id) => {
    if (id === "workspace") return;
    const ids = collectDescendantIds(get().collections, id);
    const removeSet = new Set(ids);
    const collections = get().collections.filter((node) => !removeSet.has(node.id));
    const activeDeleted = removeSet.has(get().activeRequest.id);
    const selectedDeleted = removeSet.has(get().selectedCollectionId);
    set({
      collections,
      selectedCollectionId: selectedDeleted ? "workspace" : get().selectedCollectionId,
      activeRequest: activeDeleted ? starterRequest : get().activeRequest,
      activeResponse: activeDeleted ? undefined : get().activeResponse,
    });
    void deleteCollections(ids);
  },
  moveCollection: (id, parentId) => {
    if (id === "workspace" || id === parentId) return;
    const collections = get().collections;
    const node = collections.find((item) => item.id === id);
    if (!node) return;
    // Disallow dropping a folder into one of its own descendants.
    const descendants = new Set(collectDescendantIds(collections, id));
    if (descendants.has(parentId)) return;
    const target = collections.find((item) => item.id === parentId);
    const resolvedParent = !target ? "workspace" : target.kind === "request" ? target.parentId || "workspace" : target.id;
    if (node.parentId === resolvedParent) return;
    const updated = { ...node, parentId: resolvedParent };
    set({ collections: collections.map((item) => (item.id === id ? updated : item)) });
    void saveCollection(updated);
  },
  openCollectionRequest: (node) => {
    set({ selectedCollectionId: node.id });
    if (node.kind !== "request") return;
    const savedRequest = node.request ?? {
      ...starterRequest,
      id: node.id,
      name: node.name,
      method: node.method ?? "GET",
      url: node.url ?? "",
    };
    set({
      activeView: "rest",
      activeRequest: savedRequest,
    });
  },
  saveActiveRequest: () => {
    const request = get().activeRequest;
    const existing = get().collections.find((node) => node.id === request.id);
    const node: CollectionNode = {
      id: request.id === "draft" ? crypto.randomUUID() : request.id,
      parentId: existing?.parentId ?? "workspace",
      kind: "request",
      name: request.name || "Untitled request",
      method: request.method,
      url: request.url,
      tags: existing?.tags ?? [],
      favorite: existing?.favorite ?? false,
      request,
    };
    const collections = get().collections.some((item) => item.id === node.id) ? get().collections.map((item) => (item.id === node.id ? node : item)) : [...get().collections, node];
    set({ collections, selectedCollectionId: node.id, activeRequest: { ...request, id: node.id, name: node.name } });
    void saveCollection(node);
  },
  persistActiveRequest: () => {
    const state = get();
    const request = state.activeRequest;
    const existing = state.collections.find((node) => node.id === request.id);
    if (!existing || existing.kind !== "request") return;
    const node: CollectionNode = {
      ...existing,
      name: request.name || existing.name,
      method: request.method,
      url: request.url,
      request,
    };
    set({ collections: state.collections.map((item) => (item.id === node.id ? node : item)) });
    void saveCollection(node);
  },
  duplicateActiveRequest: () => {
    const request = get().activeRequest;
    const id = crypto.randomUUID();
    const selected = get().collections.find((node) => node.id === get().selectedCollectionId);
    const parentId = selected?.kind === "folder" ? selected.id : selected?.parentId || "workspace";
    const duplicate = { ...request, id, name: `${request.name || "Untitled request"} copy` };
    const node: CollectionNode = {
      id,
      parentId,
      kind: "request",
      name: duplicate.name,
      method: duplicate.method,
      url: duplicate.url,
      tags: [],
      favorite: false,
      request: duplicate,
    };
    set({ collections: [...get().collections, node], selectedCollectionId: id, activeRequest: duplicate, activeView: "rest" });
    void saveCollection(node);
  },
  importRequest: (request, parentId) => {
    const id = crypto.randomUUID();
    const target = get().collections.find((node) => node.id === (parentId ?? get().selectedCollectionId));
    const resolvedParent = target?.kind === "folder" ? target.id : target?.parentId || "workspace";
    const imported = { ...request, id };
    const node: CollectionNode = {
      id,
      parentId: resolvedParent,
      kind: "request",
      name: imported.name || "Imported request",
      method: imported.method,
      url: imported.url,
      tags: [],
      favorite: false,
      request: imported,
    };
    set({ collections: [...get().collections, node], selectedCollectionId: id, activeRequest: imported, activeView: "rest" });
    void saveCollection(node);
  },
  importCollections: (nodes) => {
    // Remap ids so an imported tree never collides with existing nodes.
    const idMap = new Map<string, string>();
    nodes.forEach((node) => {
      if (node.kind === "workspace") return;
      idMap.set(node.id, crypto.randomUUID());
    });
    const remapped: CollectionNode[] = [];
    for (const node of nodes) {
      if (node.kind === "workspace") continue;
      const id = idMap.get(node.id)!;
      const parentId = node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId)! : "workspace";
      remapped.push({ ...node, id, parentId, request: node.request ? { ...node.request, id } : node.request });
    }
    if (remapped.length === 0) return;
    set({ collections: [...get().collections, ...remapped] });
    void saveCollections(remapped);
  },
  importEnvironments: (environments) => {
    if (environments.length === 0) return;
    set({ environments: [...get().environments, ...environments] });
    environments.forEach((environment) => void saveEnvironment(environment));
  },
  setActiveEnvironment: (id) => {
    const environments = get().environments.map((env) => ({ ...env, active: env.id === id }));
    set({ activeEnvironmentId: id, environments });
    environments.forEach((env) => void saveEnvironment(env));
  },
  addEnvironment: () => {
    const id = crypto.randomUUID();
    const environment: Environment = { id, name: "New environment", variables: {}, secrets: [], active: false };
    set({ environments: [...get().environments, environment] });
    void saveEnvironment(environment);
  },
  updateEnvironment: (environment) => {
    set({ environments: get().environments.map((env) => (env.id === environment.id ? environment : env)) });
    void saveEnvironment(environment);
  },
  deleteEnvironment: (id) => {
    const remaining = get().environments.filter((env) => env.id !== id);
    if (remaining.length === 0) return;
    const activeId = get().activeEnvironmentId === id ? remaining[0].id : get().activeEnvironmentId;
    set({
      environments: remaining.map((env) => ({ ...env, active: env.id === activeId })),
      activeEnvironmentId: activeId,
    });
  },
}));

function collectDescendantIds(collections: CollectionNode[], id: string) {
  const ids = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of collections) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return [...ids];
}
