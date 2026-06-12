import Editor from "@monaco-editor/react";
import { FileCode2, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { invokeGrpc, listGrpcMethods } from "../services/apiClient";
import type { GrpcInvokeResponse, GrpcMethod } from "../types/api";

export function GrpcPanel() {
  const [target, setTarget] = useState("");
  const [plaintext, setPlaintext] = useState(true);
  const [useReflection, setUseReflection] = useState(false);
  const [protoName, setProtoName] = useState("");
  const [protoSource, setProtoSource] = useState("");
  const [methods, setMethods] = useState<GrpcMethod[]>([]);
  const [methodError, setMethodError] = useState("");
  const [selected, setSelected] = useState("");
  const [payload, setPayload] = useState("{}");
  const [metadata, setMetadata] = useState("");
  const [response, setResponse] = useState<GrpcInvokeResponse | null>(null);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [invoking, setInvoking] = useState(false);

  const loadProto = async (file?: File) => {
    if (!file) return;
    setProtoName(file.name);
    const source = await file.text();
    setProtoSource(source);
    await refreshMethods({ source, name: file.name });
  };

  const refreshMethods = async (override?: { source?: string; name?: string }) => {
    setLoadingMethods(true);
    setMethodError("");
    try {
      const result = await listGrpcMethods({
        target,
        fullMethod: "",
        requestJSON: "",
        metadata: {},
        protoFilename: override?.name ?? protoName,
        protoSource: override?.source ?? protoSource,
        useReflection,
        plaintext,
        timeoutMs: 30000,
      });
      setMethods(result.methods);
      setMethodError(result.error);
      if (!result.methods.some((method) => method.fullMethod === selected)) {
        setSelected(result.methods[0]?.fullMethod ?? "");
      }
    } finally {
      setLoadingMethods(false);
    }
  };

  const invoke = async () => {
    setInvoking(true);
    try {
      const result = await invokeGrpc({
        target,
        fullMethod: selected,
        requestJSON: payload,
        metadata: parseMetadata(metadata),
        protoFilename: protoName,
        protoSource,
        useReflection,
        plaintext,
        timeoutMs: 30000,
      });
      setResponse(result);
    } finally {
      setInvoking(false);
    }
  };

  const canList = useReflection ? Boolean(target) : Boolean(protoSource);
  const selectedMethod = methods.find((method) => method.fullMethod === selected);
  const isStreaming = Boolean(selectedMethod && (selectedMethod.clientStreaming || selectedMethod.serverStreaming));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden bg-[#171b22]">
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r border-line">
        <div className="border-b border-line p-3">
          <div className="flex h-12 items-center gap-2 text-sm text-slate-400">
            <FileCode2 size={15} />
            Service definition
          </div>
          <label className="flex items-center justify-between gap-2 py-1 text-sm text-slate-300">
            <span>Server reflection</span>
            <input type="checkbox" checked={useReflection} onChange={(event) => setUseReflection(event.target.checked)} className="h-4 w-4 accent-accent" />
          </label>
          <label className="flex items-center justify-between gap-2 py-1 text-sm text-slate-300">
            <span>Plaintext (no TLS)</span>
            <input type="checkbox" checked={plaintext} onChange={(event) => setPlaintext(event.target.checked)} className="h-4 w-4 accent-accent" />
          </label>
          {!useReflection && (
            <label className="mt-2 flex h-9 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-panel text-sm text-slate-300 hover:border-accent">
              Load proto
              <input type="file" accept=".proto" className="hidden" onChange={(event) => void loadProto(event.target.files?.[0])} />
            </label>
          )}
          <button
            disabled={!canList || loadingMethods}
            onClick={() => void refreshMethods()}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line bg-panel text-sm text-slate-300 hover:border-accent disabled:opacity-50"
          >
            <RefreshCw size={14} className={loadingMethods ? "animate-spin" : ""} />
            {useReflection ? "List via reflection" : "Refresh methods"}
          </button>
          {!useReflection && <div className="mt-2 truncate text-xs text-slate-500">{protoName || "No proto loaded."}</div>}
        </div>
        <div className="min-h-0 overflow-auto p-3">
          {methodError && <div className="mb-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{methodError}</div>}
          <div className="space-y-2">
            {methods.map((method) => (
              <button
                key={method.fullMethod}
                onClick={() => setSelected(method.fullMethod)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selected === method.fullMethod ? "border-accent bg-panel text-accent" : "border-line bg-panel text-slate-300"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{method.method}</span>
                  {(method.clientStreaming || method.serverStreaming) && <span className="shrink-0 rounded bg-warn/20 px-1.5 text-[10px] font-semibold uppercase text-warn">stream</span>}
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">{method.service}</div>
              </button>
            ))}
            {methods.length === 0 && !methodError && <div className="rounded-md border border-line bg-panel p-3 text-sm text-slate-500">No methods loaded.</div>}
          </div>
        </div>
      </aside>
      <main className="grid min-h-0 grid-rows-[56px_auto_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="localhost:50051" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm outline-none focus:border-accent" />
          <button disabled={!target || !selected || invoking || isStreaming} onClick={() => void invoke()} className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-60">
            <Play size={15} /> {invoking ? "Invoking" : "Invoke"}
          </button>
        </div>
        <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs text-slate-500">
          {selectedMethod ? (
            <>
              <span className="font-mono text-slate-300">{selectedMethod.fullMethod}</span>
              <span>·</span>
              <span>
                {selectedMethod.requestType} → {selectedMethod.responseType}
              </span>
              {isStreaming && <span className="text-warn">streaming not supported yet</span>}
            </>
          ) : (
            <span>Select a method to invoke.</span>
          )}
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] overflow-hidden border-b border-line">
          <Editor height="100%" language="json" theme="vs-dark" value={payload} onChange={(value) => setPayload(value ?? "")} options={{ minimap: { enabled: false }, fontSize: 13 }} />
          <div className="flex min-h-0 flex-col border-l border-line">
            <div className="border-b border-line px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Metadata (key: value per line)</div>
            <textarea value={metadata} onChange={(event) => setMetadata(event.target.value)} placeholder="authorization: Bearer ..." className="min-h-0 flex-1 resize-none bg-[#14181f] p-3 font-mono text-sm text-slate-200 outline-none" />
          </div>
        </div>
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs">
            {response ? (
              <>
                <span className={response.error ? "font-semibold text-danger" : "font-semibold text-accent"}>
                  {response.status}
                  {response.error ? ` (${response.statusCode})` : ""}
                </span>
                <span className="text-slate-500">{response.durationMs} ms</span>
                {response.error && <span className="truncate text-danger">{response.error}</span>}
              </>
            ) : (
              <span className="text-slate-500">Response</span>
            )}
          </div>
          <Editor height="100%" language="json" theme="vs-dark" value={response?.error ? response.error : response?.body ?? ""} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }} />
        </div>
      </main>
    </div>
  );
}

function parseMetadata(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
