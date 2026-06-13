import type { ApiRequest } from "../types/api";

// A Postman-compatible scripting engine that runs pre-request and test scripts with a minimal
// `pm.*` API. Scripts execute synchronously in the renderer (this is a local desktop app, so
// `new Function` is acceptable). The env bridge lets scripts read/mutate environment variables,
// which is how request chaining works (e.g. extract a token in request A's test, use it in B).

export type TestResult = { name: string; passed: boolean; error?: string };
export type ScriptOutcome = { logs: string[]; tests: TestResult[]; error?: string };

export type EnvVars = Record<string, { text: string; type: string; fileName?: string }>;

export type ResponseLike = {
  code: number;
  status: string;
  responseTime: number;
  body: string;
  headers: Record<string, string>;
};

// ---------------------------------------------------------------------------- assertions

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// A compact chai-like BDD assertion. Language chains (to, be, have…) are no-op getters; terminal
// checks throw on failure so they surface inside pm.test().
class Assertion {
  constructor(private actual: unknown, private negate = false) {}

  private check(pass: boolean, message: string) {
    const ok = this.negate ? !pass : pass;
    if (!ok) throw new Error(`${message}${this.negate ? " (negated)" : ""}`);
  }

  // Language chains.
  get to() { return this; }
  get be() { return this; }
  get been() { return this; }
  get is() { return this; }
  get that() { return this; }
  get which() { return this; }
  get and() { return this; }
  get has() { return this; }
  get have() { return this; }
  get with() { return this; }
  get at() { return this; }
  get not() { return new Assertion(this.actual, !this.negate); }

  // Terminal getters.
  get ok() { this.check(Boolean(this.actual), `expected ${show(this.actual)} to be truthy`); return this; }
  get true() { this.check(this.actual === true, `expected ${show(this.actual)} to be true`); return this; }
  get false() { this.check(this.actual === false, `expected ${show(this.actual)} to be false`); return this; }
  get null() { this.check(this.actual === null, `expected ${show(this.actual)} to be null`); return this; }
  get undefined() { this.check(this.actual === undefined, `expected ${show(this.actual)} to be undefined`); return this; }
  get empty() {
    const v = this.actual as { length?: number };
    const len = typeof v === "string" || Array.isArray(v) ? v.length : Object.keys(v ?? {}).length;
    this.check(len === 0, `expected ${show(this.actual)} to be empty`);
    return this;
  }

  // Methods.
  equal(expected: unknown) { this.check(this.actual === expected, `expected ${show(this.actual)} to equal ${show(expected)}`); return this; }
  eql(expected: unknown) { this.check(deepEqual(this.actual, expected), `expected ${show(this.actual)} to deeply equal ${show(expected)}`); return this; }
  eqls(expected: unknown) { return this.eql(expected); }
  above(n: number) { this.check((this.actual as number) > n, `expected ${show(this.actual)} to be above ${n}`); return this; }
  least(n: number) { this.check((this.actual as number) >= n, `expected ${show(this.actual)} to be at least ${n}`); return this; }
  below(n: number) { this.check((this.actual as number) < n, `expected ${show(this.actual)} to be below ${n}`); return this; }
  most(n: number) { this.check((this.actual as number) <= n, `expected ${show(this.actual)} to be at most ${n}`); return this; }
  oneOf(list: unknown[]) { this.check(list.includes(this.actual), `expected ${show(this.actual)} to be one of ${show(list)}`); return this; }
  match(re: RegExp) { this.check(re.test(String(this.actual)), `expected ${show(this.actual)} to match ${re}`); return this; }

  // Type checks: `expect(x).to.be.a("string")` / `.an("array")`.
  a(type: string) {
    const actualType = Array.isArray(this.actual) ? "array" : this.actual === null ? "null" : typeof this.actual;
    this.check(actualType === type, `expected ${show(this.actual)} to be a ${type} but got ${actualType}`);
    return this;
  }
  an(type: string) { return this.a(type); }

  include(needle: unknown) {
    const a = this.actual;
    let pass = false;
    if (typeof a === "string") pass = a.includes(String(needle));
    else if (Array.isArray(a)) pass = a.some((item) => deepEqual(item, needle));
    else if (a && typeof a === "object" && needle && typeof needle === "object") {
      pass = Object.entries(needle).every(([k, v]) => deepEqual((a as Record<string, unknown>)[k], v));
    }
    this.check(pass, `expected ${show(a)} to include ${show(needle)}`);
    return this;
  }
  includes(needle: unknown) { return this.include(needle); }

