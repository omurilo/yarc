import type { ApiRequest } from "../types/api";

const MULTIPART_BOUNDARY = "----YarcFormBoundary7MA4YWxkTrZu0gW";

// Serializes structured form fields into a wire body + matching Content-Type.
// Returns null for non-form body types. File fields carry their text content in `value`
// (binary files are not supported in this build).
export function serializeFormBody(request: ApiRequest): { body: string; contentType: string } | null {
  const fields = (request.formFields ?? []).filter((field) => field.enabled && field.key);

  if (request.bodyType === "form") {
    const body = fields.map((field) => `${encodeURIComponent(field.key)}=${encodeURIComponent(field.value)}`).join("&");
    return { body, contentType: "application/x-www-form-urlencoded" };
  }

  if (request.bodyType === "multipart") {
    const parts = fields.map((field) => {
      const disposition =
        field.type === "file"
          ? `Content-Disposition: form-data; name="${field.key}"; filename="${field.fileName ?? "file"}"\r\nContent-Type: ${field.contentType || "application/octet-stream"}`
          : `Content-Disposition: form-data; name="${field.key}"`;
      return `--${MULTIPART_BOUNDARY}\r\n${disposition}\r\n\r\n${field.value}`;
    });
    const body = parts.length > 0 ? `${parts.join("\r\n")}\r\n--${MULTIPART_BOUNDARY}--\r\n` : `--${MULTIPART_BOUNDARY}--\r\n`;
    return { body, contentType: `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` };
  }

  return null;
}

// Returns a copy of `headers` with `name` set to `value` (replacing any existing, case-insensitive).
export function upsertHeader(headers: ApiRequest["headers"], name: string, value: string): ApiRequest["headers"] {
  const lower = name.toLowerCase();
  const existing = headers.find((header) => header.key.toLowerCase() === lower);
  if (existing) {
    return headers.map((header) => (header.key.toLowerCase() === lower ? { ...header, value, enabled: true } : header));
  }
  return [...headers, { key: name, value, enabled: true }];
}
