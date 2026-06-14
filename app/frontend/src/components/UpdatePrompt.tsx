import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { checkForUpdate, openReleasePage, performUpdate, type UpdateInfo } from "../services/apiClient";

// How often to re-check GitHub for a newer release while the app stays open.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// Polls GitHub on launch and then every few hours; when a newer release exists, shows a toast with
// an "Update" button that downloads + applies the new build in place and relaunches the app.
export function UpdatePrompt() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState("");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void checkForUpdate().then((result) => {
        if (!cancelled && result?.updateAvailable) setInfo(result);
      });
    };
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Hide while there's no update or the user dismissed *this* version; a newer release re-surfaces.
  if (!info || dismissedVersion === info.latestVersion) return null;

  const update = async () => {
    setUpdating(true);
    setError("");
    const err = await performUpdate();
    // On success the backend relaunches and quits this process; if we're still here, it failed.
    if (err) {
      setError(err);
      setUpdating(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-80 overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles size={15} className="text-accent" />
        <span className="text-sm font-medium text-slate-100">Update available</span>
        <span className="text-xs text-slate-500">{info.currentVersion} → {info.latestVersion}</span>
        <button onClick={() => setDismissedVersion(info.latestVersion)} className="ml-auto grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-panel hover:text-slate-100">
          <X size={14} />
        </button>
      </div>
      {info.notes && <div className="max-h-28 overflow-auto whitespace-pre-wrap border-b border-line px-3 py-2 text-xs leading-5 text-slate-400">{info.notes.slice(0, 600)}</div>}
      {error && <div className="border-b border-line bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => void update()} disabled={updating} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent text-sm font-semibold text-ink disabled:opacity-60">
          {updating ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
          {updating ? "Updating…" : "Update & restart"}
        </button>
        <button onClick={() => void openReleasePage(info.url)} className="h-8 rounded-md border border-line px-3 text-xs text-slate-300 hover:border-accent">
          Notes
        </button>
      </div>
    </div>
  );
}
