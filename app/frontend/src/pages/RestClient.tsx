import Editor from "@monaco-editor/react";
import { Braces, Copy, Download, Play, Save, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { FormEditor } from "../components/FormEditor";
import { HeaderTable } from "../components/HeaderTable";
import { ResponseViewer } from "../components/ResponseViewer";
import { SnippetPanel } from "../components/SnippetPanel";
import { saveResponseFile, streamHttpRequest } from "../services/apiClient";
import { serializeFormBody, upsertHeader } from "../services/formBody";
import { mergedVars, runPreRequest, runTests, type EnvBridge, type ScriptOutcome, type TestResult } from "../services/scripting";
import { folderVariables } from "../services/variableScopes";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { ApiRequest, ApiResponse, HttpMethod } from "../types/api";

const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const tabs = ["Params", "Headers", "Auth", "Body", "Tests", "Settings"] as const;
type RequestTab = (typeof tabs)[number];

export function RestClient() {
  const [activeTab, setActiveTab] = useState<RequestTab>("Params");
  const request = useWorkspaceStore((state) => state.activeRequest);
  const response = useWorkspaceStore((state) => state.activeResponse);
  const environments = useWorkspaceStore((state) => state.environments);
  const globals = useWorkspaceStore((state) => state.globals);
  const collections = useWorkspaceStore((state) => state.collections);
  const activeEnvironmentId = useWorkspaceStore((state) => state.activeEnvironmentId);
  const updateRequest = useWorkspaceStore((state) => state.updateRequest);
  const setResponse = useWorkspaceStore((state) => state.setResponse);
  const addHistory = useWorkspaceStore((state) => state.addHistory);
  const saveActiveRequest = useWorkspaceStore((state) => state.saveActiveRequest);
  const persistActiveRequest = useWorkspaceStore((state) => state.persistActiveRequest);
  const duplicateActiveRequest = useWorkspaceStore((state) => state.duplicateActiveRequest);
  const updateEnvironment = useWorkspaceStore((state) => state.updateEnvironment);
  const updateGlobals = useWorkspaceStore((state) => state.updateGlobals);
  const isSaved = request.id !== "draft";

  // Auto-save edits to already-saved requests (debounced).
  useEffect(() => {
    if (!isSaved) return;
    const timer = window.setTimeout(() => persistActiveRequest(), 600);
    return () => window.clearTimeout(timer);
  }, [request, isSaved, persistActiveRequest]);

  const [sentRequest, setSentRequest] = useState<ApiRequest>();
  const [loading, setLoading] = useState(false);
  const [scriptRun, setScriptRun] = useState<ScriptOutcome>();
  const abortRef = useRef<AbortController | null>(null);

  const cancel = () => abortRef.current?.abort();

  const run = async () => {
    const activeEnvironment = environments.find((environment) => environment.id === activeEnvironmentId);
    // Variable scopes (precedence: environment > folder/collection chain > globals). Mutable copies
    // so pm.environment.set()/pm.globals.set() can chain values; persisted after the scripts run.
    const bridge: EnvBridge = {
      env: { ...(activeEnvironment?.variables ?? {}) },
      globals: { ...globals },
      folder: folderVariables(collections, request.id),
      envChanged: false,
      globalsChanged: false,
    };
    const logs: string[] = [];
    let testResults: TestResult[] = [];
    let scriptError: string | undefined;

    if (request.preRequestScript?.trim()) {
      const pre = runPreRequest(request.preRequestScript, request, bridge);
      logs.push(...pre.logs);
      scriptError = pre.error;
    }

    let outgoing: ApiRequest = { ...request, environment: mergedVars(bridge) };
    const form = serializeFormBody(request);
    if (form) {
      outgoing = { ...outgoing, body: form.body, headers: upsertHeader(request.headers, "Content-Type", form.contentType) };
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setSentRequest(outgoing);
    setScriptRun(undefined);

    const started = performance.now();
    let body = "";
    let statusCode = 0;
    let status = "Streaming…";
    let headers: Record<string, string> = {};
    let resolvedUrl = outgoing.url;
    let sent: ApiResponse["sent"];
    const emit = (extra?: Partial<ApiResponse>) =>
      setResponse({ statusCode, status, headers, body, bodySize: body.length, durationMs: Math.round(performance.now() - started), receivedAt: new Date().toISOString(), resolvedUrl, sent, ...extra });

    const result = await streamHttpRequest(
      outgoing,
      {
        onMeta: (meta) => {
          statusCode = meta.statusCode;
          status = meta.status || `${meta.statusCode}`;
          headers = meta.headers;
          resolvedUrl = meta.resolvedUrl;
          sent = meta.sent;
          emit();
        },
        onChunk: (text) => {
          body += text;
          emit();
        },
      },
      controller.signal,
    );

    const durationMs = Math.round(performance.now() - started);
    if (result.error && result.error !== "Aborted") {
      emit({ status: "Request failed", error: result.error });
    } else {
      emit({ status: result.error === "Aborted" ? `${status} (aborted)` : status });
      const finalResponse: ApiResponse = { statusCode, status, headers, body, bodySize: body.length, durationMs, receivedAt: new Date().toISOString(), resolvedUrl, sent };
      addHistory({ id: crypto.randomUUID(), request: outgoing, response: finalResponse, createdAt: new Date().toISOString() });

      // Post-response test script (only on a completed, non-aborted response).
      if (!result.error && request.tests?.trim()) {
        const testRun = runTests(request.tests, request, { code: statusCode, status, responseTime: durationMs, body, headers }, bridge);
        logs.push(...testRun.logs);
        testResults = testRun.tests;
        scriptError = scriptError ?? testRun.error;
      }
    }

    // Persist any pm.environment.set()/pm.globals.set() so the next request sees the new values.
    if (bridge.envChanged && activeEnvironment) {
      updateEnvironment({ ...activeEnvironment, variables: bridge.env });
    }
    if (bridge.globalsChanged) {
      updateGlobals(bridge.globals);
    }
    setScriptRun(logs.length || testResults.length || scriptError ? { tests: testResults, logs, error: scriptError } : undefined);
    setLoading(false);
    abortRef.current = null;
  };

  const downloadResponse = () => {
    if (!response) return;
    const contentType = response.headers["Content-Type"] ?? response.headers["content-type"] ?? "text/plain";
    const extension = contentType.includes("json") ? "json" : contentType.includes("xml") ? "xml" : contentType.includes("html") ? "html" : "txt";
    void saveResponseFile(`${(request.name || "response").replace(/\s+/g, "-").toLowerCase()}.${extension}`, response.body, contentType);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <section className="border-b border-line bg-[#1b2028] p-3">
        <div className="mb-3 flex items-center gap-2">
          <input
            value={request.name}
            onChange={(event) => updateRequest({ name: event.target.value })}
            className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-slate-100 outline-none hover:border-line focus:border-accent focus:bg-[#151a21]"
            placeholder="Request name"
          />
          <span className="text-xs text-slate-600">{isSaved ? "auto-saved" : "unsaved"}</span>
        </div>
        <div className="flex gap-2">
          <select
            value={request.method}
            onChange={(event) => updateRequest({ method: event.target.value as HttpMethod })}
            className="h-10 rounded-md border border-line bg-panel px-3 text-sm font-semibold outline-none focus:border-accent"
          >
            {methods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <input
            value={request.url}
            onChange={(event) => updateRequest({ url: event.target.value })}
            className="h-10 min-w-0 flex-1 rounded-md border border-line bg-[#151a21] px-3 font-mono text-sm outline-none placeholder:text-slate-600 focus:border-accent"
            placeholder="https://api.example.com/users/{{user_id}}"
          />
          {loading ? (
            <button onClick={cancel} className="flex h-10 items-center gap-2 rounded-md bg-danger px-4 text-sm font-semibold text-ink hover:opacity-90">
              <Square size={15} />
              Cancel
            </button>
          ) : (
            <button onClick={() => void run()} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink hover:bg-[#66e3bf]">
              <Play size={16} />
              Send
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {tabs.map((label) => (
            <button key={label} onClick={() => setActiveTab(label)} className={`rounded-md px-3 py-1.5 text-sm ${activeTab === label ? "bg-panel text-accent" : "text-slate-300 hover:bg-panel"}`}>
              {label} <span className="text-slate-500">{tabCount(label, request)}</span>
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <button title="Save request" onClick={saveActiveRequest} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100">
              <Save size={16} />
            </button>
            <button title="Duplicate request" onClick={duplicateActiveRequest} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100">
              <Copy size={16} />
            </button>
            <button title="Download response" onClick={downloadResponse} disabled={!response} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100 disabled:opacity-40">
              <Download size={16} />
            </button>
          </div>
        </div>
      </section>

      <Group orientation="horizontal" className="min-h-0">
        <Panel defaultSize="58" minSize="30" className="border-r border-line">
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize="70" minSize="20">
              <RequestTabPanel activeTab={activeTab} request={request} updateRequest={updateRequest} />
            </Panel>
            <Separator className="h-1 bg-line transition-colors hover:bg-accent/60" />
            <Panel defaultSize="30" minSize="12">
              <SnippetPanel />
            </Panel>
          </Group>
        </Panel>
        <Separator className="w-1 bg-line transition-colors hover:bg-accent/60" />
        <Panel defaultSize="42" minSize="25">
          <ResponseViewer response={response} loading={loading && !response} sentRequest={sentRequest} scriptRun={scriptRun} />
        </Panel>
      </Group>
    </div>
  );
}

type TabPanelProps = {
  activeTab: RequestTab;
  request: ApiRequest;
  updateRequest: (patch: Partial<ApiRequest>) => void;
};

function RequestTabPanel({ activeTab, request, updateRequest }: TabPanelProps) {
  // Hooks must run unconditionally, before the per-tab early returns.
  const bodyEditorRef = useRef<{ getAction?: (id: string) => { run?: () => void } | null } | null>(null);
  const [scriptTab, setScriptTab] = useState<"pre" | "test">("test");
  const formatBody = () => {
    if (request.bodyType === "json") {
      try {
        updateRequest({ body: JSON.stringify(JSON.parse(request.body), null, 2) });
        return;
      } catch {
        // fall through to Monaco's formatter, which surfaces the parse error in-editor
      }
    }
    bodyEditorRef.current?.getAction?.("editor.action.formatDocument")?.run?.();
  };

  if (activeTab === "Params") {
    return <HeaderTable title="Query Params" rows={request.queryParams} onChange={(queryParams) => updateRequest({ queryParams })} fill />;
  }

  if (activeTab === "Headers") {
    return <HeaderTable title="Headers" rows={request.headers} onChange={(headers) => updateRequest({ headers })} fill />;
  }

  if (activeTab === "Auth") {
    return (
      <div className="h-full min-h-0 overflow-auto p-4">
        <div className="grid max-w-2xl gap-3">
          <label className="grid gap-1 text-sm text-slate-400">
            Type
            <select value={request.auth.type ?? "none"} onChange={(event) => updateRequest({ auth: { ...request.auth, type: event.target.value } })} className="h-9 rounded-md border border-line bg-panel px-3 text-slate-100 outline-none focus:border-accent">
              <option value="none">No auth</option>
              <option value="bearer">Bearer token</option>
              <option value="basic">Basic auth</option>
              <option value="apiKey">API key</option>
            </select>
          </label>
          {request.auth.type === "bearer" && (
            <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3">
              <TextField label="Header name" value={request.auth.headerName ?? "Authorization"} onChange={(headerName) => updateRequest({ auth: { ...request.auth, headerName } })} />
              <TextField label="Token" value={request.auth.token ?? ""} onChange={(token) => updateRequest({ auth: { ...request.auth, token } })} secret />
            </div>
          )}
          {request.auth.type === "basic" && (
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Username" value={request.auth.username ?? ""} onChange={(username) => updateRequest({ auth: { ...request.auth, username } })} />
              <TextField label="Password" value={request.auth.password ?? ""} onChange={(password) => updateRequest({ auth: { ...request.auth, password } })} secret />
            </div>
          )}
          {request.auth.type === "apiKey" && (
            <div className="grid grid-cols-[1fr_1fr_160px] gap-3">
              <TextField label="Key" value={request.auth.key ?? ""} onChange={(key) => updateRequest({ auth: { ...request.auth, key } })} />
              <TextField label="Value" value={request.auth.value ?? ""} onChange={(value) => updateRequest({ auth: { ...request.auth, value } })} secret />
              <label className="grid gap-1 text-sm text-slate-400">
                Add to
                <select value={request.auth.addTo ?? "header"} onChange={(event) => updateRequest({ auth: { ...request.auth, addTo: event.target.value } })} className="h-9 rounded-md border border-line bg-panel px-3 text-slate-100 outline-none focus:border-accent">
                  <option value="header">Header</option>
                  <option value="query">Query param</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === "Tests") {
    const isPre = scriptTab === "pre";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3 text-sm text-slate-400">
          <div className="flex items-center gap-1">
            <button onClick={() => setScriptTab("pre")} className={`rounded-md px-2.5 py-1 text-xs ${isPre ? "bg-panel text-accent" : "text-slate-400 hover:bg-panel"}`}>
              Pre-request{request.preRequestScript?.trim() ? " ●" : ""}
            </button>
            <button onClick={() => setScriptTab("test")} className={`rounded-md px-2.5 py-1 text-xs ${!isPre ? "bg-panel text-accent" : "text-slate-400 hover:bg-panel"}`}>
              Test{request.tests?.trim() ? " ●" : ""}
            </button>
          </div>
          <span className="text-xs text-slate-600">{isPre ? "Runs before send — pm.environment.set(…)" : "Runs after response — pm.test / pm.expect"}</span>
        </div>
        <div className="relative min-h-0 flex-1">
          <Editor
            key={scriptTab}
            height="100%"
            language="javascript"
            theme="vs-dark"
            value={isPre ? request.preRequestScript ?? "" : request.tests}
            options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", padding: { top: 12 } }}
            onChange={(value) => updateRequest(isPre ? { preRequestScript: value ?? "" } : { tests: value ?? "" })}
          />
        </div>
      </div>
    );
  }

  if (activeTab === "Settings") {
    const followRedirects = request.followRedirects !== false;
    const verifySSL = request.verifySSL !== false;
    return (
      <div className="h-full min-h-0 overflow-auto p-4">
        <div className="grid max-w-2xl gap-3">
          <SettingToggle
            label="Follow redirects"
            hint="Follow 3xx Location responses automatically."
            checked={followRedirects}
            onChange={(value) => updateRequest({ followRedirects: value })}
          />
          <SettingToggle
            label="Verify TLS certificate"
            hint="Disable to allow self-signed / invalid certificates."
            checked={verifySSL}
            onChange={(value) => updateRequest({ verifySSL: value })}
          />
          <label className="grid max-w-xs gap-1 text-sm text-slate-400">
            Request timeout (ms)
            <input
              type="number"
              min={0}
              value={request.timeoutMs}
              onChange={(event) => updateRequest({ timeoutMs: Number(event.target.value) || 0 })}
              className="h-9 rounded-md border border-line bg-[#151a21] px-3 text-slate-100 outline-none focus:border-accent"
            />
            <span className="text-xs text-slate-600">0 = no timeout (waits until the server closes the connection).</span>
          </label>
        </div>
      </div>
    );
  }

  const isForm = request.bodyType === "form" || request.bodyType === "multipart";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3 text-sm text-slate-400">
        <span>Payload</span>
        <div className="flex items-center gap-2">
          {!isForm && (
            <button
              onClick={formatBody}
              disabled={!request.body}
              title="Format document"
              className="flex h-7 items-center gap-1 rounded-md border border-line bg-panel px-2 text-xs text-slate-300 hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <Braces size={13} />
              Format
            </button>
          )}
          <select value={request.bodyType} onChange={(event) => updateRequest({ bodyType: event.target.value as ApiRequest["bodyType"] })} className="h-7 rounded-md border border-line bg-panel px-2 outline-none">
            <option value="json">JSON</option>
            <option value="xml">XML</option>
            <option value="text">Text</option>
            <option value="form">Form URL Encoded</option>
            <option value="multipart">Multipart</option>
          </select>
        </div>
      </div>
      {isForm ? (
        <FormEditor rows={request.formFields ?? []} allowFiles={request.bodyType === "multipart"} onChange={(formFields) => updateRequest({ formFields })} />
      ) : (
        <div className="relative min-h-0 flex-1">
          <Editor
            height="100%"
            language={request.bodyType === "json" ? "json" : request.bodyType === "xml" ? "xml" : "plaintext"}
            theme="vs-dark"
            value={request.body}
            onMount={(editor) => (bodyEditorRef.current = editor)}
            options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", padding: { top: 12 } }}
            onChange={(body) => updateRequest({ body: body ?? "" })}
          />
        </div>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, secret = false }: { label: string; value: string; onChange: (value: string) => void; secret?: boolean }) {
  return (
    <label className="grid gap-1 text-sm text-slate-400">
      {label}
      <input value={value} type={secret ? "password" : "text"} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-md border border-line bg-[#151a21] px-3 text-slate-100 outline-none focus:border-accent" />
    </label>
  );
}

function SettingToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-line bg-panel px-3 py-2.5">
      <span className="grid gap-0.5">
        <span className="text-sm text-slate-200">{label}</span>
        <span className="text-xs text-slate-500">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-accent" />
    </label>
  );
}

function tabCount(tab: RequestTab, request: ApiRequest) {
  if (tab === "Params") return request.queryParams.length;
  if (tab === "Headers") return request.headers.length;
  if (tab === "Auth") return request.auth.type && request.auth.type !== "none" ? 1 : 0;
  if (tab === "Body") return request.body ? 1 : 0;
  if (tab === "Tests") return request.preRequestScript?.trim() || request.tests?.trim() ? 1 : 0;
  return 0;
}
