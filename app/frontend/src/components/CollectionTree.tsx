import { Braces, ChevronRight, ChevronsDownUp, ChevronsUpDown, FilePlus2, Folder, FolderOpen, FolderPlus, Pencil, Plus, Search, Star, Tag, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import type { CollectionNode } from "../types/api";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export function CollectionTree() {
  const collections = useWorkspaceStore((state) => state.collections);
  const selectedCollectionId = useWorkspaceStore((state) => state.selectedCollectionId);
  const addCollection = useWorkspaceStore((state) => state.addCollection);
  const addCollectionInside = useWorkspaceStore((state) => state.addCollectionInside);
  const selectCollection = useWorkspaceStore((state) => state.selectCollection);
  const renameCollection = useWorkspaceStore((state) => state.renameCollection);
  const deleteCollection = useWorkspaceStore((state) => state.deleteCollection);
  const moveCollection = useWorkspaceStore((state) => state.moveCollection);
  const setFolderVariables = useWorkspaceStore((state) => state.setFolderVariables);
  const openCollectionRequest = useWorkspaceStore((state) => state.openCollectionRequest);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Persist which folders are collapsed so the tree reopens in the same state next session.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("yarc.collapsed") ?? "[]");
      return new Set(Array.isArray(stored) ? (stored as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ node: CollectionNode; x: number; y: number } | null>(null);
  const [varsFolder, setVarsFolder] = useState<CollectionNode | null>(null);

  useEffect(() => {
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const visible = useMemo(() => {
    const lower = query.toLowerCase();
    const matches = (node: CollectionNode) => query === "" || `${node.name} ${node.url ?? ""} ${node.tags.join(" ")}`.toLowerCase().includes(lower);
    const visibleIds = new Set<string>();
    collections.forEach((node) => {
      if (node.kind !== "workspace" && matches(node)) {
        visibleIds.add(node.id);
        let parent = collections.find((item) => item.id === node.parentId);
        while (parent) {
          visibleIds.add(parent.id);
          parent = collections.find((item) => item.id === parent?.parentId);
        }
      }
    });
    return query ? collections.filter((node) => visibleIds.has(node.id)) : collections;
  }, [collections, query]);

  const childrenFor = (parentId: string) => visible.filter((node) => node.parentId === parentId).sort(sortCollections);
  const roots = childrenFor("workspace");

  const persistCollapsed = (next: Set<string>) => {
    localStorage.setItem("yarc.collapsed", JSON.stringify([...next]));
    return next;
  };

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return persistCollapsed(next);
    });

  const folderIds = useMemo(() => collections.filter((node) => node.kind === "folder").map((node) => node.id), [collections]);
  const allCollapsed = folderIds.length > 0 && folderIds.every((id) => collapsed.has(id));
  const toggleCollapseAll = () => setCollapsed(() => persistCollapsed(new Set(allCollapsed ? [] : folderIds)));

  const onDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData("text/plain") || dragId;
    setDropTarget(null);
    setDragId(null);
    if (sourceId) moveCollection(sourceId, targetId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onContextMenu={(event) => event.preventDefault()}>
      <div className="px-3 py-3">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search collections"
            className="h-9 w-full rounded-md border border-line bg-[#14181f] pl-8 pr-3 text-sm outline-none placeholder:text-slate-600 focus:border-accent"
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={() => addCollection("folder")} className="flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-panel text-xs text-slate-300 hover:border-accent">
            <FolderPlus size={14} />
            Folder
          </button>
          <button onClick={() => addCollection("request")} className="flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-panel text-xs text-slate-300 hover:border-accent">
            <FilePlus2 size={14} />
            Request
          </button>
        </div>
      </div>
      {folderIds.length > 0 && (
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs uppercase tracking-wide text-slate-500">Collections</span>
          <button
            onClick={toggleCollapseAll}
            title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
            className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-panel hover:text-slate-100"
          >
            {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </button>
        </div>
      )}
      <div
        className={`flex-1 overflow-auto px-2 pb-3 ${dropTarget === "workspace" ? "rounded-md ring-1 ring-inset ring-accent/40" : ""}`}
        onDragOver={(event) => {
          if (!dragId) return;
          event.preventDefault();
          setDropTarget("workspace");
        }}
        onDrop={(event) => onDrop(event, "workspace")}
      >
        {roots.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            childrenFor={childrenFor}
            collapsed={collapsed}
            searching={query !== ""}
            toggleCollapsed={toggleCollapsed}
            selectedId={selectedCollectionId}
            editingId={editingId}
            setEditingId={setEditingId}
            selectCollection={selectCollection}
            renameCollection={renameCollection}
            addCollectionInside={addCollectionInside}
            openCollectionRequest={openCollectionRequest}
            dragId={dragId}
            setDragId={setDragId}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDrop={onDrop}
            openContextMenu={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ node, x: event.clientX, y: event.clientY });
              selectCollection(node.id);
            }}
          />
        ))}
        {roots.length === 0 && <div className="px-2 py-6 text-sm leading-6 text-slate-500">No collections yet.</div>}
      </div>
      {menu && (
        <div className="fixed z-50 w-56 overflow-hidden rounded-md border border-line bg-[#20242c] py-1 text-sm text-slate-200 shadow-2xl" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <button
            onClick={() => {
              setEditingId(menu.node.id);
              setMenu(null);
            }}
            className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-[#2a303a]"
          >
            <Pencil size={14} />
            Rename
          </button>
          <button
            onClick={() => {
              addCollectionInside(menu.node.id, "request");
              setMenu(null);
            }}
            className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-[#2a303a]"
          >
            <FilePlus2 size={14} />
            New request
          </button>
          <button
            onClick={() => {
              addCollectionInside(menu.node.id, "folder");
              setMenu(null);
            }}
            className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-[#2a303a]"
          >
            <FolderPlus size={14} />
            New folder
          </button>
          {menu.node.kind === "folder" && (
            <button
              onClick={() => {
                setVarsFolder(menu.node);
                setMenu(null);
              }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-[#2a303a]"
            >
              <Braces size={14} />
              Variables…
            </button>
          )}
          <div className="my-1 border-t border-line" />
          <button
            onClick={() => {
              deleteCollection(menu.node.id);
              setMenu(null);
            }}
            className="flex h-8 w-full items-center gap-2 px-3 text-left text-danger hover:bg-[#2a303a]"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
      {varsFolder && (
        <FolderVariablesDialog
          folder={varsFolder}
          onClose={() => setVarsFolder(null)}
          onSave={(variables) => {
            setFolderVariables(varsFolder.id, variables);
            setVarsFolder(null);
          }}
        />
      )}
    </div>
  );
}

type FolderVarRow = { key: string; value: string };

function FolderVariablesDialog({ folder, onClose, onSave }: { folder: CollectionNode; onClose: () => void; onSave: (vars: Record<string, { text: string; type: string }>) => void }) {
  const [rows, setRows] = useState<FolderVarRow[]>(() => Object.entries(folder.variables ?? {}).map(([key, value]) => ({ key, value: value.text })));

  const save = () => {
    const variables: Record<string, { text: string; type: string }> = {};
    for (const row of rows) if (row.key.trim()) variables[row.key.trim()] = { text: row.value, type: "text" };
    onSave(variables);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45" onMouseDown={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-12 items-center justify-between border-b border-line px-4 text-sm text-slate-200">
          <span className="flex items-center gap-2"><Braces size={15} className="text-accent" /> Variables — {folder.name}</span>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100"><X size={16} /></button>
        </div>
        <div className="grid max-h-[60vh] gap-2 overflow-auto p-4">
          <p className="text-xs text-slate-500">Apply to every request in this folder. Environment variables override these; these override globals.</p>
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_32px] gap-2">
              <input value={row.key} placeholder="key" onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))} className="h-9 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm text-slate-100 outline-none focus:border-accent" />
              <input value={row.value} placeholder="value" onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))} className="h-9 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm text-slate-100 outline-none focus:border-accent" />
              <button onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="grid h-9 w-8 place-items-center rounded-md text-slate-500 hover:bg-[#14181f] hover:text-danger"><Trash2 size={15} /></button>
            </div>
          ))}
          <button onClick={() => setRows((current) => [...current, { key: "", value: "" }])} className="flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-line text-xs text-slate-400 hover:border-accent hover:text-accent">
            <Plus size={14} /> Add variable
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onClose} className="h-9 rounded-md border border-line bg-[#14181f] px-4 text-sm text-slate-300 hover:border-accent">Cancel</button>
          <button onClick={save} className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-ink hover:opacity-90">Save</button>
        </div>
      </div>
    </div>
  );
}

