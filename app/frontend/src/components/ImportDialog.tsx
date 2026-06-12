import { FileUp, TerminalSquare, X } from "lucide-react";
import { useState } from "react";
import { parseCurl } from "../services/curl";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { CollectionNode } from "../types/api";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ImportDialog({ open, onClose }: Props) {
  const importRequest = useWorkspaceStore((state) => state.importRequest);
  const importCollections = useWorkspaceStore((state) => state.importCollections);
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  const importCurl = () => {
    setError("");
    try {
      const request = parseCurl(command);
      importRequest(request);
      setCommand("");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not parse cURL command.");
    }
  };

  const importJson = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const parsed = JSON.parse(await file.text());
      const nodes = (Array.isArray(parsed) ? parsed : parsed.collections) as CollectionNode[] | undefined;
      if (!Array.isArray(nodes)) throw new Error("File does not contain a Yarc collection.");
      importCollections(nodes);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import file.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 pt-[12vh]" onMouseDown={onClose}>
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-12 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <TerminalSquare size={16} className="text-accent" />
            Import
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <label className="text-xs uppercase tracking-wide text-slate-500">Paste a cURL command</label>
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={`curl -X POST https://api.example.com/users \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Ada"}'`}
            className="mt-2 h-40 w-full resize-none rounded-md border border-line bg-[#14181f] p-3 font-mono text-sm text-slate-200 outline-none focus:border-accent"
          />
          {error && <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{error}</div>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-panel px-3 text-xs text-slate-300 hover:border-accent">
              <FileUp size={14} />
              Import collection (.json)
              <input type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importJson(event.target.files?.[0])} />
            </label>
            <button onClick={importCurl} disabled={!command.trim()} className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-60">
              Import request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
