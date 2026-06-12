import { Plus, Trash2 } from "lucide-react";
import type { HeaderRow } from "../types/api";

type Props = {
  title: string;
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  fill?: boolean;
};

export function HeaderTable({ title, rows, onChange, fill = false }: Props) {
  const update = (index: number, patch: Partial<HeaderRow>) => onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(rows.filter((_, current) => current !== index));

  return (
    <div className={`${fill ? "h-full min-h-0 overflow-hidden" : ""} border-b border-line`}>
      <div className="flex h-10 items-center justify-between px-3 text-sm text-slate-400">
        <span>{title}</span>
        <button title={`Add ${title}`} onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])} className="grid h-7 w-7 place-items-center rounded-md hover:bg-panel hover:text-accent">
          <Plus size={15} />
        </button>
      </div>
      <div className={`${fill ? "h-[calc(100%-40px)]" : "max-h-36"} overflow-auto px-3 pb-3`}>
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[28px_minmax(90px,1fr)_minmax(120px,1.4fr)_32px] gap-2 py-1">
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} className="self-center accent-accent" />
            <input value={row.key} onChange={(event) => update(index, { key: event.target.value })} placeholder="Key" className="h-8 rounded-md border border-line bg-[#151a21] px-2 text-sm outline-none focus:border-accent" />
            <input value={row.value} onChange={(event) => update(index, { value: event.target.value })} placeholder="Value" className="h-8 rounded-md border border-line bg-[#151a21] px-2 text-sm outline-none focus:border-accent" />
            <button title="Remove row" onClick={() => remove(index)} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-panel hover:text-danger">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
