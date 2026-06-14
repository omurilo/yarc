import { Activity, Boxes, Braces, Clock3, Cookie, Download, GitBranch, RadioTower, Search, Settings, TerminalSquare, Upload } from "lucide-react";
import { useState } from "react";
import { CollectionTree } from "../components/CollectionTree";
import { EnvironmentSwitcher } from "../components/EnvironmentSwitcher";
import { CookieManager } from "../components/CookieManager";
import { ImportDialog } from "../components/ImportDialog";
import { GraphQLPanel } from "../pages/GraphQLPanel";
import { GrpcPanel } from "../pages/GrpcPanel";
import { HistoryPanel } from "../pages/HistoryPanel";
import { RestClient } from "../pages/RestClient";
import { SettingsPage } from "../pages/SettingsPage";
import { VisualFlowPanel } from "../pages/VisualFlowPanel";
import { WebSocketPanel } from "../pages/WebSocketPanel";
import { downloadFile } from "../services/download";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

const views = [
  { id: "rest", label: "REST", icon: TerminalSquare },
  { id: "graphql", label: "GraphQL", icon: Braces },
  { id: "websocket", label: "WebSocket", icon: RadioTower },
  { id: "grpc", label: "gRPC", icon: Boxes },
  { id: "flows", label: "Flows", icon: GitBranch },
  { id: "history", label: "History", icon: Clock3 },
] as const;

export function AppShell() {
  const activeView = useWorkspaceStore((state) => state.activeView);
  const setActiveView = useWorkspaceStore((state) => state.setActiveView);
  const setCommandOpen = useWorkspaceStore((state) => state.setCommandOpen);
  const collections = useWorkspaceStore((state) => state.collections);
  const [importOpen, setImportOpen] = useState(false);
  const [cookiesOpen, setCookiesOpen] = useState(false);

  const exportWorkspace = () => {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), collections }, null, 2);
    downloadFile("yarc-collections.json", payload);
  };

  return (
    <div className="grid h-screen grid-cols-[56px_292px_minmax(0,1fr)] overflow-hidden bg-ink text-slate-100">
      <aside className="flex flex-col items-center justify-between border-r border-line bg-rail py-3">
        <div className="flex flex-col gap-2">
          <img src="/logo.svg" alt="Yarc" className="mb-2 h-9 w-9" draggable={false} />
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <button
                key={view.id}
                className={`grid h-10 w-10 place-items-center rounded-md transition ${activeView === view.id ? "bg-panel text-accent shadow-focus" : "text-slate-400 hover:bg-panel hover:text-slate-100"}`}
                title={view.label}
                onClick={() => setActiveView(view.id)}
              >
                <Icon size={19} />
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          <button
            className="grid h-10 w-10 place-items-center rounded-md text-slate-400 transition hover:bg-panel hover:text-slate-100"
            title="Cookies"
            onClick={() => setCookiesOpen(true)}
          >
            <Cookie size={18} />
          </button>
          <button
            className={`grid h-10 w-10 place-items-center rounded-md transition ${activeView === "settings" ? "bg-panel text-accent shadow-focus" : "text-slate-400 hover:bg-panel hover:text-slate-100"}`}
            title="Settings"
            onClick={() => setActiveView("settings")}
          >
            <Settings size={18} />
          </button>
        </div>
      </aside>

      <aside className="flex min-h-0 min-w-0 flex-col border-r border-line bg-[#191d24]">
        <div className="shrink-0 border-b border-line px-3 py-3">
          <button
            onClick={() => setCommandOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-panel px-3 text-left text-sm text-slate-300 hover:border-accent/60"
          >
            <Search size={16} />
            Command palette
            <span className="ml-auto text-xs text-slate-500">⌘K</span>
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => setImportOpen(true)} className="flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-panel text-xs text-slate-300 hover:border-accent">
              <Upload size={14} />
              Import
            </button>
            <button onClick={exportWorkspace} className="flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-panel text-xs text-slate-300 hover:border-accent">
              <Download size={14} />
              Export
            </button>
          </div>
        </div>
        <CollectionTree />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex h-12 items-center justify-between border-b border-line bg-[#1b2028] px-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Activity size={16} className="text-accent" />
            <span>Local-first API workspace</span>
          </div>
          <EnvironmentSwitcher />
        </header>
        {activeView === "rest" && <RestClient />}
        {activeView === "graphql" && <GraphQLPanel />}
        {activeView === "websocket" && <WebSocketPanel />}
        {activeView === "grpc" && <GrpcPanel />}
        {activeView === "flows" && <VisualFlowPanel />}
        {activeView === "history" && <HistoryPanel />}
        {activeView === "settings" && <SettingsPage />}
      </main>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <CookieManager open={cookiesOpen} onClose={() => setCookiesOpen(false)} />
    </div>
  );
}
