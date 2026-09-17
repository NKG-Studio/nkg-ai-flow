import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./flowPreview.css";
import type { FlowGraph, NodeInstance, PortDefinition } from "@ai-native-flow/flow-ir";
import { STUDIO_NODE_LABEL_DICTIONARIES } from "./paletteLabels.js";
import {
  deriveRuntimeDebugNodeState,
  type RuntimeDebugEvent,
} from "./runtimeDebug.js";
import {
  RuntimeConsole,
  type ConsoleEntry,
  type ConsoleLevel,
} from "./RuntimeConsole.js";
import type { StudioNodeStatus } from "./types.js";

export type FlowPreviewGraph = FlowGraph;
export type FlowPreviewNodeStatus = StudioNodeStatus;
export type FlowPreviewRuntimeEvent = RuntimeDebugEvent;

export interface FlowPreviewProps {
  graph: FlowPreviewGraph;
  runtimeEvents?: ReadonlyArray<FlowPreviewRuntimeEvent>;
  className?: string;
  ariaLabel?: string;
}

interface PreviewNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  status: FlowPreviewNodeStatus;
  runtime?: {
    startedAt?: number;
    durationMs?: number;
  };
}

type PreviewNode = Node<PreviewNodeData, "flowPreviewNode">;
type PreviewEdge = Edge;

const nodeTypes = {
  flowPreviewNode: memo(PreviewNodeCard),
};

export function FlowPreview({
  graph,
  runtimeEvents = [],
  className = "",
  ariaLabel,
}: FlowPreviewProps) {
  const projection = useMemo(
    () => createFlowPreviewElements(graph, runtimeEvents),
    [graph, runtimeEvents],
  );
  const consoleEntries = useMemo(
    () => createFlowPreviewConsoleEntries(graph, runtimeEvents),
    [graph, runtimeEvents],
  );

  if (projection.nodes.length === 0) {
    return <div className={`anf-flow-preview-empty ${className}`.trim()}>该 Flow 暂无节点</div>;
  }

  return (
    <>
      <ReactFlowProvider>
        <FlowPreviewCanvas
          ariaLabel={ariaLabel ?? `${graph.label ?? graph.id} 执行流程`}
          className={className}
          edges={projection.edges}
          nodes={projection.nodes}
          topologyKey={`${graph.id}@${graph.version}:${graph.nodes.map((node) => node.id).join(",")}`}
        />
      </ReactFlowProvider>
      <RuntimeConsole
        ariaLabel={`${graph.label ?? graph.id} 节点日志`}
        className="anf-flow-preview-console"
        emptyText="等待节点输出…"
        entries={consoleEntries}
        title="节点日志"
      />
    </>
  );
}

function FlowPreviewCanvas({
  ariaLabel,
  className,
  edges,
  nodes,
  topologyKey,
}: {
  ariaLabel: string;
  className: string;
  edges: PreviewEdge[];
  nodes: PreviewNode[];
  topologyKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesInitialized = useNodesInitialized();
  const reactFlow = useReactFlow<PreviewNode, PreviewEdge>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !nodesInitialized) return;
    let frame = 0;
    const fitWholeGraph = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        void reactFlow.fitView({
          padding: 0.1,
          minZoom: 0.05,
          maxZoom: 1,
          duration: 0,
        });
      });
    };
    fitWholeGraph();
    const observer = new ResizeObserver(fitWholeGraph);
    observer.observe(container);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [nodesInitialized, reactFlow, topologyKey]);

  return (
    <div
      aria-label={ariaLabel}
      className={`anf-flow-preview ${className}`.trim()}
      ref={containerRef}
      role="img"
    >
        <ReactFlow<PreviewNode, PreviewEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.1, minZoom: 0.05, maxZoom: 1 }}
          minZoom={0.05}
          maxZoom={1.6}
          panOnDrag
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        />
    </div>
  );
}

export function createFlowPreviewElements(
  graph: FlowPreviewGraph,
  runtimeEvents: ReadonlyArray<FlowPreviewRuntimeEvent> = [],
): { nodes: PreviewNode[]; edges: PreviewEdge[] } {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return {
    nodes: graph.nodes.map((node) => {
      const debug = deriveRuntimeDebugNodeState(runtimeEvents, node.id);
      return {
        id: node.id,
        type: "flowPreviewNode",
        position: { ...node.position },
        width: PREVIEW_NODE_WIDTH,
        height: previewNodeHeight(node),
        data: {
          label: previewNodeLabel(node),
          type: node.type,
          inputs: node.ports.filter((port) => port.direction === "input"),
          outputs: node.ports.filter((port) => port.direction === "output"),
          status: debug.status,
          ...(debug.runtime ? { runtime: debug.runtime } : {}),
        },
      };
    }),
    edges: graph.edges.map((edge) => {
      const sourcePort = nodeById.get(edge.from.nodeId)?.ports.find(
        (port) => port.id === edge.from.portId,
      );
      return {
        id: edge.id,
        source: edge.from.nodeId,
        sourceHandle: edge.from.portId,
        target: edge.to.nodeId,
        targetHandle: edge.to.portId,
        type: "smoothstep",
        style: {
          stroke: portKindColor(sourcePort?.kind),
          strokeWidth: sourcePort?.kind === "control" ? 2.2 : 1.7,
        },
      };
    }),
  };
}

