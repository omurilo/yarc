// A small jq-flavoured filter for the response viewer. Supports the common subset:
//   .            whole value
//   .a.b         field access
//   .a[0]        array index
//   .a[]         iterate array (or object values)
//   .["weird"]   quoted key access
//   a | b | c    pipe stages
// Anything outside this grammar throws, so the caller can surface a clear error.

const TOKEN = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\[\]|\.?\["([^"]+)"\]/g;

function applyStage(value: unknown, stage: string): unknown[] {
  const expr = stage.trim();
  if (expr === "" || expr === ".") return [value];

  let values: unknown[] = [value];
  TOKEN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN.exec(expr)) !== null) {
    if (match.index !== cursor) {
      throw new Error(`Unexpected "${expr.slice(cursor, match.index)}"`);
    }
    cursor = TOKEN.lastIndex;
    const [full, dotKey, index, quotedKey] = match;

    values = values.flatMap((current) => {
      if (full === "[]") {
        if (Array.isArray(current)) return current;
        if (current && typeof current === "object") return Object.values(current);
        return [undefined];
      }
      if (index !== undefined) {
        return [Array.isArray(current) ? current[Number(index)] : undefined];
      }
      const key = dotKey ?? quotedKey;
      return [current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined];
    });
  }

  if (cursor !== expr.length) {
    throw new Error(`Invalid filter near "${expr.slice(cursor)}"`);
  }
  return values;
}

export function applyJsonFilter(value: unknown, expression: string): unknown {
  const trimmed = expression.trim();
  if (trimmed === "" || trimmed === ".") return value;

  const stages = trimmed.split("|").map((stage) => stage.trim()).filter(Boolean);
  let stream: unknown[] = [value];
  for (const stage of stages) {
    stream = stream.flatMap((item) => applyStage(item, stage));
  }
  return stream.length === 1 ? stream[0] : stream;
}
