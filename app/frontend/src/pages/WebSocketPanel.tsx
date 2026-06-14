import { ChevronDown, ChevronRight, PlugZap, Send, Unplug } from "lucide-react";
import { useRef, useState } from "react";
import { HeaderTable } from "../components/HeaderTable";
import { openBackendWebSocket, type WsController } from "../services/apiClient";
import type { HeaderRow } from "../types/api";

type Message = {
  id: string;
  direction: "system" | "in" | "out";
  payload: string;
  at: string;
};

export function WebSocketPanel() {
  const controller = useRef<WsController | null>(null);
  const native = useRef<WebSocket | null>(null);
  const [url, setUrl] = useState("");
  const [payload, setPayload] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const append = (direction: Message["direction"], nextPayload: string) => {
    setMessages((current) => [{ id: crypto.randomUUID(), direction, payload: nextPayload, at: new Date().toLocaleTimeString() }, ...current].slice(0, 300));
  };

  const disconnect = () => {
    controller.current?.close();
    native.current?.close();
    controller.current = null;
    native.current = null;
  };

  const connect = async () => {
    if (connected || connecting) {
      disconnect();
      return;
    }
    setConnecting(true);
    // Desktop: route through the Go backend so custom headers are honored.
    const backend = await openBackendWebSocket(url, headers, {
      onOpen: (status) => {
        setConnected(true);
        setConnecting(false);
        append("system", `Connected${status ? ` · ${status}` : ""}`);
      },
      onMessage: (data) => append("in", data),
      onClose: (reason) => {
        setConnected(false);
        setConnecting(false);
        append("system", `Disconnected${reason && reason !== "closed" ? ` · ${reason}` : ""}`);
      },
      onError: (error) => {
        setConnecting(false);
        append("system", `Error: ${error}`);
      },
    });
    if (backend) {
      controller.current = backend;
      return;
    }

    // Browser preview fallback: native WebSocket (cannot set custom headers).
    try {
      const socket = new WebSocket(url);
      native.current = socket;
      if (headers.some((h) => h.enabled && h.key)) append("system", "Custom headers are ignored by the browser's native WebSocket (use the desktop app).");
      socket.addEventListener("open", () => {
        setConnected(true);
        setConnecting(false);
        append("system", "Connected");
      });
      socket.addEventListener("message", (event) => append("in", String(event.data)));
      socket.addEventListener("close", () => {
        setConnected(false);
        setConnecting(false);
        append("system", "Disconnected");
      });
      socket.addEventListener("error", () => {
        setConnecting(false);
        append("system", "Connection error");
      });
    } catch (error) {
      setConnecting(false);
      append("system", error instanceof Error ? error.message : "Connection failed");
    }
  };

  const send = () => {
    if (!connected || !payload) return;
    if (controller.current) controller.current.send(payload);
    else if (native.current?.readyState === WebSocket.OPEN) native.current.send(payload);
    else return;
    append("out", payload);
    setPayload("");
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_72px] overflow-hidden bg-[#171b22]">
      <div className="border-b border-line">
        <div className="flex items-center gap-2 px-4 py-3">
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="wss://example.com/socket" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm outline-none focus:border-accent" />
          <button disabled={!url || connecting} onClick={() => void connect()} className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-60">
            {connected ? <Unplug size={15} /> : <PlugZap size={15} />}
            {connected ? "Disconnect" : connecting ? "Connecting" : "Connect"}
          </button>
        </div>
        <button onClick={() => setShowHeaders((value) => !value)} className="flex items-center gap-1 px-4 pb-2 text-xs text-slate-400 hover:text-slate-200">
          {showHeaders ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Connection headers {headers.filter((h) => h.enabled && h.key).length > 0 && <span className="text-slate-500">({headers.filter((h) => h.enabled && h.key).length})</span>}
        </button>
        {showHeaders && (
          <div className="max-h-48 overflow-auto border-t border-line">
            <HeaderTable title="Headers" rows={headers} onChange={setHeaders} />
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-auto p-4">
        {messages.map((message) => (
          <div key={message.id} className="mb-2 rounded-md border border-line bg-panel px-3 py-2 font-mono text-sm text-slate-300">
            <span className="mr-3 text-xs text-slate-500">{message.at}</span>
            <span className={message.direction === "in" ? "text-accent" : message.direction === "out" ? "text-sky-300" : "text-warn"}>{message.direction}</span>
            <span className="ml-3 whitespace-pre-wrap break-words">{message.payload}</span>
          </div>
        ))}
        {messages.length === 0 && <div className="text-sm text-slate-500">No connection open.</div>}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4">
        <input value={payload} onChange={(event) => setPayload(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder="Message payload" className="h-10 min-w-0 flex-1 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm outline-none focus:border-accent" />
        <button disabled={!connected || !payload} onClick={send} className="grid h-10 w-10 place-items-center rounded-md bg-panel text-accent disabled:text-slate-600">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