  property(name: string, value?: unknown) {
    const obj = this.actual as Record<string, unknown>;
    const present = obj != null && Object.prototype.hasOwnProperty.call(obj, name);
    this.check(present, `expected ${show(this.actual)} to have property ${show(name)}`);
    if (present && arguments.length > 1) this.check(deepEqual(obj[name], value), `expected property ${show(name)} to equal ${show(value)}`);
    return this;
  }

  lengthOf(n: number) { this.check((this.actual as { length: number })?.length === n, `expected length ${show((this.actual as { length?: number })?.length)} to be ${n}`); return this; }
  length(n: number) { return this.lengthOf(n); }

  // Response helpers: `pm.response.to.have.status(200)`.
  status(code: number) {
    const actual = (this.actual as ResponseLike)?.code;
    this.check(actual === code, `expected response status ${actual} to be ${code}`);
    return this;
  }
}

function makeExpect() {
  return (actual: unknown) => new Assertion(actual);
}

// ---------------------------------------------------------------------------- pm sandbox

// Variable scopes (precedence high→low): environment > folder/collection chain > globals.
// env and globals are writable from scripts and persisted; folder is read-only here.
export type EnvBridge = {
  env: EnvVars;
  globals: EnvVars;
  folder: EnvVars;
  envChanged: boolean;
  globalsChanged: boolean;
};

// The effective, merged variable map used to resolve the outgoing request.
export function mergedVars(bridge: EnvBridge): EnvVars {
  return { ...bridge.globals, ...bridge.folder, ...bridge.env };
}

function scopeApi(vars: EnvVars, markChanged: () => void, fallback?: (key: string) => string | undefined) {
  return {
    get: (key: string) => (key in vars ? vars[key]?.text : fallback?.(key)),
    set: (key: string, value: unknown) => {
      vars[key] = { text: String(value), type: "text" };
      markChanged();
    },
    unset: (key: string) => {
      delete vars[key];
      markChanged();
    },
    has: (key: string) => key in vars,
  };
}

// Builds the shared `pm` scope API (environment/globals/collectionVariables/variables).
function pmScopes(bridge: EnvBridge) {
  const mergedGet = (key: string) => {
    if (key in bridge.env) return bridge.env[key]?.text;
    if (key in bridge.folder) return bridge.folder[key]?.text;
    return bridge.globals[key]?.text;
  };
  return {
    environment: scopeApi(bridge.env, () => (bridge.envChanged = true)),
    globals: scopeApi(bridge.globals, () => (bridge.globalsChanged = true)),
    collectionVariables: { get: (key: string) => bridge.folder[key]?.text },
    variables: { get: mergedGet },
  };
}

function run(script: string, build: (ctx: { tests: TestResult[]; logs: string[] }) => Record<string, unknown>): ScriptOutcome {
  const tests: TestResult[] = [];
  const logs: string[] = [];
  if (!script.trim()) return { logs, tests };

  const consoleProxy = {
    log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : show(a))).join(" ")),
  };
  (consoleProxy as Record<string, unknown>).info = consoleProxy.log;
  (consoleProxy as Record<string, unknown>).warn = consoleProxy.log;
  (consoleProxy as Record<string, unknown>).error = consoleProxy.log;

  const pm = build({ tests, logs });
  try {
    // eslint-disable-next-line no-new-func
    new Function("pm", "console", `"use strict";\n${script}`)(pm, consoleProxy);
  } catch (error) {
    return { logs, tests, error: error instanceof Error ? error.message : String(error) };
  }
  return { logs, tests };
}

function pmTest(tests: TestResult[]) {
  return (name: string, fn: () => void) => {
    try {
      fn();
      tests.push({ name, passed: true });
    } catch (error) {
      tests.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function runPreRequest(script: string, request: ApiRequest, bridge: EnvBridge): ScriptOutcome {
  return run(script, ({ tests }) => ({
    ...pmScopes(bridge),
    expect: makeExpect(),
    test: pmTest(tests),
    request: { url: request.url, method: request.method, headers: { get: (n: string) => request.headers.find((h) => h.key.toLowerCase() === n.toLowerCase())?.value } },
    info: { requestName: request.name },
  }));
}

export function runTests(script: string, request: ApiRequest, response: ResponseLike, bridge: EnvBridge): ScriptOutcome {
  return run(script, ({ tests }) => {
    const headerGet = (name: string) => {
      const key = Object.keys(response.headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? response.headers[key] : undefined;
    };
    const pmResponse = {
      code: response.code,
      status: response.status,
      responseTime: response.responseTime,
      headers: { get: headerGet },
      json: () => JSON.parse(response.body),
      text: () => response.body,
      to: new Assertion(response),
    };
    return {
      ...pmScopes(bridge),
      expect: makeExpect(),
      test: pmTest(tests),
      response: pmResponse,
      request: { url: request.url, method: request.method },
    };
  });
}
