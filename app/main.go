package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/omurilo/yarc/app/backend/api"
	"github.com/omurilo/yarc/app/backend/storage"
	// Blank import links the Windows icon/version resource (.syso) into the .exe; no-op elsewhere.
	_ "github.com/omurilo/yarc/app/build/winres"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

// Full-color application icon (about box, and the Linux window/taskbar icon). On macOS the dock
// icon comes from the .app bundle's icons.icns; on Windows the taskbar icon comes from the icon
// embedded in the .exe — see build/icons and build/darwin/Taskfile.yml.
//
//go:embed build/icons/appicon.png
var appIcon []byte

// Monochrome system-tray glyphs (no background). The template is auto-tinted by macOS to match
// the menu bar; light/dark variants are used by Windows/Linux depending on the system theme.
//
//go:embed build/icons/systray-template.png
var systrayTemplate []byte

//go:embed build/icons/systray-light.png
var systrayLight []byte

//go:embed build/icons/systray-dark.png
var systrayDark []byte

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
		Icon:        appIcon,
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
		Linux:     application.LinuxWindow{Icon: appIcon},
	})

	menu := app.NewMenu()
	menu.Add("Open").OnClick(func(ctx *application.Context) {
		app.Window.GetAll()[0].Focus()
	})

	menu.AddSeparator()

	menu.Add("Quit").OnClick(func(ctx *application.Context) {
		app.Quit()
	})

	systray := app.SystemTray.New()
	systray.SetIcon(systrayLight)
	systray.SetDarkModeIcon(systrayDark)
	systray.SetTemplateIcon(systrayTemplate)
	systray.SetMenu(menu)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
