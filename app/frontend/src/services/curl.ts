import type { ApiRequest, HeaderRow, HttpMethod } from "../types/api";

const httpMethods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function parseCurl(input: string): ApiRequest {
  const tokens = tokenize(stripLineContinuations(input));
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Command must start with 'curl'.");
  }

  let method: HttpMethod | "" = "";
  let url = "";
  const headers: HeaderRow[] = [];
  const dataParts: string[] = [];
  const auth: Record<string, string> = {};

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = () => tokens[(i += 1)];

    if (token === "-X" || token === "--request") {
      const value = next()?.toUpperCase();
      if (value && httpMethods.includes(value as HttpMethod)) method = value as HttpMethod;
    } else if (token === "-H" || token === "--header") {
      const raw = next() ?? "";
      const separator = raw.indexOf(":");
      if (separator > 0) {
        headers.push({ key: raw.slice(0, separator).trim(), value: raw.slice(separator + 1).trim(), enabled: true });
      }
    } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary" || token === "--data-ascii" || token === "--data-urlencode") {
      dataParts.push(next() ?? "");
    } else if (token === "-u" || token === "--user") {
      const raw = next() ?? "";
      const separator = raw.indexOf(":");
      auth.type = "basic";
      auth.username = separator >= 0 ? raw.slice(0, separator) : raw;
      auth.password = separator >= 0 ? raw.slice(separator + 1) : "";
    } else if (token === "--url") {
      url = next() ?? "";
    } else if (token === "-A" || token === "--user-agent") {
      headers.push({ key: "User-Agent", value: next() ?? "", enabled: true });
    } else if (token === "-e" || token === "--referer") {
      headers.push({ key: "Referer", value: next() ?? "", enabled: true });
    } else if (token === "-b" || token === "--cookie") {
      headers.push({ key: "Cookie", value: next() ?? "", enabled: true });
    } else if (token === "--compressed" || token === "-k" || token === "--insecure" || token === "-L" || token === "--location" || token === "-s" || token === "--silent" || token === "-i" || token === "--include" || token === "-v" || token === "--verbose" || token === "-g" || token === "--globoff") {
      // No request-shaping flags; safe to ignore.
    } else if (token.startsWith("-")) {
      // Unknown flag — consume a following value if it is not itself a flag or URL.
      const lookahead = tokens[i + 1];
      if (lookahead && !lookahead.startsWith("-") && !looksLikeUrl(lookahead)) i += 1;
    } else if (!url) {
      url = token;
    }
  }

  const body = dataParts.join("&");
  if (!method) method = body ? "POST" : "GET";

  const bearer = headers.find((header) => header.key.toLowerCase() === "authorization" && header.value.toLowerCase().startsWith("bearer "));
  if (bearer) {
    auth.type = "bearer";
    auth.token = bearer.value.slice(7).trim();
  }

  const bodyType = body ? (isJson(body) ? "json" : headers.some((h) => h.key.toLowerCase() === "content-type" && h.value.includes("urlencoded")) ? "form" : "text") : "json";

  return {
    id: "draft",
    name: requestName(url),
    method,
    url,
    queryParams: [],
    headers: headers.length > 0 ? headers : [{ key: "Accept", value: "application/json", enabled: true }],
    bodyType,
    body,
    auth,
    tests: "",
    environment: {},
    timeoutMs: 30000,
  };
}

function stripLineContinuations(input: string): string {
  return input.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, " ");
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && i + 1 < input.length) {
        current += input[(i += 1)];
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\" && i + 1 < input.length) {
      current += input[(i += 1)];
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.includes("://");
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function requestName(url: string): string {
  if (!url) return "Imported request";
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length > 0 ? `${segments[segments.length - 1]} (${parsed.hostname})` : parsed.hostname;
  } catch {
    return url.slice(0, 48);
  }
}
