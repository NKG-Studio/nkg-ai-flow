/**
 * Zod schemas for the Flow Graph IR. These are the runtime validation contract;
 * static `interface`s in `./types.ts` are kept identical in shape.
 *
 * Schemas here are intentionally strict enough to catch malformed JSON but
 * forgiving for forward-compatible additive fields (per
 * `docs/decisions/schema-versioning.md`):
 *   - Top-level shape uses `.passthrough()` so unknown optional fields do
 *     not break loading on minor schema additions.
 *   - Required structural fields (id, schemaVersion, ports, edges) remain
 *     strictly validated.
 */

import { z } from "zod";
import {
  FLOW_GRAPH_SCHEMA_VERSION,
  SUPPORTED_FLOW_GRAPH_SCHEMA_VERSIONS,
} from "./schemaVersion.js";

export const PortKindSchema = z.enum([
  "control",
  "data",
  "event",
  "stream",
  "error",
]);

export const PortDirectionSchema = z.enum(["input", "output"]);

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const SizeSchema = z.object({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "id must match ^[a-zA-Z][a-zA-Z0-9_]*$");

export const PortDefinitionSchema = z.object({
  id: SafeIdSchema,
  direction: PortDirectionSchema,
  kind: PortKindSchema,
  label: z.string().optional(),
  schema: z.unknown().optional(),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
  dynamic: z.boolean().optional(),
});

export const NodeInstanceSchema = z.object({
  id: SafeIdSchema,
  type: z.string().min(1),
  typeVersion: z.string().min(1),
  label: z.string().optional(),
  position: PositionSchema,
  size: SizeSchema.optional(),
  ports: z.array(PortDefinitionSchema),
  config: z.record(z.unknown()).default({}),
  ui: z.record(z.unknown()).optional(),
});

export const PortRefSchema = z.object({
  nodeId: SafeIdSchema,
  portId: SafeIdSchema,
});

export const EdgeDefinitionSchema = z.object({
  id: SafeIdSchema,
  from: PortRefSchema,
  to: PortRefSchema,
  condition: z.string().optional(),
  ui: z.record(z.unknown()).optional(),
});

export const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

const FlowConfigurableVariableValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const FlowConfigurableVariableOptionSchema = z.object({
  label: z.string().min(1).max(80),
  value: FlowConfigurableVariableValueSchema,
});

export const FlowConfigurableVariableSchema = z
  .object({
    name: z.string().regex(
      /^[A-Z_][A-Z0-9_]*$/,
      "configurable variable name must be an uppercase environment variable",
    ),
    label: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    type: z.enum(["string", "number", "boolean", "select"]),
    defaultValue: FlowConfigurableVariableValueSchema.optional(),
    placeholder: z.string().max(160).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
    options: z.array(FlowConfigurableVariableOptionSchema).min(1).max(64).optional(),
  })
  .superRefine((field, context) => {
    if (field.type === "select" && !field.options?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "select configurable variables require options",
        path: ["options"],
      });
    }
    if (field.type === "number" && field.defaultValue !== undefined
      && typeof field.defaultValue !== "number") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "number configurable variable default must be numeric",
        path: ["defaultValue"],
      });
    }
    if (field.type === "boolean" && field.defaultValue !== undefined
      && typeof field.defaultValue !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "boolean configurable variable default must be boolean",
        path: ["defaultValue"],
      });
    }
    if (field.type === "string" && field.defaultValue !== undefined
      && typeof field.defaultValue !== "string") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "string configurable variable default must be text",
        path: ["defaultValue"],
      });
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "configurable variable min cannot exceed max",
        path: ["min"],
      });
    }
  });

const FlowGraphSchemaVersionSchema = z
  .literal(FLOW_GRAPH_SCHEMA_VERSION)
  .or(z.enum(SUPPORTED_FLOW_GRAPH_SCHEMA_VERSIONS as unknown as [string, ...string[]]));

export const FlowGraphSchema = z
  .object({
    id: SafeIdSchema,
    version: z.string().min(1),
    schemaVersion: FlowGraphSchemaVersionSchema,
    label: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.unknown().optional(),
    outputSchema: z.unknown().optional(),
    configurableVariables: z.array(FlowConfigurableVariableSchema).max(64).optional(),
    nodes: z.array(NodeInstanceSchema),
    edges: z.array(EdgeDefinitionSchema),
    viewport: ViewportSchema.optional(),
  })
  .strict();

export const NodeTypeDefinitionSchema = z.object({
  type: z.string().min(1),
  typeVersion: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  defaultPorts: z.array(PortDefinitionSchema),
  configSchema: z.unknown().optional(),
  runtime: z.enum(["builtin", "plugin", "sandbox"]),
});