type TreeNodeProps = {
  node: CollectionNode;
  depth: number;
  childrenFor: (parentId: string) => CollectionNode[];
  collapsed: Set<string>;
  searching: boolean;
  toggleCollapsed: (id: string) => void;
  selectedId: string;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  selectCollection: (id: string) => void;
  renameCollection: (id: string, name: string) => void;
  addCollectionInside: (parentId: string, kind: "folder" | "request") => void;
  openCollectionRequest: (node: CollectionNode) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  onDrop: (event: DragEvent, targetId: string) => void;
  openContextMenu: (event: MouseEvent, node: CollectionNode) => void;
};

function TreeNode({
  node,
  depth,
  childrenFor,
  collapsed,
  searching,
  toggleCollapsed,
  selectedId,
  editingId,
  setEditingId,
  selectCollection,
  renameCollection,
  addCollectionInside,
  openCollectionRequest,
  dragId,
  setDragId,
  dropTarget,
  setDropTarget,
  onDrop,
  openContextMenu,
}: TreeNodeProps) {
  const [draftName, setDraftName] = useState(node.name);
  const children = childrenFor(node.id);
  const selected = selectedId === node.id;
  const isFolder = node.kind === "folder";
  const expanded = searching || !collapsed.has(node.id);
  const isDropTarget = isFolder && dropTarget === node.id;

  useEffect(() => {
    setDraftName(node.name);
  }, [node.name]);

  const commitRename = () => {
    const name = draftName.trim() || node.name;
    renameCollection(node.id, name);
    setEditingId(null);
  };

  return (
    <div>
      <div
        draggable={editingId !== node.id}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", node.id);
          event.dataTransfer.effectAllowed = "move";
          setDragId(node.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTarget(null);
        }}
        onDragOver={(event) => {
          if (!isFolder || !dragId || dragId === node.id) return;
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(node.id);
        }}
        onDragLeave={() => isDropTarget && setDropTarget(null)}
        onDrop={(event) => (isFolder ? onDrop(event, node.id) : undefined)}
        onClick={() => (isFolder ? toggleCollapsed(node.id) : openCollectionRequest(node))}
        onContextMenu={(event) => openContextMenu(event, node)}
        onDoubleClick={() => {
          setDraftName(node.name);
          setEditingId(node.id);
        }}
        className={`group flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm ${selected ? "bg-panel text-accent" : "text-slate-300 hover:bg-panel"} ${isDropTarget ? "ring-1 ring-inset ring-accent" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {isFolder ? (
          <>
            <ChevronRight size={15} className={`text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
            {expanded ? <FolderOpen size={16} className="text-warn" /> : <Folder size={16} className="text-warn" />}
          </>
        ) : (
          <span className={`w-12 shrink-0 rounded text-xs font-semibold ${node.method === "GET" ? "text-accent" : "text-sky-300"}`}>{node.method}</span>
        )}
        {editingId === node.id ? (
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setEditingId(null);
            }}
            onClick={(event) => event.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded border border-accent bg-[#151a21] px-2 outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        {node.favorite && <Star size={14} className="shrink-0 fill-warn text-warn" />}
        {node.tags.length > 0 && <Tag size={13} className="shrink-0 text-slate-600" />}
        {isFolder && (
          <span className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
            <button
              title="New request"
              onClick={(event) => {
                event.stopPropagation();
                addCollectionInside(node.id, "request");
              }}
              className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-accent"
            >
              <FilePlus2 size={13} />
            </button>
            <button
              title="New folder"
              onClick={(event) => {
                event.stopPropagation();
                addCollectionInside(node.id, "folder");
              }}
              className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-accent"
            >
              <FolderPlus size={13} />
            </button>
          </span>
        )}
      </div>
      {isFolder && expanded &&
        children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            childrenFor={childrenFor}
            collapsed={collapsed}
            searching={searching}
            toggleCollapsed={toggleCollapsed}
            selectedId={selectedId}
            editingId={editingId}
            setEditingId={setEditingId}
            selectCollection={selectCollection}
            renameCollection={renameCollection}
            addCollectionInside={addCollectionInside}
            openCollectionRequest={openCollectionRequest}
            dragId={dragId}
            setDragId={setDragId}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDrop={onDrop}
            openContextMenu={openContextMenu}
          />
        ))}
    </div>
  );
}

function sortCollections(a: CollectionNode, b: CollectionNode) {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name);
}
