import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { Environment } from "../types/api";

export function SettingsPage() {
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironmentId = useWorkspaceStore((state) => state.activeEnvironmentId);
  const addEnvironment = useWorkspaceStore((state) => state.addEnvironment);
  const updateEnvironment = useWorkspaceStore((state) => state.updateEnvironment);
  const deleteEnvironment = useWorkspaceStore((state) => state.deleteEnvironment);
  const setActiveEnvironment = useWorkspaceStore((state) => state.setActiveEnvironment);

  const [selectedId, setSelectedId] = useState(activeEnvironmentId);
  const selected = environments.find((environment) => environment.id === selectedId) ?? environments[0];

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#171b22]">
      <div className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage environments and workspace preferences.</p>

        <section className="mt-6 rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Environments</h2>
              <p className="text-xs text-slate-500">Variables are interpolated into requests using {"{{name}}"}.</p>
            </div>
            <button onClick={addEnvironment} className="flex h-8 items-center gap-2 rounded-md border border-line bg-[#14181f] px-3 text-xs text-slate-200 hover:border-accent">
              <Plus size={14} />
              New environment
            </button>
          </div>
          <div className="grid grid-cols-[220px_minmax(0,1fr)]">
            <div className="border-r border-line p-2">
              {environments.map((environment) => (
                <button
                  key={environment.id}
                  onClick={() => setSelectedId(environment.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${selected?.id === environment.id ? "bg-[#14181f] text-accent" : "text-slate-300 hover:bg-[#14181f]"}`}
                >
                  <span className="min-w-0 truncate">{environment.name}</span>
                  {environment.id === activeEnvironmentId && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              ))}
              {environments.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No environments.</div>}
            </div>
            <div className="min-w-0 p-4">{selected ? <EnvironmentEditor key={selected.id} environment={selected} isActive={selected.id === activeEnvironmentId} canDelete={environments.length > 1} onChange={updateEnvironment} onDelete={deleteEnvironment} onActivate={setActiveEnvironment} /> : <div className="text-sm text-slate-500">Create an environment to get started.</div>}</div>
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
  onChange: (environment: Environment) => void;
  onDelete: (id: string) => void;
  onActivate: (id: string) => void;
};

type VarRow = { key: string; value: string; secret: boolean };

function EnvironmentEditor({ environment, isActive, canDelete, onChange, onDelete, onActivate }: EditorProps) {
  const [name, setName] = useState(environment.name);
  const [rows, setRows] = useState<VarRow[]>(() =>
    Object.entries(environment.variables).map(([key, value]) => ({ key, value, secret: environment.secrets.includes(key) })),
  );

  const commit = (nextName: string, nextRows: VarRow[]) => {
    const variables: Record<string, string> = {};
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

  const addRow = () => setRows((current) => [...current, { key: "", value: "", secret: false }]);

  return (
    <div className="grid gap-4">
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

      <div className="grid gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_72px_32px] gap-2 px-1 text-xs uppercase tracking-wide text-slate-500">
          <span>Variable</span>
          <span>Value</span>
          <span>Secret</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_72px_32px] gap-2">
            <input value={row.key} onChange={(event) => updateRow(index, { key: event.target.value })} placeholder="api_url" className="h-9 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm text-slate-100 outline-none focus:border-accent" />
            <input value={row.value} type={row.secret ? "password" : "text"} onChange={(event) => updateRow(index, { value: event.target.value })} placeholder="value" className="h-9 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm text-slate-100 outline-none focus:border-accent" />
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
