export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => unknown | Promise<unknown>;
};

export type ModelContext = {
  registerTool: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => Promise<void>;
  getTools?: () => Promise<Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>>;
  executeTool?: (name: string, input?: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
};

export type HarnessId = 'legacy' | 'a' | 'b' | 'c';
export type WireRole = 'signal' | 'power' | 'ground';
