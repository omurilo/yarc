package collections

type NodeKind string

const (
	WorkspaceKind NodeKind = "workspace"
	FolderKind    NodeKind = "folder"
	RequestKind   NodeKind = "request"
)
