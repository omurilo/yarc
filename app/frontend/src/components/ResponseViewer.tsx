import Editor from "@monaco-editor/react";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Clipboard, Clock3, FileText, Filter, History, RadioTower, Save, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { downloadFile } from "../services/download";
import { applyJsonFilter } from "../services/jsonFilter";
import { resolveRequestPreview } from "../services/snippets";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { ApiRequest, ApiResponse, HistoryEntry } from "../types/api";

type Props = {
  response?: ApiResponse;
  loading: boolean;
  sentRequest?: ApiRequest;
};

const tabs = ["Response", "Headers", "Request"] as const;
type Tab = (typeof tabs)[number];

export function ResponseViewer({ response, loading, sentRequest }: Props) {
  const [tab, setTab] = useState<Tab>("Response");
  const [filter, setFilter] = useState("");
  const [raw, setRaw] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const activeRequestId = useWorkspaceStore((state) => state.activeRequest.id);
  const activeRequestName = useWorkspaceStore((state) => state.activeRequest.name);
  const history = useWorkspaceStore((state) => state.history);
  const setResponse = useWorkspaceStore((state) => state.setResponse);
  const clearResponse = useWorkspaceStore((state) => state.clearResponse);
  const clearHistory = useWorkspaceStore((state) => state.clearHistory);
  const requestHistory = useMemo(() => history.filter((entry) => entry.request.id === activeRequestId), [history, activeRequestId]);
  const ok = response && response.statusCode >= 200 && response.statusCode < 300;
  const inspected = useMemo(() => {
    if (response?.sent) {
      return {
        method: response.sent.method,
        url: response.sent.url,
        headers: Object.entries(response.sent.headers).map(([key, value]) => ({ key, value })),
        body: response.sent.body,
        hasBody: Boolean(response.sent.body),
        source: "actual" as const,
      };
    }
    if (sentRequest) {
      const preview = resolveRequestPreview(sentRequest);
      return { ...preview, source: "preview" as const };
    }
    return null;
  }, [response, sentRequest]);
  const responseHeaders = useMemo(() => Object.entries(response?.headers ?? {}), [response]);

  const contentType = (response?.headers["Content-Type"] ?? response?.headers["content-type"] ?? "").toLowerCase();
  const isSse = contentType.includes("text/event-stream");
  const sseEvents = useMemo(() => (isSse ? parseSseEvents(response?.body ?? "") : []), [isSse, response]);

  const { text: bodyText, isJson, filterError } = useMemo(() => {
    const body = response?.error ? response.error : response?.body ?? "";
    if (raw || !body) return { text: body, isJson: false, filterError: "" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { text: body, isJson: false, filterError: "" }; // not JSON, show as-is
    }
    try {
      const result = filter.trim() ? applyJsonFilter(parsed, filter) : parsed;
      return { text: JSON.stringify(result, null, 2), isJson: true, filterError: "" };
    } catch (error) {
      return { text: JSON.stringify(parsed, null, 2), isJson: true, filterError: error instanceof Error ? error.message : "Invalid filter" };
    }
  }, [response, filter, raw]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-[#171b22]">
      <div className="flex h-12 items-center gap-3 border-b border-line px-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          {response?.error ? <AlertTriangle size={16} className="text-danger" /> : <CheckCircle2 size={16} className={ok ? "text-accent" : "text-slate-500"} />}
          <span>{loading ? "Waiting for response" : response?.status ?? "No response yet"}</span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs text-slate-400">
          {response && (
            <>
              <span className="flex items-center gap-1">
                <Clock3 size={14} /> {response.durationMs} ms
              </span>
              <span className="flex items-center gap-1">
                <FileText size={14} /> {formatBytes(response.bodySize)}
              </span>
            </>
          )}
          <ResponseHistoryMenu
            response={response}
            requestName={activeRequestName}
            history={requestHistory}
            onLoad={(entry) => setResponse(entry.response)}
            onDeleteResponse={clearResponse}
            onClearHistory={() => clearHistory(activeRequestId)}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
        {tabs.map((label) => (
          <button
            key={label}
            onClick={() => setTab(label)}
            className={`rounded-md px-3 py-1 text-sm ${tab === label ? "bg-panel text-accent" : "text-slate-400 hover:bg-panel"}`}
          >
            {label}
            {label === "Headers" && responseHeaders.length > 0 && <span className="ml-1 text-slate-500">{responseHeaders.length}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 overflow-hidden">
        {tab === "Response" && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
              {isSse ? (
                <span className="flex items-center gap-1 text-xs text-slate-400"><RadioTower size={13} className="text-accent" /> Event stream · {sseEvents.length} events</span>
              ) : (
                <>
                  <Filter size={14} className="shrink-0 text-slate-500" />
                  <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter (jq): .data[] | .name"
                    spellCheck={false}
                    className={`h-7 min-w-0 flex-1 rounded-md border bg-[#14181f] px-2 font-mono text-xs outline-none focus:border-accent ${filterError ? "border-danger/60" : "border-line"}`}
                  />
                  {filterError && <span className="max-w-[40%] shrink-0 truncate text-xs text-danger" title={filterError}>{filterError}</span>}
                </>
              )}
              <button onClick={() => setRaw((value) => !value)} className={`ml-auto h-7 shrink-0 rounded-md px-2 text-xs ${raw ? "bg-panel text-accent" : "text-slate-400 hover:bg-panel"}`}>
                {raw ? "Raw" : isSse ? "Events" : "Pretty"}
              </button>
            </div>
            {isSse && !raw ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs">
                  {sseEvents.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-500">{loading ? "Waiting for events…" : "No events."}</div>
                  ) : (
                    sseEvents.map((event, index) => (
                      <button
                        key={index}
                        onClick={() => setSelectedEvent((current) => (current === index ? null : index))}
                        className={`flex w-full items-center gap-2 px-2 py-1 text-left ${selectedEvent === index ? "bg-panel" : "hover:bg-panel/60"}`}
                      >
                        <ChevronRight size={13} className={`shrink-0 text-slate-600 transition-transform ${selectedEvent === index ? "rotate-90" : ""}`} />
                        <span className="w-6 shrink-0 text-right text-slate-500">{index}</span>
                        <span className="shrink-0 rounded bg-[#2a303a] px-2 py-0.5 text-slate-200">{event.event}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-500">{singleLine(event.data)}</span>
                      </button>
                    ))
                  )}
                </div>
                {selectedEvent !== null && sseEvents[selectedEvent] && (
                  <div className="flex min-h-0 flex-1 flex-col border-t border-line">
                    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
                      <span className="w-6 shrink-0 text-right text-slate-500">{selectedEvent}</span>
                      <span className="shrink-0 rounded bg-[#2a303a] px-2 py-0.5 font-mono text-slate-200">{sseEvents[selectedEvent].event}</span>
                      {sseEvents[selectedEvent].id && <span className="truncate text-slate-500">id: {sseEvents[selectedEvent].id}</span>}
                      <button onClick={() => setSelectedEvent(null)} className="ml-auto grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-panel hover:text-slate-100">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="relative min-h-0 flex-1">
                      <Editor
                        height="100%"
                        language={looksJson(sseEvents[selectedEvent].data) ? "json" : "plaintext"}
                        theme="vs-dark"
                        value={prettyMaybeJson(sseEvents[selectedEvent].data)}
                        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, wordWrap: "on", padding: { top: 12 } }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative min-h-0 flex-1">
                <Editor
                  height="100%"
                  language={isJson ? "json" : looksJson(bodyText) ? "json" : "plaintext"}
                  theme="vs-dark"
                  value={bodyText}
                  options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, wordWrap: "on", padding: { top: 12 } }}
                />
              </div>
            )}
          </div>
        )}

        {tab === "Headers" && (
          <div className="h-full overflow-auto p-4">
            {responseHeaders.length === 0 ? (
              <div className="text-sm text-slate-500">No response headers.</div>
            ) : (
              <div className="grid gap-1 font-mono text-xs">
                {responseHeaders.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[minmax(160px,260px)_minmax(0,1fr)] gap-3 border-b border-line/60 py-1">
                    <span className="truncate text-slate-400">{key}</span>
                    <span className="break-all text-slate-200">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "Request" && (
          <div className="h-full overflow-auto p-4">
            {!inspected ? (
              <div className="text-sm text-slate-500">Send a request to inspect what was sent.</div>
            ) : (
              <div className="grid gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${inspected.source === "actual" ? "bg-accent/20 text-accent" : "bg-warn/20 text-warn"}`}>
                    {inspected.source === "actual" ? "Actually sent" : "Preview"}
                  </span>
                  {inspected.source === "preview" && <span className="text-slate-500">backend did not report the sent request</span>}
                </div>
                <div>
                  <div className="mb-1 uppercase tracking-wide text-slate-500">Request URL</div>
                  <div className="break-all rounded-md border border-line bg-panel px-3 py-2 font-mono text-slate-200">
                    <span className="mr-2 font-semibold text-accent">{inspected.method}</span>
                    {inspected.url}
                  </div>
                </div>
                <div>
                  <div className="mb-1 uppercase tracking-wide text-slate-500">Headers ({inspected.headers.length})</div>
                  {inspected.headers.length === 0 ? (
                    <div className="text-slate-500">No headers.</div>
                  ) : (
                    <div className="grid gap-1 font-mono">
                      {inspected.headers.map((header, index) => (
                        <div key={`${header.key}-${index}`} className="grid grid-cols-[minmax(160px,260px)_minmax(0,1fr)] gap-3 border-b border-line/60 py-1">
                          <span className="truncate text-slate-400">{header.key}</span>
                          <span className="break-all text-slate-200">{header.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {inspected.hasBody && (
                  <div className="min-h-0">
                    <div className="mb-1 uppercase tracking-wide text-slate-500">Body</div>
                    <pre className="overflow-auto rounded-md border border-line bg-panel p-3 font-mono text-slate-200">{inspected.body}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type HistoryMenuProps = {
  response?: ApiResponse;
  requestName: string;
  history: HistoryEntry[];
  onLoad: (entry: HistoryEntry) => void;
  onDeleteResponse: () => void;
  onClearHistory: () => void;
};

function ResponseHistoryMenu({ response, requestName, history, onLoad, onDeleteResponse, onClearHistory }: HistoryMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const saveToFile = () => {
    if (!response) return;
    const contentType = response.headers["Content-Type"] ?? response.headers["content-type"] ?? "text/plain";
    const extension = contentType.includes("json") ? "json" : contentType.includes("xml") ? "xml" : contentType.includes("html") ? "html" : "txt";
    downloadFile(`${(requestName || "response").replace(/\s+/g, "-").toLowerCase()}.${extension}`, response.body, contentType);
    setOpen(false);
  };
  const copyBody = () => {
    if (response) void navigator.clipboard?.writeText(response.body);
    setOpen(false);
  };
  const deleteResponse = () => {
    onDeleteResponse();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        title="Response actions & history"
        onClick={() => setOpen((value) => !value)}
        className={`grid h-8 w-8 place-items-center rounded-md ${open ? "bg-panel text-accent" : "text-slate-400 hover:bg-panel hover:text-slate-100"}`}
      >
        <History size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-72 overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-xl">
          <div className="p-1">
            <MenuItem icon={<Save size={16} />} label="Save to File" disabled={!response} onClick={saveToFile} />
            <MenuItem icon={<Clipboard size={16} />} label="Copy Body" disabled={!response} onClick={copyBody} />
            <MenuItem icon={<Trash2 size={16} />} label="Delete" disabled={!response} onClick={deleteResponse} />
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 pb-1 pt-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">History</span>
            {history.length > 0 && (
              <button onClick={() => { onClearHistory(); setOpen(false); }} className="text-xs text-danger hover:underline">
                Delete {history.length} {history.length === 1 ? "Response" : "Responses"}
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-auto p-1 pt-0">
            {history.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">No saved responses yet.</div>
            ) : (
              history.map((entry) => {
                const active = response?.receivedAt === entry.response.receivedAt;
                const code = entry.response.statusCode;
                const codeColor = code === 0 ? "text-danger" : code < 300 ? "text-accent" : code < 400 ? "text-warn" : "text-danger";
                return (
                  <button
                    key={entry.id}
                    onClick={() => { onLoad(entry); setOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel"
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    <Check size={14} className={active ? "text-slate-200" : "text-transparent"} />
                    <span className={`w-9 shrink-0 font-mono font-semibold ${codeColor}`}>{code || "ERR"}</span>
                    <ChevronRight size={13} className="shrink-0 text-slate-600" />
                    <span className="font-mono text-slate-300">{entry.response.durationMs}ms</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-panel disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
    >
      <span className="text-slate-400">{icon}</span>
      {label}
    </button>
  );
}

type SseEvent = { event: string; data: string; id: string };

// Parses an SSE stream into discrete events (split on blank lines), tolerating a trailing
// partial event while the stream is still arriving.
function parseSseEvents(raw: string): SseEvent[] {
  return raw
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event: SseEvent = { event: "message", data: "", id: "" };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) continue; // comment
        const index = line.indexOf(":");
        const field = index >= 0 ? line.slice(0, index) : line;
        const value = index >= 0 ? line.slice(index + 1).replace(/^ /, "") : "";
        if (field === "data") event.data = event.data ? `${event.data}\n${value}` : value;
        else if (field === "event") event.event = value;
        else if (field === "id") event.id = value;
      }
      return event;
    });
}

function prettyMaybeJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

// Compact one-line preview of an event's data (minified JSON when possible).
function singleLine(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replace(/\s+/g, " ").trim();
  }
}

function looksJson(value?: string) {
  if (!value) return true;
  return value.trim().startsWith("{") || value.trim().startsWith("[");
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
