package plugins

type Manifest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Entrypoints []string `json:"entrypoints"`
}
