import { Plus, Settings2, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormField } from "../types/api";

type Props = {
  rows: FormField[];
  allowFiles: boolean;
  onChange: (rows: FormField[]) => void;
};

export function FormEditor({ rows, allowFiles, onChange }: Props) {
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const update = (index: number, patch: Partial<FormField>) => onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(rows.filter((_, current) => current !== index));
  const add = () => onChange([...rows, { key: "", value: "", type: "text", enabled: true }]);

  const pickFile = async (index: number, file?: File) => {
    if (!file) return;
    const text = await file.text();
    update(index, { type: "file", value: text, fileName: file.name, contentType: file.type || rows[index]?.contentType || "application/octet-stream" });
  };

  const columns = allowFiles ? "grid-cols-[28px_minmax(80px,1fr)_96px_minmax(120px,1.4fr)_32px_32px]" : "grid-cols-[28px_minmax(90px,1fr)_minmax(120px,1.4fr)_32px]";
  const menuRow = menu ? rows[menu.index] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <div className={`grid ${columns} gap-2 pb-1 text-xs uppercase tracking-wide text-slate-500`}>
          <span />
          <span>Key</span>
          {allowFiles && <span>Type</span>}
          <span>Value</span>
          <span />
          {allowFiles && <span />}
        </div>
        {rows.map((row, index) => (
          <div key={index} className={`grid ${columns} items-center gap-2 py-1`}>
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} className="self-center accent-accent" />
            <input value={row.key} onChange={(event) => update(index, { key: event.target.value })} placeholder="key" className="h-8 rounded-md border border-line bg-[#151a21] px-2 font-mono text-sm outline-none focus:border-accent" />
            {allowFiles && (
              <select
                value={row.type}
                onChange={(event) => update(index, { type: event.target.value as FormField["type"], value: "", fileName: undefined, contentType: undefined })}
                className="h-8 rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent"
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            )}
            {allowFiles && row.type === "file" ? (
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-[#151a21] px-2 text-sm text-slate-300 hover:border-accent">
                <Upload size={13} className="shrink-0 text-slate-500" />
                <span className="truncate">{row.fileName || "Choose file"}</span>
                <input type="file" className="hidden" onChange={(event) => void pickFile(index, event.target.files?.[0])} />
              </label>
            ) : (
              <input value={row.value} onChange={(event) => update(index, { value: event.target.value })} placeholder="value" className="h-8 rounded-md border border-line bg-[#151a21] px-2 font-mono text-sm outline-none focus:border-accent" />
            )}
            {allowFiles &&
              (row.type === "file" ? (
                <button
                  title="File options"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ index, x: rect.right - 256, y: rect.bottom + 6 });
                  }}
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-accent"
                >
                  <Settings2 size={15} />
                </button>
              ) : (
                <span />
              ))}
            <button title="Remove field" onClick={() => remove(index)} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-panel hover:text-danger">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button onClick={add} className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line text-xs text-slate-400 hover:border-accent hover:text-accent">
          <Plus size={14} />
          Add field
        </button>
      </div>

      {menu && menuRow && (
        <div className="fixed z-50 w-64 rounded-md border border-line bg-[#20242c] p-3 shadow-2xl" style={{ left: Math.max(8, menu.x), top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">File options</div>
          <label className="mb-2 grid gap-1 text-xs text-slate-400">
            File name
            <input
              autoFocus
              value={menuRow.fileName ?? ""}
              onChange={(event) => update(menu.index, { fileName: event.target.value })}
              placeholder="file.bin"
              className="h-8 rounded-md border border-line bg-[#151a21] px-2 font-mono text-sm text-slate-100 outline-none focus:border-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            File Content-Type <span className="text-slate-600">(this part only)</span>
            <input
              value={menuRow.contentType ?? ""}
              onChange={(event) => update(menu.index, { contentType: event.target.value })}
              placeholder="application/octet-stream"
              className="h-8 rounded-md border border-line bg-[#151a21] px-2 font-mono text-sm text-slate-100 outline-none focus:border-accent"
            />
          </label>
        </div>
      )}
    </div>
  );
}
