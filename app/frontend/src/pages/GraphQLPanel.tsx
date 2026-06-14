import Editor from "@monaco-editor/react";
import { BookOpen, ChevronRight, Play, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { relayRequest } from "../services/apiClient";
import { buildOperation, documentedTypes, INTROSPECTION_QUERY, parseSchema, rootFields, typeName, type GqlField, type GqlSchema } from "../services/graphql";

type RootKind = "query" | "mutation" | "subscription";

export function GraphQLPanel() {
  const [endpoint, setEndpoint] = useState("");
  const [query, setQuery] = useState("");
  const [variables, setVariables] = useState("");
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<GqlSchema>();
  const [schemaError, setSchemaError] = useState("");
  const [introspecting, setIntrospecting] = useState(false);

  const post = (body: unknown) =>
    relayRequest({ url: endpoint, method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });

  const run = async () => {
    setRunning(true);
    try {
      const parsedVariables = variables.trim() ? JSON.parse(variables) : undefined;
      const result = await post({ query, variables: parsedVariables });
      setResponse(result.error ? result.error : formatJSON(result.body));
    } catch (error) {
      setResponse(error instanceof Error ? error.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  const introspect = async () => {
    if (!endpoint) return;
    setIntrospecting(true);
    setSchemaError("");
    try {
      const result = await post({ query: INTROSPECTION_QUERY });
      if (result.error) throw new Error(result.error);
      setSchema(parseSchema(result.body));
    } catch (error) {
      setSchema(undefined);
      setSchemaError(error instanceof Error ? error.message : "Introspection failed");
    } finally {
      setIntrospecting(false);
    }
  };

  const insertOperation = (field: GqlField, root: RootKind) => {
    if (schema) setQuery(buildOperation(schema, field, root));
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_340px] overflow-hidden bg-[#171b22]">
      <aside className="flex min-h-0 flex-col overflow-hidden border-r border-line">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 text-sm text-slate-400">
          <Search size={15} />
          Explorer
          <button onClick={() => void introspect()} disabled={!endpoint || introspecting} title="Load schema (introspection)" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-accent disabled:opacity-40">
            <RefreshCw size={14} className={introspecting ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-sm">
          {schemaError && <div className="m-1 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{schemaError}</div>}
          {!schema && !schemaError && <div className="m-1 rounded-md border border-line bg-panel p-3 text-slate-500">No schema loaded. Click the refresh icon to introspect the endpoint.</div>}
          {schema && (
            <>
              <RootGroup title="Queries" fields={rootFields(schema, "query")} onPick={(f) => insertOperation(f, "query")} />
              <RootGroup title="Mutations" fields={rootFields(schema, "mutation")} onPick={(f) => insertOperation(f, "mutation")} />
              <RootGroup title="Subscriptions" fields={rootFields(schema, "subscription")} onPick={(f) => insertOperation(f, "subscription")} />
            </>
          )}
        </div>
      </aside>

      <main className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)_220px] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} onBlur={() => !schema && endpoint && void introspect()} placeholder="GraphQL endpoint" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-[#14181f] px-3 text-sm outline-none focus:border-accent" />
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

      <aside className="flex min-h-0 flex-col overflow-hidden border-l border-line">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 text-sm text-slate-400">
          <BookOpen size={15} />
          Documentation
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 text-sm leading-6">
          {!schema ? (
            <div className="text-slate-500">No documentation loaded.</div>
          ) : (
            documentedTypes(schema).map((type) => (
              <div key={type.name} className="mb-3">
                <div className="font-mono text-xs font-semibold text-accent">{type.name}</div>
                {type.description && <div className="text-xs text-slate-500">{type.description}</div>}
                <div className="mt-1 grid gap-0.5">
                  {(type.fields ?? type.inputFields ?? []).map((f) => (
                    <div key={f.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 font-mono text-xs">
                      <span className="truncate text-slate-300">{f.name}</span>
                      <span className="shrink-0 text-slate-500">{typeName(f.type)}</span>
                    </div>
                  ))}
                  {type.enumValues?.map((v) => (
                    <div key={v.name} className="font-mono text-xs text-slate-400">{v.name}</div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function RootGroup({ title, fields, onPick }: { title: string; fields: GqlField[]; onPick: (field: GqlField) => void }) {
  if (fields.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="px-2 py-1 text-xs uppercase tracking-wide text-slate-500">{title}</div>
      {fields.map((field) => (
        <button
          key={field.name}
          onClick={() => onPick(field)}
          title={field.description ?? `${field.name}: ${typeName(field.type)}`}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-panel"
        >
          <ChevronRight size={12} className="shrink-0 text-slate-600" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{field.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-slate-500">{typeName(field.type)}</span>
        </button>
      ))}
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
