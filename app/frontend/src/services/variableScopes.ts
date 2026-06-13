import type { CollectionNode } from "../types/api";

type Vars = Record<string, { text: string; type: string; fileName?: string }>;

// Collects folder/collection variables along the request's ancestry, merged root→nearest so the
// nearest folder wins. (Environment is layered on top of this at send time.)
export function folderVariables(collections: CollectionNode[], nodeId: string): Vars {
  const byId = new Map(collections.map((node) => [node.id, node]));
  const chain: CollectionNode[] = [];
  let parentId = byId.get(nodeId)?.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.kind === "folder" && parent.variables) chain.push(parent);
    parentId = parent.parentId;
  }
  chain.reverse(); // root-most first, so nearest spreads last and wins
  return chain.reduce<Vars>((acc, folder) => ({ ...acc, ...(folder.variables ?? {}) }), {});
}
