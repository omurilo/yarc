import { CheckCircle2, Play, Square, X, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { collectFolderRequests, runRequests, type RunResult } from "../services/collectionRunner";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

type Props = {
  folderId: string | null;
  onClose: () => void;
};

export function CollectionRunner({ folderId, onClose }: Props) {
  const collections = useWorkspaceStore((state) => state.collections);
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironmentId = useWorkspaceStore((state) => state.activeEnvironmentId);
  const globals = useWorkspaceStore((state) => state.globals);
  const updateEnvironment = useWorkspaceStore((state) => state.updateEnvironment);
  const updateGlobals = useWorkspaceStore((state) => state.updateGlobals);

  const [results, setResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const folder = collections.find((node) => node.id === folderId);
  const nodes = useMemo(() => (folderId ? collectFolderRequests(collections, folderId) : []), [collections, folderId]);

  if (!folderId) return null;

  const passed = results.reduce((sum, r) => sum + r.tests.filter((t) => t.passed).length, 0);
  const failed = results.reduce((sum, r) => sum + r.tests.filter((t) => !t.passed).length, 0);

  const run = async () => {
    const activeEnv = environments.find((env) => env.id === activeEnvironmentId);
    const controller = new AbortController();
    abortRef.current = controller;
    setResults([]);
    setRunning(true);
    const outcome = await runRequests(nodes, {
      env: activeEnv?.variables ?? {},
      globals,
      collections,
      signal: controller.signal,
      onResult: (result) => setResults((current) => [...current, result]),
    });
    // Persist any pm.environment.set()/pm.globals.set() accumulated across the run.
    if (outcome.envChanged && activeEnv) updateEnvironment({ ...activeEnv, variables: outcome.env });
    if (outcome.globalsChanged) updateGlobals(outcome.globals);
    setRunning(false);
    abortRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 pt-[8vh]" onMouseDown={onClose}>
      <div className="mx-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <Play size={16} className="text-accent" />
          <span className="text-sm text-slate-200">Run · {folder?.name ?? "Folder"}</span>
          <span className="text-xs text-slate-500">{nodes.length} requests</span>
          {results.length > 0 && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-accent">{passed} passed</span>
              {failed > 0 && <span className="text-danger">{failed} failed</span>}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {running ? (
              <button onClick={() => abortRef.current?.abort()} className="flex h-8 items-center gap-1.5 rounded-md bg-danger px-3 text-xs font-semibold text-ink">
                <Square size={13} /> Stop
              </button>
            ) : (
              <button onClick={() => void run()} disabled={nodes.length === 0} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-ink disabled:opacity-50">
                <Play size={13} /> Run
              </button>
            )}
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-xs">
          {nodes.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-slate-500">This folder has no requests.</div>
          ) : (
            nodes.map((node) => {
              const result = results.find((r) => r.id === node.id);
              const pending = running && !result;
              return (
                <div key={node.id} className="border-b border-line/50">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <span className={`w-12 shrink-0 font-semibold ${node.method === "GET" ? "text-accent" : "text-sky-300"}`}>{node.request?.method}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-300">{node.name}</span>
                    {result ? (
                      <>
                        <span className={`shrink-0 ${result.ok ? "text-accent" : "text-danger"}`}>{result.status || "ERR"}</span>
                        <span className="w-14 shrink-0 text-right text-slate-500">{result.durationMs}ms</span>
                        {result.ok ? <CheckCircle2 size={14} className="shrink-0 text-accent" /> : <XCircle size={14} className="shrink-0 text-danger" />}
                      </>
                    ) : (
                      <span className="shrink-0 text-slate-600">{pending ? "…" : "—"}</span>
                    )}
                  </div>
                  {result && (result.tests.length > 0 || result.error) && (
                    <div className="px-2 pb-1.5 pl-16">
                      {result.tests.map((test, index) => (
                        <div key={index} className={test.passed ? "text-accent/80" : "text-danger"}>
                          {test.passed ? "✓" : "✗"} {test.name}
                          {!test.passed && test.error && <span className="text-slate-500"> — {test.error}</span>}
                        </div>
                      ))}
                      {result.error && <div className="text-danger">! {result.error}</div>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
