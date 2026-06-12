# Yarc

Yarc is a lightweight, offline-first desktop API client built with Go, Wails v3, React, TypeScript, Tailwind, Zustand, TanStack Query, Monaco Editor, React Flow, and SQLite.

The product direction is simple: a modern Postman alternative that starts fast, stays local by default, avoids account walls, and keeps REST, GraphQL, WebSocket, gRPC, history, collections, environments, snippets, and visual flows in one focused window.

## Project layout

```text
app/
├── backend/
│   ├── api/
│   ├── grpc/
│   ├── websocket/
│   ├── storage/
│   ├── collections/
│   └── environments/
├── frontend/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── store/
│   ├── services/
│   └── layouts/
└── database/
    └── sqlite
```

## Requirements

- Go 1.24+
- Wails v3
- Node.js 20+
- Yarn

## Development

```bash
cd app/frontend
yarn install
yarn dev
```

For the desktop shell, install Wails v3 and use the Wails development command from the `app` directory.

```bash
cd app
wails3 dev
```

The browser dev build includes a local fallback service so the interface can be explored without Wails bindings.

