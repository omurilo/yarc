import type { ApiRequest } from "../types/api";
import { applyDynamicVars } from "./dynamicVars";

export const snippetLanguages = ["curl", "javascript", "typescript", "go", "python", "rust", "java", "kotlin", "csharp"] as const;
export type SnippetLanguage = (typeof snippetLanguages)[number];

export const snippetLabels: Record<SnippetLanguage, string> = {
  curl: "cURL",
  javascript: "JavaScript",
  typescript: "TypeScript",
  go: "Go",
  python: "Python",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
};

export type SnippetModel = {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
  hasBody: boolean;
};

const methodsWithBody = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The fully-resolved request (variables applied, query params + auth merged, content-type added),
// i.e. exactly what gets sent over the wire. Used by the request inspector.
export function resolveRequestPreview(request: ApiRequest): SnippetModel {
  return buildModel(request);
}

export function buildSnippet(language: string, request: ApiRequest): string {
  const model = buildModel(request);
  switch (normalize(language)) {
    case "curl":
      return curlSnippet(model);
    case "javascript":
    case "typescript":
      return fetchSnippet(model);
    case "go":
      return goSnippet(model);
    case "python":
      return pythonSnippet(model);
    case "rust":
      return rustSnippet(model);
    case "java":
      return javaSnippet(model);
    case "kotlin":
      return kotlinSnippet(model);
    case "csharp":
      return csharpSnippet(model);
    default:
      return curlSnippet(model);
  }
}

