// Package winres carries the Windows resource objects (rsrc_windows_*.syso) that embed the app
// icon and version info into the .exe. It has no code — main.go blank-imports it so `go build`
// links the .syso files for Windows targets (Go only links .syso found in a compiled package's
// directory, which is why they can't sit in an arbitrary folder).
//
// Regenerate after changing the icon (run from the app/ module root, then move the output here):
//
//	go run github.com/tc-hib/go-winres@latest simply --icon build/icons/appicon.png
//	mv rsrc_windows_*.syso build/winres/
package winres
