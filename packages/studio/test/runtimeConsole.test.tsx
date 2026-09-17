import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuntimeConsole } from "../src/RuntimeConsole.js";

describe("RuntimeConsole", () => {
  it("renders the shared Studio console structure and multiline entries", () => {
    const html = renderToStaticMarkup(createElement(RuntimeConsole, {
      title: "节点日志",
      emptyText: "等待节点输出…",
      entries: [{
        id: 1,
        ts: new Date("2026-07-23T10:00:00.000Z").getTime(),
        level: "info",
        message: "[model] ←\n你好",
      }],
    }));

    expect(html).toContain("anf-console");
    expect(html).toContain("anf-console-tab is-active\">节点日志");
    expect(html).toContain("anf-console-counter\">1");
    expect(html).toContain("[model] ←\n你好");
  });
});
