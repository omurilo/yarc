import { PlugZap, Send, Unplug } from "lucide-react";
import { useRef, useState } from "react";

type Message = {
  id: string;
  direction: "system" | "in" | "out";
  payload: string;
  at: string;
};

export function WebSocketPanel() {
  const socket = useRef<WebSocket | null>(null);
  const [url, setUrl] = useState("");
  const [payload, setPayload] = useState("");
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const append = (direction: Message["direction"], nextPayload: string) => {
    setMessages((current) => [{ id: crypto.randomUUID(), direction, payload: nextPayload, at: new Date().toLocaleTimeString() }, ...current].slice(0, 300));
  };

  const connect = () => {
    if (connected) {
      socket.current?.close();
      return;
    }

    const nextSocket = new WebSocket(url);
    socket.current = nextSocket;
    nextSocket.addEventListener("open", () => {
      setConnected(true);
      append("system", "Connected");
    });
    nextSocket.addEventListener("message", (event) => append("in", String(event.data)));
    nextSocket.addEventListener("close", () => {
      setConnected(false);
      append("system", "Disconnected");
    });
    nextSocket.addEventListener("error", () => append("system", "Connection error"));
  };

  const send = () => {
    if (!socket.current || socket.current.readyState !== WebSocket.OPEN || !payload) return;
    socket.current.send(payload);
    append("out", payload);
    setPayload("");
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[56px_minmax(0,1fr)_72px] overflow-hidden bg-[#171b22]">
      <div className="flex items-center gap-2 border-b border-line px-4">
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="wss://example.com/socket" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-[#14181f] px-3 font-mono text-sm outline-none focus:border-accent" />
        <button disabled={!url} onClick={connect} className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink disabled:opacity-60">
          {connected ? <Unplug size={15} /> : <PlugZap size={15} />}
          {connected ? "Disconnect" : "Connect"}
        </button>
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
