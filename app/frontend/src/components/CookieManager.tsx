import { Cookie as CookieIcon, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clearCookies, deleteCookie, listCookies, saveCookie } from "../services/apiClient";
import type { Cookie } from "../types/api";

type Props = {
  open: boolean;
  onClose: () => void;
};

// Manages the desktop cookie jar: cookies are auto-sent/stored per domain by the backend; this
// view lets you inspect, edit values, and delete them.
export function CookieManager({ open, onClose }: Props) {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    void listCookies().then((list) => {
      setCookies(list);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const byDomain = useMemo(() => {
    const groups = new Map<string, Cookie[]>();
    for (const cookie of cookies) {
      const list = groups.get(cookie.domain) ?? [];
      list.push(cookie);
      groups.set(cookie.domain, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cookies]);

  if (!open) return null;

  const onEdit = (cookie: Cookie, value: string) => {
    setCookies((current) => current.map((c) => (c === cookie ? { ...c, value } : c)));
  };
  const onCommit = (cookie: Cookie) => void saveCookie(cookie);
  const onDelete = (cookie: Cookie) => {
    void deleteCookie(cookie.domain, cookie.path, cookie.name).then(refresh);
  };
  const onClearDomain = (domain: string) => {
    void clearCookies(domain).then(refresh);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 pt-[10vh]" onMouseDown={onClose}>
      <div className="mx-auto flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <CookieIcon size={16} className="text-accent" />
            Cookies
            <span className="text-xs text-slate-500">{cookies.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={refresh} title="Refresh" className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-panel hover:text-slate-100">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {byDomain.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-slate-500">No cookies stored yet. They are captured automatically from responses.</div>
          ) : (
            byDomain.map(([domain, list]) => (
              <div key={domain} className="mb-3 overflow-hidden rounded-md border border-line">
                <div className="flex items-center justify-between bg-panel px-3 py-1.5">
                  <span className="font-mono text-xs text-slate-200">{domain}</span>
                  <button onClick={() => onClearDomain(domain)} className="text-xs text-danger hover:underline">
                    Clear {list.length}
                  </button>
                </div>
                <div className="divide-y divide-line/60">
                  {list.map((cookie) => (
                    <div key={`${cookie.path}-${cookie.name}`} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
                      <span className="truncate font-mono text-xs text-slate-300" title={`${cookie.name} · path ${cookie.path}${cookie.secure ? " · secure" : ""}${cookie.httpOnly ? " · httpOnly" : ""}`}>
                        {cookie.name}
                      </span>
                      <input
                        value={cookie.value}
                        onChange={(event) => onEdit(cookie, event.target.value)}
                        onBlur={() => onCommit(cookie)}
                        className="h-7 min-w-0 rounded border border-line bg-[#14181f] px-2 font-mono text-xs text-slate-200 outline-none focus:border-accent"
                      />
                      <button onClick={() => onDelete(cookie)} title="Delete cookie" className="grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-panel hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
