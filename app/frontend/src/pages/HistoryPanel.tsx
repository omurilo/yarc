import { RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export function HistoryPanel() {
  const history = useWorkspaceStore((state) => state.history);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const lower = query.toLowerCase();
    return history.filter((entry) => query === "" || `${entry.request.method} ${entry.request.url} ${entry.response.status}`.toLowerCase().includes(lower));
  }, [history, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#171b22]">
      <div className="flex h-12 items-center gap-3 border-b border-line px-4">
        <div className="relative w-96">
          <Search size={15} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL, method, headers, payload" className="h-9 w-full rounded-md border border-line bg-[#14181f] pl-8 pr-3 text-sm outline-none focus:border-accent" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.map((entry) => (
          <div key={entry.id} className="grid grid-cols-[90px_minmax(0,1fr)_120px_120px_48px] items-center border-b border-line px-4 py-3 text-sm">
            <span className="font-semibold text-accent">{entry.request.method}</span>
            <span className="truncate font-mono text-slate-300">{entry.request.url}</span>
            <span className="text-slate-400">{entry.response.statusCode || "ERR"}</span>
            <span className="text-slate-400">{entry.response.durationMs} ms</span>
            <button title="Run again" className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-accent">
              <RotateCcw size={15} />
            </button>
          </div>
        ))}
        {visible.length === 0 && <div className="p-8 text-sm text-slate-500">No history yet.</div>}
      </div>
    </div>
  );
}