export function createFlowPreviewConsoleEntries(
  graph: FlowPreviewGraph,
  runtimeEvents: ReadonlyArray<FlowPreviewRuntimeEvent> = [],
): ConsoleEntry[] {
  const labelById = new Map(graph.nodes.map((node) => [node.id, previewNodeLabel(node)]));
  const entries = runtimeEvents.flatMap((event, index) => {
    const entry = runtimeEventConsoleEntry(event, index + 1, labelById);
    return entry ? [entry] : [];
  });

  for (const [nodeIndex, node] of graph.nodes.entries()) {
    const streaming = currentStreamingConsoleEntry(
      runtimeEvents,
      node.id,
      runtimeEvents.length + nodeIndex + 1,
      labelById.get(node.id) ?? node.id,
    );
    if (streaming) entries.push(streaming);
  }

  return entries.sort((left, right) => left.ts - right.ts || left.id - right.id);
}

function runtimeEventConsoleEntry(
  event: FlowPreviewRuntimeEvent,
  id: number,
  labelById: ReadonlyMap<string, string>,
): ConsoleEntry | undefined {
  const payload = asPreviewRecord(event.payload);
  const node = event.nodeId
    ? `[${labelById.get(event.nodeId) ?? event.nodeId}] `
    : "";
  const ts = previewEventTimestamp(event);
  switch (event.kind) {
    case "run_started":
      return { id, ts, level: "info", message: "▶ Flow 开始执行" };
    case "run_finished":
      return {
        id,
        ts,
        level: "info",
        message: Object.prototype.hasOwnProperty.call(payload, "output")
          ? `✓ Flow 执行完成\n${formatPreviewOutput(payload.output)}`
          : "✓ Flow 执行完成",
      };
    case "run_failed":
      return {
        id,
        ts,
        level: "error",
        message: `✕ Flow 执行失败\n${formatPreviewOutput(payload.error ?? payload.message ?? "未知错误")}`,
      };
    case "run_cancelled":
      return { id, ts, level: "warn", message: "Flow 执行已取消" };
    case "node_started":
      return { id, ts, level: "debug", message: `${node}→ 开始执行` };
    case "node_finished":
      return {
        id,
        ts,
        level: "info",
        message: Object.prototype.hasOwnProperty.call(payload, "output")
          ? `${node}←\n${formatPreviewOutput(payload.output)}`
          : `${node}← 执行完成`,
      };
    case "node_error":
    case "node_failed":
      return {
        id,
        ts,
        level: "error",
        message: `${node}执行失败\n${formatPreviewOutput(payload.error ?? payload.message ?? "未知错误")}`,
      };
    case "node_warning":
      return {
        id,
        ts,
        level: "warn",
        message: `${node}${formatPreviewOutput(payload.message ?? payload)}`,
      };
    case "node_log":
      return {
        id,
        ts,
        level: consoleLevel(payload.level),
        message: `${node}${formatPreviewOutput(payload.message ?? payload)}`,
      };
    default:
      return undefined;
  }
}

function currentStreamingConsoleEntry(
  events: ReadonlyArray<FlowPreviewRuntimeEvent>,
  nodeId: string,
  id: number,
  label: string,
): ConsoleEntry | undefined {
  const nodeEvents = events.filter((event) => event.nodeId === nodeId);
  let startedAt = -1;
  for (let index = nodeEvents.length - 1; index >= 0; index -= 1) {
    if (nodeEvents[index]?.kind === "node_started") {
      startedAt = index;
      break;
    }
  }
  const currentAttempt = nodeEvents.slice(Math.max(0, startedAt));
  if (currentAttempt.some((event) =>
    event.kind === "node_finished"
      || event.kind === "node_error"
      || event.kind === "node_failed",
  )) return undefined;

  const deltas = currentAttempt.filter((event) => event.kind === "stream_delta");
  const text = deltas.map((event) => formatStreamChunk(event.payload)).join("");
  if (!text) return undefined;
  return {
    id,
    ts: previewEventTimestamp(deltas.at(-1)!),
    level: "info",
    message: `[${label}] ← 实时输出\n${text}`,
  };
}

function consoleLevel(value: unknown): ConsoleLevel {
  return value === "log"
    || value === "info"
    || value === "warn"
    || value === "error"
    || value === "debug"
    ? value
    : "info";
}

