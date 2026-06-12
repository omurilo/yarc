package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/flash/yarc/app/backend/api"
	"github.com/flash/yarc/app/backend/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Store the database under ~/.yarc so it survives application rebuilds.
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal(err)
	}
	dbPath := filepath.Join(home, ".yarc", "yarc.db")

	db, err := storage.Open(dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	appService := api.NewAppService(db)

	app := application.New(application.Options{
		Name:        "Yarc",
		Description: "A fast, local-first API client for REST, GraphQL, WebSocket, and gRPC.",
		Services: []application.Service{
			application.NewService(appService),
		},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Yarc",
		Width:     1440,
		Height:    960,
		MinWidth:  1040,
		MinHeight: 720,
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
