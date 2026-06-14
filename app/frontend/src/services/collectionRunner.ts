import type { ApiRequest, CollectionNode } from "../types/api";
import { executeHttpRequest } from "./apiClient";
import { serializeFormBody, upsertHeader } from "./formBody";
import { mergedVars, runPreRequest, runTests, type EnvBridge, type EnvVars, type TestResult } from "./scripting";
import { folderVariables } from "./variableScopes";

export type RunResult = {
  id: string;
  name: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  tests: TestResult[];
  error?: string;
};

// Collects a folder's requests in depth-first tree order (folders before their requests' siblings).
export function collectFolderRequests(collections: CollectionNode[], folderId: string): CollectionNode[] {
  const out: CollectionNode[] = [];
  const childrenOf = (parentId: string) =>
    collections
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name)));
  const walk = (parentId: string) => {
    for (const node of childrenOf(parentId)) {
      if (node.kind === "request" && node.request) out.push(node);
      else if (node.kind === "folder") walk(node.id);
    }
  };
  walk(folderId);
  return out;
}

type RunContext = {
  env: EnvVars;
  globals: EnvVars;
  collections: CollectionNode[];
  onResult?: (result: RunResult) => void;
  signal?: AbortSignal;
};

// Runs requests sequentially, sharing one env/globals scope so pm.*.set() chains across requests
// (e.g. capture a token in one request's test, use it in the next). Returns the final scopes so the
// caller can persist them.
export async function runRequests(
  nodes: CollectionNode[],
  ctx: RunContext,
): Promise<{ results: RunResult[]; env: EnvVars; globals: EnvVars; envChanged: boolean; globalsChanged: boolean }> {
  const env: EnvVars = { ...ctx.env };
  const globals: EnvVars = { ...ctx.globals };
  let envChanged = false;
  let globalsChanged = false;
  const results: RunResult[] = [];

  for (const node of nodes) {
    if (ctx.signal?.aborted) break;
    const request = node.request as ApiRequest;
    const bridge: EnvBridge = { env, globals, folder: folderVariables(ctx.collections, request.id), envChanged: false, globalsChanged: false };

    let error = "";
    try {
      if (request.preRequestScript?.trim()) {
        const pre = runPreRequest(request.preRequestScript, request, bridge);
        if (pre.error) error = `pre-request: ${pre.error}`;
      }

      let outgoing: ApiRequest = { ...request, environment: mergedVars(bridge) };
      const form = serializeFormBody(request);
      if (form) outgoing = { ...outgoing, body: form.body, headers: upsertHeader(request.headers, "Content-Type", form.contentType) };

      const response = await executeHttpRequest(outgoing);

      let tests: TestResult[] = [];
      if (request.tests?.trim()) {
        const run = runTests(request.tests, request, { code: response.statusCode, status: response.status, responseTime: response.durationMs, body: response.body, headers: response.headers }, bridge);
        tests = run.tests;
        if (run.error) error = error || `test: ${run.error}`;
      }

      envChanged = envChanged || bridge.envChanged;
      globalsChanged = globalsChanged || bridge.globalsChanged;

      const result: RunResult = {
        id: node.id,
        name: node.name,
        method: request.method,
        url: response.resolvedUrl || request.url,
        status: response.statusCode,
        ok: response.statusCode >= 200 && response.statusCode < 400 && tests.every((t) => t.passed) && !response.error,
        durationMs: response.durationMs,
        tests,
        error: response.error || error || undefined,
      };
      results.push(result);
      ctx.onResult?.(result);
    } catch (cause) {
      const result: RunResult = {
        id: node.id,
        name: node.name,
        method: request.method,
        url: request.url,
        status: 0,
        ok: false,
        durationMs: 0,
        tests: [],
        error: cause instanceof Error ? cause.message : "Request failed",
      };
      results.push(result);
      ctx.onResult?.(result);
    }
  }

  return { results, env, globals, envChanged, globalsChanged };
}