function formatStreamChunk(payload: unknown): string {
  if (typeof payload === "string") return payload;
  const record = asPreviewRecord(payload);
  for (const key of ["text", "delta", "content"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return Object.keys(record).length > 0 ? formatPreviewOutput(record) : "";
}

function formatPreviewOutput(value: unknown): string {
  if (typeof value === "string") return value || "（空字符串）";
  if (value === undefined) return "（无输出）";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function asPreviewRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function previewEventTimestamp(event: FlowPreviewRuntimeEvent): number {
  const timestamp = Date.parse(event.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const PREVIEW_NODE_WIDTH = 220;

function previewNodeHeight(node: NodeInstance): number {
  const inputCount = node.ports.filter((port) => port.direction === "input").length;
  const outputCount = node.ports.filter((port) => port.direction === "output").length;
  const portRows = Math.max(inputCount, outputCount);
  return portRows === 0 ? 44 : 57 + (portRows * 23);
}

function PreviewNodeCard({ data }: NodeProps<PreviewNode>) {
  const rows = pairPorts(data.inputs, data.outputs);
  return (
    <div className={`anf-preview-node anf-preview-node--${data.status}`}>
      <div className="anf-preview-node-head">
        <span className={`anf-preview-node-icon anf-preview-node-icon--${nodeKind(data.type)}`} aria-hidden>
          {data.label.slice(0, 1).toUpperCase()}
        </span>
        <strong title={data.label}>{data.label}</strong>
        <PreviewRuntime status={data.status} runtime={data.runtime} />
        <span
          aria-label={statusLabel(data.status)}
          className={`anf-preview-node-status anf-preview-node-status--${data.status}`}
          title={statusLabel(data.status)}
        />
      </div>
      {rows.length ? (
        <div className="anf-preview-node-ports">
          {rows.map((row, index) => (
            <div className="anf-preview-port-row" key={`${row.input?.id ?? "none"}-${row.output?.id ?? "none"}-${index}`}>
              <PreviewPort port={row.input} side="input" />
              <PreviewPort port={row.output} side="output" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewRuntime({
  status,
  runtime,
}: {
  status: FlowPreviewNodeStatus;
  runtime?: PreviewNodeData["runtime"];
}) {
  const [, refresh] = useState(0);
  const active = status === "running" || status === "streaming";
  useEffect(() => {
    if (!active || runtime?.startedAt === undefined) return;
    const timer = window.setInterval(() => refresh((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [active, runtime?.startedAt]);
  if (!runtime) return null;
  const duration = runtime.durationMs
    ?? (runtime.startedAt === undefined ? undefined : Math.max(0, Date.now() - runtime.startedAt));
  if (duration === undefined) return null;
  return <small className="anf-preview-node-runtime">{Math.round(duration)}ms</small>;
}

function PreviewPort({
  port,
  side,
}: {
  port?: PortDefinition;
  side: "input" | "output";
}) {
  if (!port) return <span />;
  const isInput = side === "input";
  return (
    <span className={`anf-preview-port anf-preview-port--${side}`}>
      <Handle
        className={`anf-preview-handle anf-preview-handle--${port.kind}`}
        id={port.id}
        isConnectable={false}
        position={isInput ? Position.Left : Position.Right}
        type={isInput ? "target" : "source"}
      />
      <span title={port.label ?? port.id}>{port.label ?? port.id}</span>
    </span>
  );
}

function pairPorts(inputs: PortDefinition[], outputs: PortDefinition[]) {
  return Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, index) => ({
    input: inputs[index],
    output: outputs[index],
  }));
}

function previewNodeLabel(node: NodeInstance): string {
  return node.label
    ?? STUDIO_NODE_LABEL_DICTIONARIES["zh-CN"].nodes[node.type]?.title
    ?? node.id;
}

function nodeKind(type: string): "entry" | "model" | "logic" | "action" {
  if (type === "start" || type === "end") return "entry";
  if (type === "llm" || type === "agent") return "model";
  if (type.includes("condition") || type.includes("parse") || type.includes("gate")) return "logic";
  return "action";
}

function portKindColor(kind?: PortDefinition["kind"]): string {
  switch (kind) {
    case "control": return "var(--anf-preview-control)";
    case "stream": return "var(--anf-preview-stream)";
    case "event": return "var(--anf-preview-event)";
    case "error": return "var(--anf-preview-error)";
    default: return "var(--anf-preview-data)";
  }
}

function statusLabel(status: FlowPreviewNodeStatus): string {
  switch (status) {
    case "running": return "执行中";
    case "streaming": return "流式输出中";
    case "succeeded": return "已完成";
    case "failed": return "执行失败";
    default: return "等待执行";
  }
}
