import Editor from "@monaco-editor/react";
import { BookOpen, Play, Search } from "lucide-react";
import { useState } from "react";
import { relayRequest } from "../services/apiClient";

export function GraphQLPanel() {
  const [endpoint, setEndpoint] = useState("");
  const [query, setQuery] = useState("");
  const [variables, setVariables] = useState("");
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const parsedVariables = variables.trim() ? JSON.parse(variables) : undefined;
      // Routed through the relay so the browser preview isn't blocked by CORS.
      const result = await relayRequest({
        url: endpoint,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: parsedVariables }),
      });
      setResponse(result.error ? result.error : formatJSON(result.body));
    } catch (error) {
      setResponse(error instanceof Error ? error.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_340px] overflow-hidden bg-[#171b22]">
      <aside className="min-h-0 overflow-hidden border-r border-line">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 text-sm text-slate-400">
          <Search size={15} />
          Explorer
        </div>
        <div className="h-[calc(100%-3rem)] overflow-auto p-3 text-sm text-slate-300">
          <div className="rounded-md border border-line bg-panel p-3 text-slate-500">No schema loaded.</div>
        </div>
      </aside>
      <main className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)_220px] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="GraphQL endpoint" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-[#14181f] px-3 text-sm outline-none focus:border-accent" />
          <button disabled={!endpoint || !query || running} onClick={run} className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-60">
            <Play size={15} /> {running ? "Running" : "Run"}
          </button>
        </div>
        <div className="min-h-0 overflow-hidden">
          <Editor height="100%" language="graphql" theme="vs-dark" value={query} onChange={(value) => setQuery(value ?? "")} options={{ minimap: { enabled: false }, fontSize: 13 }} />
        </div>
        <div className="grid min-h-0 grid-cols-2 border-t border-line">
          <Editor height="100%" language="json" theme="vs-dark" value={variables} onChange={(value) => setVariables(value ?? "")} options={{ minimap: { enabled: false }, fontSize: 13 }} />
          <Editor height="100%" language="json" theme="vs-dark" value={response} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }} />
        </div>
      </main>
      <aside className="min-h-0 overflow-hidden border-l border-line">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 text-sm text-slate-400">
          <BookOpen size={15} />
          Documentation
        </div>
        <div className="h-[calc(100%-3rem)] overflow-auto p-4 text-sm leading-6 text-slate-500">No documentation loaded.</div>
      </aside>
    </div>
  );
}

function formatJSON(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
