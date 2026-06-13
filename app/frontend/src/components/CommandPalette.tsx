import { Boxes, Braces, Clock3, GitBranch, RadioTower, Search, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

const commands = [
  { label: "Open REST client", view: "rest", icon: TerminalSquare },
  { label: "Create request", view: "rest", icon: TerminalSquare },
  { label: "Open GraphQL explorer", view: "graphql", icon: Braces },
  { label: "Open WebSocket console", view: "websocket", icon: RadioTower },
  { label: "Open gRPC studio", view: "grpc", icon: Boxes },
  { label: "Open visual flows", view: "flows", icon: GitBranch },
  { label: "Search history", view: "history", icon: Clock3 },
] as const;

export function CommandPalette() {
  const open = useWorkspaceStore((state) => state.commandOpen);
  const setOpen = useWorkspaceStore((state) => state.setCommandOpen);
  const setActiveView = useWorkspaceStore((state) => state.setActiveView);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-[#1b2028] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-12 items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-slate-500" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a command or search anything" className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" />
        </div>
        <div className="max-h-96 overflow-auto p-2">
          {filtered.map((command) => {
            const Icon = command.icon;
            return (
              <button
                key={command.label}
                className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-slate-200 hover:bg-panel"
                onClick={() => {
                  setActiveView(command.view);
                  setOpen(false);
                }}
              >
                <Icon size={16} className="text-accent" />
                {command.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

