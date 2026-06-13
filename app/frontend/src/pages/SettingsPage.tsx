import { Check, Link2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { pickEnvFile } from "../services/apiClient";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { Environment } from "../types/api";

export function SettingsPage() {
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironmentId = useWorkspaceStore((state) => state.activeEnvironmentId);
  const addEnvironment = useWorkspaceStore((state) => state.addEnvironment);
  const updateEnvironment = useWorkspaceStore((state) => state.updateEnvironment);
  const deleteEnvironment = useWorkspaceStore((state) => state.deleteEnvironment);
  const setActiveEnvironment = useWorkspaceStore((state) => state.setActiveEnvironment);
  const globals = useWorkspaceStore((state) => state.globals);
  const updateGlobals = useWorkspaceStore((state) => state.updateGlobals);

  // Globals is a workspace-wide scope (lowest precedence), surfaced as a pinned pseudo-environment.
  const globalsEnv: Environment = { id: "globals", name: "Globals", variables: globals, secrets: [], active: false };
  const entries = [globalsEnv, ...environments];
  const [selectedId, setSelectedId] = useState(activeEnvironmentId);
  const selected = entries.find((environment) => environment.id === selectedId) ?? environments[0] ?? globalsEnv;
  const isGlobals = selected?.id === "globals";

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#171b22]">
      <div className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage environments and workspace preferences.</p>

        <section className="mt-6 rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Environments</h2>
              <p className="text-xs text-slate-500">Variables are interpolated into requests using {"{{name}}"}. File variables link to a path and are read from disk on every use.</p>
            </div>
            <button onClick={addEnvironment} className="flex h-8 items-center gap-2 rounded-md border border-line bg-[#14181f] px-3 text-xs text-slate-200 hover:border-accent">
              <Plus size={14} />
              New environment
            </button>
          </div>
          <div className="grid grid-cols-[220px_minmax(0,1fr)]">
            <div className="border-r border-line p-2">
              {entries.map((environment) => (
                <button
                  key={environment.id}
                  onClick={() => setSelectedId(environment.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${selected?.id === environment.id ? "bg-[#14181f] text-accent" : "text-slate-300 hover:bg-[#14181f]"} ${environment.id === "globals" ? "mb-1 border-b border-line/60 pb-2" : ""}`}
                >
                  <span className="min-w-0 truncate">{environment.id === "globals" ? "🌐 Globals" : environment.name}</span>
                  {environment.id === activeEnvironmentId && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              ))}
            </div>
            <div className="min-w-0 p-4">
              {selected ? (
                <EnvironmentEditor
                  key={selected.id}
                  environment={selected}
                  isActive={selected.id === activeEnvironmentId}
                  canDelete={!isGlobals && environments.length > 1}
                  isGlobals={isGlobals}
                  onChange={isGlobals ? (env) => updateGlobals(env.variables) : updateEnvironment}
                  onDelete={deleteEnvironment}
                  onActivate={setActiveEnvironment}
                />
              ) : (
                <div className="text-sm text-slate-500">Create an environment to get started.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type EditorProps = {
  environment: Environment;
  isActive: boolean;
  canDelete: boolean;
  isGlobals?: boolean;
  onChange: (environment: Environment) => void;
  onDelete: (id: string) => void;
  onActivate: (id: string) => void;
};

type VarRow = { key: string; value: {type: string, text: string; fileName?: string;}; secret: boolean; };

function EnvironmentEditor({ environment, isActive, canDelete, isGlobals = false, onChange, onDelete, onActivate }: EditorProps) {
  const [name, setName] = useState(environment.name);
  const [rows, setRows] = useState<VarRow[]>(() =>
    Object.entries(environment.variables).map(([key, value]) => ({ key, value, secret: environment.secrets.includes(key) })),
  );

  const pickFile = async (index: number) => {
    // Desktop: link by absolute path (content is read on every use, in the Go backend).
    const picked = await pickEnvFile();
    if (picked) {
      updateRow(index, { value: { type: "file", text: picked.path, fileName: picked.name } });
      return;
    }
    // Browser preview has no native picker — fall back to an inline snapshot.
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      updateRow(index, { value: { type: "file", text: await file.text(), fileName: file.name } });
    };
    input.click();
  };

  const commit = (nextName: string, nextRows: VarRow[]) => {
    const variables: Record<string, { type: string; text: string; fileName?: string; }> = {};
    const secrets: string[] = [];
    for (const row of nextRows) {
      if (!row.key) continue;
      variables[row.key] = row.value;
      if (row.secret) secrets.push(row.key);
    }
    onChange({ ...environment, name: nextName.trim() || environment.name, variables, secrets });
  };

  const updateRow = (index: number, patch: Partial<VarRow>) => {
    const next = rows.map((row, current) => (current === index ? { ...row, ...patch } : row));
    setRows(next);
    commit(name, next);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, current) => current !== index);
    setRows(next);
    commit(name, next);
  };

  const addRow = () => setRows((current) => [...current, { key: "", value: {type: "text", text: ""}, secret: false }]);

  return (
    <div className="grid gap-4">
      {isGlobals ? (
        <p className="text-xs text-slate-500">Workspace-wide variables (lowest precedence). Environment and folder variables override these.</p>
      ) : (
        <div className="flex items-end gap-2">
          <label className="grid flex-1 gap-1 text-xs text-slate-400">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => commit(name, rows)}
              className="h-9 rounded-md border border-line bg-[#14181f] px-3 text-sm text-slate-100 outline-none focus:border-accent"
            />
          </label>
          <button
            disabled={isActive}
            onClick={() => onActivate(environment.id)}
            className="h-9 rounded-md border border-line bg-[#14181f] px-3 text-xs text-slate-200 hover:border-accent disabled:opacity-50"
          >
            {isActive ? "Active" : "Set active"}
          </button>
          <button
            disabled={!canDelete}
            onClick={() => onDelete(environment.id)}
            title="Delete environment"
            className="grid h-9 w-9 place-items-center rounded-md border border-line bg-[#14181f] text-slate-400 hover:border-danger hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}

      <div className="grid gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_32px] gap-2 px-1 text-xs uppercase tracking-wide text-slate-500">
          <span>Variable</span>
          <span>Type</span>
          <span>Value</span>
          <span>Secret</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_32px] gap-2">
            <input value={row.key} onChange={(event) => updateRow(index, { key: event.target.value })} placeholder="api_url" className="h-9 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm text-slate-100 outline-none focus:border-accent" />
            {(
              <select
                value={row.value.type}
                onChange={(event) => updateRow(index, { value: {text: "", type: event.target.value as VarRow["value"]["type"]} })}
                className="h-9 rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent"
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            )}
            {row.value.type === "file" ? (
              <button
                type="button"
                onClick={() => void pickFile(index)}
                title={row.value.text ? `Linked file: ${row.value.text}\nRead from disk on every use.` : "Choose a file to link"}
                className="flex h-9 items-center gap-2 rounded-md border border-line bg-[#151a21] px-2 text-sm text-slate-300 hover:border-accent"
              >
                <Link2 size={13} className="shrink-0 text-accent" />
                <span className="truncate">{row.value.fileName || row.value.text || "Choose file"}</span>
              </button>
            ) : (
              <input value={row.value.text} type={row.secret ? "password" : "text"} onChange={(event) => updateRow(index, { value: { type: "text", text: event.target.value } })} placeholder="value" className="h-9 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm text-slate-100 outline-none focus:border-accent" />
            )}
            <label className="flex h-9 items-center justify-center rounded-md border border-line bg-[#14181f]">
              <input type="checkbox" checked={row.secret} onChange={(event) => updateRow(index, { secret: event.target.checked })} className="h-4 w-4 accent-accent" />
            </label>
            <button onClick={() => removeRow(index)} title="Remove variable" className="grid h-9 w-8 place-items-center rounded-md text-slate-500 hover:bg-[#14181f] hover:text-danger">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button onClick={addRow} className="flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-line text-xs text-slate-400 hover:border-accent hover:text-accent">
          <Plus size={14} />
          Add variable
        </button>
      </div>
    </div>
  );
}