function normalize(language: string): SnippetLanguage | "" {
  const lower = language.toLowerCase().replace(/[#\s]/g, (match) => (match === "#" ? "sharp" : ""));
  if (lower === "c" || lower === "csharp" || lower === "cs") return "csharp";
  if (lower === "js") return "javascript";
  if (lower === "ts") return "typescript";
  return (snippetLanguages as readonly string[]).includes(lower) ? (lower as SnippetLanguage) : "";
}

function buildModel(request: ApiRequest): SnippetModel {
  const env = request.environment ?? {};
  let url = resolveVars(request.url, env);
  url = applyQuery(url, request.queryParams, env);
  url = applyQueryAuth(url, request.auth, env);

  const headers: SnippetModel["headers"] = [];
  const seen = new Set<string>();
  for (const header of request.headers) {
    if (header.enabled && header.key) {
      headers.push({ key: header.key, value: resolveVars(header.value, env) });
      seen.add(header.key.toLowerCase());
    }
  }

  const auth = request.auth ?? {};
  if (auth.type === "bearer" && auth.token) {
    headers.push({ key: auth.headerName || "Authorization", value: `Bearer ${resolveVars(auth.token, env)}` });
  } else if (auth.type === "basic") {
    const encoded = base64(`${resolveVars(auth.username ?? "", env)}:${resolveVars(auth.password ?? "", env)}`);
    headers.push({ key: "Authorization", value: `Basic ${encoded}` });
  } else if (auth.type === "apiKey" && auth.addTo !== "query" && auth.key) {
    headers.push({ key: resolveVars(auth.key, env), value: resolveVars(auth.value ?? "", env) });
  } else if (auth.type === "oauth2" && (auth.accessToken || auth.token)) {
    headers.push({ key: auth.headerName || "Authorization", value: `${auth.headerPrefix || "Bearer"} ${resolveVars(auth.accessToken || auth.token, env)}` });
  }

  const hasBody = Boolean(request.body) && methodsWithBody.has(request.method);
  const body = hasBody ? resolveVars(request.body, env) : "";
  if (hasBody && !seen.has("content-type")) {
    headers.push({ key: "Content-Type", value: contentType(request.bodyType) });
  }

  return { method: request.method, url, headers, body, hasBody };
}

function curlSnippet(model: SnippetModel): string {
  const lines = [`curl -X ${model.method} ${quote(model.url)}`];
  for (const header of model.headers) {
    lines.push(`  -H ${quote(`${header.key}: ${header.value}`)}`);
  }
  if (model.hasBody) {
    lines.push(`  -d ${quote(model.body)}`);
  }
  return lines.join(" \\\n");
}

function fetchSnippet(model: SnippetModel): string {
  const headerEntries = model.headers.map((header) => `    ${quote(header.key)}: ${quote(header.value)},`).join("\n");
  const parts = [`const response = await fetch(${quote(model.url)}, {`, `  method: ${quote(model.method)},`];
  if (model.headers.length > 0) {
    parts.push(`  headers: {\n${headerEntries}\n  },`);
  }
  if (model.hasBody) {
    parts.push(`  body: ${quote(model.body)},`);
  }
  parts.push("});", "const data = await response.json();", "console.log(data);");
  return parts.join("\n");
}

function goSnippet(model: SnippetModel): string {
  const body = model.hasBody ? `strings.NewReader(${quote(model.body)})` : "nil";
  const lines = [
    "package main",
    "",
    "import (",
    '\t"fmt"',
    '\t"io"',
    '\t"net/http"',
    ...(model.hasBody ? ['\t"strings"'] : []),
    ")",
    "",
    "func main() {",
    `\treq, _ := http.NewRequest(${quote(model.method)}, ${quote(model.url)}, ${body})`,
  ];
  for (const header of model.headers) {
    lines.push(`\treq.Header.Set(${quote(header.key)}, ${quote(header.value)})`);
  }
  lines.push(
    "\tres, err := http.DefaultClient.Do(req)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer res.Body.Close()",
    "\tbody, _ := io.ReadAll(res.Body)",
    "\tfmt.Println(string(body))",
    "}",
  );
  return lines.join("\n");
}

function pythonSnippet(model: SnippetModel): string {
  const headers = model.headers.map((header) => `    ${quote(header.key)}: ${quote(header.value)},`).join("\n");
  const lines = ["import requests", ""];
  if (model.headers.length > 0) {
    lines.push(`headers = {\n${headers}\n}`);
  }
  if (model.hasBody) {
    lines.push(`payload = ${quote(model.body)}`);
  }
  const args = [`${quote(model.method)}`, `${quote(model.url)}`];
  if (model.headers.length > 0) args.push("headers=headers");
  if (model.hasBody) args.push("data=payload");
  lines.push("", `response = requests.request(${args.join(", ")})`, "print(response.text)");
  return lines.join("\n");
}

function rustSnippet(model: SnippetModel): string {
  const lines = [
    "use reqwest::blocking::Client;",
    "",
    "fn main() -> Result<(), Box<dyn std::error::Error>> {",
    "    let client = Client::new();",
    `    let response = client`,
    `        .request(reqwest::Method::${model.method}, ${quote(model.url)})`,
  ];
  for (const header of model.headers) {
    lines.push(`        .header(${quote(header.key)}, ${quote(header.value)})`);
  }
  if (model.hasBody) {
    lines.push(`        .body(${quote(model.body)})`);
  }
  lines.push("        .send()?;", "    println!(\"{}\", response.text()?);", "    Ok(())", "}");
  return lines.join("\n");
}

function javaSnippet(model: SnippetModel): string {
  const bodyPublisher = model.hasBody ? `HttpRequest.BodyPublishers.ofString(${quote(model.body)})` : "HttpRequest.BodyPublishers.noBody()";
  const lines = [
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "",
    "HttpClient client = HttpClient.newHttpClient();",
    "HttpRequest request = HttpRequest.newBuilder()",
    `    .uri(URI.create(${quote(model.url)}))`,
    `    .method(${quote(model.method)}, ${bodyPublisher})`,
  ];
  for (const header of model.headers) {
    lines.push(`    .header(${quote(header.key)}, ${quote(header.value)})`);
  }
  lines.push(
    "    .build();",
    "HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());",
    "System.out.println(response.body());",
  );
  return lines.join("\n");
}

function kotlinSnippet(model: SnippetModel): string {
  const mediaType = model.hasBody ? `${quote(contentTypeFromHeaders(model))}.toMediaType()` : "";
  const lines = [
    "import okhttp3.OkHttpClient",
    "import okhttp3.Request",
    ...(model.hasBody ? ["import okhttp3.RequestBody.Companion.toRequestBody", "import okhttp3.MediaType.Companion.toMediaType"] : []),
    "",
    "val client = OkHttpClient()",
    ...(model.hasBody ? [`val body = ${quote(model.body)}.toRequestBody(${mediaType})`] : []),
    "val request = Request.Builder()",
    `    .url(${quote(model.url)})`,
    `    .method(${quote(model.method)}, ${model.hasBody ? "body" : "null"})`,
  ];
  for (const header of model.headers) {
    lines.push(`    .addHeader(${quote(header.key)}, ${quote(header.value)})`);
  }
  lines.push("    .build()", "val response = client.newCall(request).execute()", "println(response.body?.string())");
  return lines.join("\n");
}

function csharpSnippet(model: SnippetModel): string {
  const lines = [
    "using var client = new HttpClient();",
    `using var request = new HttpRequestMessage(new HttpMethod(${quote(model.method)}), ${quote(model.url)});`,
  ];
  for (const header of model.headers) {
    if (header.key.toLowerCase() === "content-type") continue;
    lines.push(`request.Headers.TryAddWithoutValidation(${quote(header.key)}, ${quote(header.value)});`);
  }
  if (model.hasBody) {
    lines.push(`request.Content = new StringContent(${quote(model.body)}, System.Text.Encoding.UTF8, ${quote(contentTypeFromHeaders(model))});`);
  }
  lines.push(
    "var response = await client.SendAsync(request);",
    "var body = await response.Content.ReadAsStringAsync();",
    "Console.WriteLine(body);",
  );
  return lines.join("\n");
}

function contentTypeFromHeaders(model: SnippetModel): string {
  const header = model.headers.find((item) => item.key.toLowerCase() === "content-type");
  return header?.value ?? "application/json";
}

function contentType(bodyType: ApiRequest["bodyType"]): string {
  switch (bodyType) {
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "form":
      return "application/x-www-form-urlencoded";
    case "multipart":
      return "multipart/form-data";
    default:
      return "text/plain";
  }
}

function resolveVars(value: string, variables: Record<string, {text: string; fileName?: string; type: string;}>): string {
  const withEnv = Object.entries(variables).reduce((next, [key, variable]) => next.replaceAll(`{{${key}}}`, variable.text), value);
  return applyDynamicVars(withEnv);
}

function applyQuery(url: string, params: ApiRequest["queryParams"], env: Record<string, {text: string; fileName?: string; type: string;}>): string {
  const enabled = params.filter((param) => param.enabled && param.key);
  if (enabled.length === 0) return url;
  const [base, rawQuery = ""] = url.split("?");
  const search = new URLSearchParams(rawQuery);
  enabled.forEach((param) => search.set(param.key, resolveVars(param.value, env)));
  return `${base}?${search.toString()}`;
}

function applyQueryAuth(url: string, auth: Record<string, string>, env: Record<string, {text: string; fileName?: string; type: string;}>): string {
  if (auth.type !== "apiKey" || auth.addTo !== "query" || !auth.key) return url;
  const [base, rawQuery = ""] = url.split("?");
  const search = new URLSearchParams(rawQuery);
  search.set(resolveVars(auth.key, env), resolveVars(auth.value ?? "", env));
  return `${base}?${search.toString()}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function base64(value: string): string {
  if (typeof btoa === "function") return btoa(value);
  return value;
}
