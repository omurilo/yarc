import { Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";
import ReactFlow, { Background, Controls, MiniMap, addEdge, useEdgesState, useNodesState, type Connection, type Node } from "reactflow";

const initialNodes: Node[] = [];

export function VisualFlowPanel() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback((connection: Connection) => setEdges((current) => addEdge(connection, current)), [setEdges]);
  const addRequest = () => {
    const index = nodes.length + 1;
    setNodes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        position: { x: 120 + index * 32, y: 120 + index * 24 },
        data: { label: `Request ${index}` },
        type: "default",
      },
    ]);
  };

  const clear = () => {
    setNodes([]);
    setEdges([]);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#171b22]">
      <div className="absolute left-4 top-4 z-10 flex gap-2">
        <button onClick={addRequest} className="flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm text-slate-200 hover:border-accent">
          <Plus size={15} /> Request
        </button>
        <button onClick={clear} className="grid h-9 w-9 place-items-center rounded-md border border-line bg-panel text-slate-400 hover:border-danger hover:text-danger">
          <Trash2 size={15} />
        </button>
      </div>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView>
        <Background color="#343945" />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
