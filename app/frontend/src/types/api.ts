export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type HeaderRow = {
  key: string;
  value: string;
  enabled: boolean;
};

export type FormField = {
  key: string;
  value: string;
  type: "text" | "file";
  enabled: boolean;
  fileName?: string;
  contentType?: string;
};

export type ApiRequest = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  queryParams: HeaderRow[];
  headers: HeaderRow[];
  bodyType: "json" | "xml" | "text" | "form" | "multipart";
  body: string;
  formFields?: FormField[];
  auth: Record<string, string>;
  tests: string;
  environment: Record<string, { text: string; type: string; fileName?: string; }>;
  timeoutMs: number;
};

export type ApiResponse = {
  statusCode: number;
  status: string;
  headers: Record<string, string>;
  body: string;
  bodySize: number;
  durationMs: number;
  receivedAt: string;
  error?: string;
  resolvedUrl: string;
  sent?: SentRequestInfo;
};

export type SentRequestInfo = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type Environment = {
  id: string;
  name: string;
  variables: Record<string, { text: string; type: string; fileName?: string; }>;
  secrets: string[];
  active: boolean;
};

export type HistoryEntry = {
  id: string;
  request: ApiRequest;
  response: ApiResponse;
  createdAt: string;
};

export type CollectionNode = {
  id: string;
  parentId?: string;
  kind: "workspace" | "folder" | "request";
  name: string;
  method?: HttpMethod;
  url?: string;
  tags: string[];
  favorite: boolean;
  request?: ApiRequest;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceBootstrap = {
  collections: CollectionNode[];
  environments: Environment[];
  history: HistoryEntry[];
};

export type GrpcMethod = {
  service: string;
  method: string;
  fullMethod: string;
  requestType: string;
  responseType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
};

export type GrpcRequest = {
  target: string;
  fullMethod: string;
  requestJSON: string;
  metadata: Record<string, string>;
  protoFilename: string;
  protoSource: string;
  useReflection: boolean;
  plaintext: boolean;
  timeoutMs: number;
};

export type GrpcMethodList = {
  methods: GrpcMethod[];
  error: string;
};

export type GrpcInvokeResponse = {
  body: string;
  statusCode: number;
  status: string;
  trailers: Record<string, string>;
  durationMs: number;
  error: string;
};
