import { Check, Code2, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { buildSnippet, snippetLabels, snippetLanguages } from "../services/snippets";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export function SnippetPanel() {
  const request = useWorkspaceStore((state) => state.activeRequest);
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironmentId = useWorkspaceStore((state) => state.activeEnvironmentId);
  const [language, setLanguage] = useState<(typeof snippetLanguages)[number]>("curl");
  const [copied, setCopied] = useState(false);

  // Resolve variables against the active environment (the request itself doesn't store them),
  // so the snippet updates whenever a variable is edited in Settings.
  const activeEnvironment = environments.find((environment) => environment.id === activeEnvironmentId);
  const snippet = useMemo(
    () => buildSnippet(language, { ...request, environment: activeEnvironment?.variables ?? {} }),
    [language, request, activeEnvironment],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-t border-line bg-[#171b22]">
      <div className="flex h-10 items-center gap-2 px-3 text-sm text-slate-400">
        <Code2 size={15} />
        <span>Snippets</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} className="ml-auto h-7 rounded-md border border-line bg-panel px-2 text-slate-200 outline-none">
          {snippetLanguages.map((item) => (
            <option key={item} value={item}>
              {snippetLabels[item]}
            </option>
          ))}
        </select>
        <button onClick={() => void copy()} className="flex h-7 items-center gap-1 rounded-md bg-panel px-3 text-xs text-slate-200 hover:text-accent">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto border-t border-line p-3 font-mono text-xs leading-5 text-slate-300">{snippet}</pre>
    </div>
  );
}
