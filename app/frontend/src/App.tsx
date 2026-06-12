import { useEffect } from "react";
import { AppShell } from "./layouts/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import { bootstrapWorkspace } from "./services/apiClient";
import { useWorkspaceStore } from "./store/useWorkspaceStore";

export default function App() {
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const setCommandOpen = useWorkspaceStore((state) => state.setCommandOpen);

  useEffect(() => {
    let mounted = true;
    bootstrapWorkspace().then((bootstrap) => {
      if (mounted) hydrate(bootstrap);
    });
    return () => {
      mounted = false;
    };
  }, [hydrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCommandOpen]);

  return (
    <>
      <AppShell />
      <CommandPalette />
    </>
  );
}
