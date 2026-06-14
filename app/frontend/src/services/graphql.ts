// Minimal GraphQL introspection: fetch the schema, then drive the explorer/docs and generate
// operation skeletons. Kept dependency-free (no graphql-js) to stay light.

export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
      inputFields { name type { ...TypeRef } }
      enumValues(includeDeprecated: true) { name }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
}`;

export type TypeRef = { kind: string; name: string | null; ofType?: TypeRef | null };
export type GqlArg = { name: string; type: TypeRef };
export type GqlField = { name: string; description?: string | null; args?: GqlArg[]; type: TypeRef };
export type GqlType = {
  kind: string;
  name: string;
  description?: string | null;
  fields?: GqlField[] | null;
  inputFields?: { name: string; type: TypeRef }[] | null;
  enumValues?: { name: string }[] | null;
};

export type GqlSchema = {
  queryType?: string;
  mutationType?: string;
  subscriptionType?: string;
  types: GqlType[];
  typeMap: Map<string, GqlType>;
};

// Render a TypeRef the way it appears in SDL, e.g. "[User!]!".
export function typeName(ref: TypeRef | null | undefined): string {
  if (!ref) return "";
  if (ref.kind === "NON_NULL") return `${typeName(ref.ofType)}!`;
  if (ref.kind === "LIST") return `[${typeName(ref.ofType)}]`;
  return ref.name ?? "";
}

// Unwrap NON_NULL/LIST down to the named type.
export function namedType(ref: TypeRef | null | undefined): string {
  if (!ref) return "";
  return ref.ofType ? namedType(ref.ofType) : ref.name ?? "";
}

export function parseSchema(introspectionJson: string): GqlSchema {
  const data = JSON.parse(introspectionJson);
  const schema = data?.data?.__schema ?? data?.__schema;
  if (!schema) throw new Error("Response did not contain a GraphQL schema (is this a GraphQL endpoint?).");
  const types: GqlType[] = schema.types ?? [];
  const typeMap = new Map<string, GqlType>();
  for (const type of types) typeMap.set(type.name, type);
  return {
    queryType: schema.queryType?.name,
    mutationType: schema.mutationType?.name,
    subscriptionType: schema.subscriptionType?.name,
    types,
    typeMap,
  };
}

export function rootFields(schema: GqlSchema, root: "query" | "mutation" | "subscription"): GqlField[] {
  const name = root === "query" ? schema.queryType : root === "mutation" ? schema.mutationType : schema.subscriptionType;
  if (!name) return [];
  return schema.typeMap.get(name)?.fields ?? [];
}

// Object types (excluding introspection internals) for the documentation panel.
export function documentedTypes(schema: GqlSchema): GqlType[] {
  return schema.types
    .filter((type) => !type.name.startsWith("__") && (type.kind === "OBJECT" || type.kind === "INPUT_OBJECT" || type.kind === "ENUM"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Build an operation skeleton for a root field, expanding one level of selections.
export function buildOperation(schema: GqlSchema, field: GqlField, root: "query" | "mutation" | "subscription"): string {
  const keyword = root === "subscription" ? "subscription" : root;
  const args = (field.args ?? []).filter((a) => a.type.kind === "NON_NULL");
  const argList = args.length ? `(${args.map((a) => `${a.name}: ${placeholder(a.type)}`).join(", ")})` : "";
  const selection = selectionSet(schema, field.type, 1);
  return `${keyword} {\n  ${field.name}${argList}${selection}\n}\n`;
}

function selectionSet(schema: GqlSchema, ref: TypeRef, depth: number): string {
  const type = schema.typeMap.get(namedType(ref));
  if (!type || !type.fields || depth > 1) return ""; // scalar/enum or too deep → no sub-selection
  const indent = "  ".repeat(depth + 1);
  const fields = type.fields
    .filter((f) => {
      const inner = schema.typeMap.get(namedType(f.type));
      return !inner?.fields; // only scalar leaf fields, to keep the skeleton flat
    })
    .slice(0, 12)
    .map((f) => `${indent}${f.name}`);
  if (fields.length === 0) return ` {\n${indent}__typename\n${"  ".repeat(depth)}}`;
  return ` {\n${fields.join("\n")}\n${"  ".repeat(depth)}}`;
}

function placeholder(ref: TypeRef): string {
  const name = namedType(ref);
  if (name === "Int" || name === "Float") return "0";
  if (name === "Boolean") return "false";
  if (name === "ID" || name === "String") return '""';
  return "null";
}
