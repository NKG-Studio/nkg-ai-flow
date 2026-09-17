import { describe, expect, it } from "vitest";
import type { FlowPreviewGraph } from "../src/FlowPreview.js";
import {
  createFlowPreviewConsoleEntries,
  createFlowPreviewElements,
} from "../src/FlowPreview.js";

const graph: FlowPreviewGraph = {
  id: "preview_test",
  version: "1.0.0",
  schemaVersion: "flow.graph.v1",
  nodes: [
    {
      id: "start",
      type: "start",
      typeVersion: "1.0.0",
      position: { x: 0, y: 0 },
      ports: [{ id: "out", direction: "output", kind: "control", label: "下一步" }],
      config: {},
    },
    {
      id: "model",
      type: "llm",
      typeVersion: "1.0.0",
      position: { x: 400, y: 0 },
      ports: [{ id: "in", direction: "input", kind: "control", label: "输入" }],
      config: {},
    },
  ],
  edges: [{
    id: "start-model",
    from: { nodeId: "start", portId: "out" },
    to: { nodeId: "model", portId: "in" },
  }],
};

describe("FlowPreview projection", () => {
  it("preserves graph positions, port handles, labels, and runtime states", () => {
    const projection = createFlowPreviewElements(graph, [
      { kind: "node_started", nodeId: "start", timestamp: "2026-07-23T10:00:00.000Z", payload: {} },
      { kind: "node_finished", nodeId: "start", timestamp: "2026-07-23T10:00:00.020Z", payload: { durationMs: 20 } },
      { kind: "node_started", nodeId: "model", timestamp: "2026-07-23T10:00:00.021Z", payload: {} },
      { kind: "stream_delta", nodeId: "model", timestamp: "2026-07-23T10:00:00.022Z", payload: { delta: "你" } },
    ]);

    expect(projection.nodes).toHaveLength(2);
    expect(projection.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(projection.nodes[0]).toMatchObject({ width: 220, height: 80 });
    expect(projection.nodes[1]).toMatchObject({ width: 220, height: 80 });
    expect(projection.nodes[0]?.data.label).toBe("开始");
    expect(projection.nodes[1]?.data.label).toBe("大模型调用");
    expect(projection.nodes[0]?.data.status).toBe("succeeded");
    expect(projection.nodes[0]?.data.runtime?.durationMs).toBe(20);
    expect(projection.nodes[1]?.data.status).toBe("streaming");
    expect(projection.edges[0]).toMatchObject({
      source: "start",
      sourceHandle: "out",
      target: "model",
      targetHandle: "in",
      type: "smoothstep",
    });
  });

  it("projects live and completed node output into the shared console", () => {
    const streamingEvents = [
      { kind: "node_started", nodeId: "model", timestamp: "2026-07-23T10:00:00.000Z", payload: {} },
      { kind: "stream_delta", nodeId: "model", timestamp: "2026-07-23T10:00:00.010Z", payload: { text: "你" } },
      { kind: "stream_delta", nodeId: "model", timestamp: "2026-07-23T10:00:00.020Z", payload: { text: "好" } },
    ];

    expect(createFlowPreviewConsoleEntries(graph, streamingEvents)).toEqual([
      {
        id: 1,
        ts: 1784800800000,
        level: "debug",
        message: "[大模型调用] → 开始执行",
      },
      {
        id: 5,
        ts: 1784800800020,
        level: "info",
        message: "[大模型调用] ← 实时输出\n你好",
      },
    ]);

    const completedEvents = [
      ...streamingEvents,
      {
        kind: "node_finished",
        nodeId: "model",
        timestamp: "2026-07-23T10:00:00.030Z",
        payload: { output: { result: "你好", summary: { totalTokens: 2 } }, durationMs: 30 },
      },
    ];
    expect(createFlowPreviewConsoleEntries(graph, completedEvents).at(-1)).toEqual({
      id: 4,
      ts: 1784800800030,
      level: "info",
      message: '[大模型调用] ←\n{\n  "result": "你好",\n  "summary": {\n    "totalTokens": 2\n  }\n}',
    });
  });

  it("shows the latest attempt error without retaining stale live output", () => {
    const entries = createFlowPreviewConsoleEntries(graph, [
      { kind: "node_started", nodeId: "model", timestamp: "2026-07-23T10:00:00.000Z", payload: {} },
      { kind: "stream_delta", nodeId: "model", timestamp: "2026-07-23T10:00:00.010Z", payload: { text: "旧输出" } },
      { kind: "node_started", nodeId: "model", timestamp: "2026-07-23T10:00:00.020Z", payload: {} },
      { kind: "node_error", nodeId: "model", timestamp: "2026-07-23T10:00:00.030Z", payload: { error: { message: "请求失败" } } },
    ]);

    expect(entries.at(-1)).toEqual({
      id: 4,
      ts: 1784800800030,
      level: "error",
      message: '[大模型调用] 执行失败\n{\n  "message": "请求失败"\n}',
    });
    expect(entries.some((entry) => entry.message.includes("旧输出"))).toBe(false);
  });
});
