package environments

type Scope string

const (
	GlobalScope  Scope = "global"
	ProjectScope Scope = "project"
	SecretScope  Scope = "secret"
)
