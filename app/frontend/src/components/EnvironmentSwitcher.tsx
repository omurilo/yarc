import { ChevronDown } from "lucide-react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export function EnvironmentSwitcher() {
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironmentId = useWorkspaceStore((state) => state.activeEnvironmentId);
  const setActiveEnvironment = useWorkspaceStore((state) => state.setActiveEnvironment);

  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <span className="text-slate-500">Environment</span>
      <div className="relative">
        <select
          value={activeEnvironmentId}
          onChange={(event) => setActiveEnvironment(event.target.value)}
          className="h-8 appearance-none rounded-md border border-line bg-panel pl-3 pr-8 text-sm outline-none focus:border-accent"
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-2 top-2 text-slate-500" />
      </div>
    </label>
  );
}

