package api

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/minio/selfupdate"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Version is the current app version. Keep in sync with build/config.yml.
const Version = "1.0.1"

// githubRepo is the "owner/repo" whose GitHub Releases drive the updater.
const githubRepo = "omurilo/yarc"

type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	URL             string `json:"url"`
	Notes           string `json:"notes"`
	Error           string `json:"error"`
}

type ghAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	HTMLURL string    `json:"html_url"`
	Body    string    `json:"body"`
	Draft   bool      `json:"draft"`
	Assets  []ghAsset `json:"assets"`
}

func latestRelease(ctx context.Context) (*ghRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+githubRepo+"/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("no published release found")
	}
	var release ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

// CheckForUpdate compares the latest GitHub release to the running version.
func (s *AppService) CheckForUpdate() UpdateInfo {
	info := UpdateInfo{CurrentVersion: Version}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	release, err := latestRelease(ctx)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	info.LatestVersion = strings.TrimPrefix(release.TagName, "v")
	info.URL = release.HTMLURL
	info.Notes = release.Body
	info.UpdateAvailable = !release.Draft && compareVersions(info.LatestVersion, Version) > 0
	return info
}

// AppInfoData is the static "about" payload shown in Settings.
type AppInfoData struct {
	Version   string `json:"version"`
	Repo      string `json:"repo"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	GoVersion string `json:"goVersion"`
}

// AppInfo returns version/build/runtime details for the Settings → About screen.
func (s *AppService) AppInfo() AppInfoData {
	return AppInfoData{
		Version:   Version,
		Repo:      githubRepo,
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
		GoVersion: runtime.Version(),
	}
}

// OpenReleasePage opens a URL in the user's default browser.
func (s *AppService) OpenReleasePage(url string) {
	if app := application.Get(); app != nil && url != "" {
		_ = app.Browser.OpenURL(url)
	}
}

// PerformUpdate downloads the build matching this OS/arch, replaces the running binary in place,
// and relaunches the app. Returns an error string (empty on success, just before relaunch).
func (s *AppService) PerformUpdate() string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	release, err := latestRelease(ctx)
	if err != nil {
		return err.Error()
	}
	if compareVersions(strings.TrimPrefix(release.TagName, "v"), Version) <= 0 {
		return "already up to date"
	}

	asset := pickAsset(release.Assets)
	if asset.URL == "" {
		return fmt.Sprintf("no auto-updatable build published for %s/%s — use \"Open release\" to download manually", runtime.GOOS, runtime.GOARCH)
	}

	payload, err := downloadAsset(ctx, asset)
	if err != nil {
		return "download failed: " + err.Error()
	}
	binary, err := extractBinary(asset.Name, payload)
	if err != nil {
		return "extract failed: " + err.Error()
	}

	if err := selfupdate.Apply(bytes.NewReader(binary), selfupdate.Options{}); err != nil {
		if rollErr := selfupdate.RollbackError(err); rollErr != nil {
			return "update failed and rollback also failed: " + rollErr.Error()
		}
		return "update failed: " + err.Error()
	}

	// Relaunch on a short delay so this binding call can return first, then quit.
	go func() {
		time.Sleep(500 * time.Millisecond)
		_ = relaunch()
		if app := application.Get(); app != nil {
			app.Quit()
		}
	}()
	return ""
}

// pickAsset selects the release asset for the current platform. Naming convention (set by the
// release workflow): Yarc_darwin_universal.tar.gz, Yarc_windows_amd64.zip, Yarc_linux_amd64.tar.gz.
func pickAsset(assets []ghAsset) ghAsset {
	wantOS := runtime.GOOS
	for _, asset := range assets {
		name := strings.ToLower(asset.Name)
		if !strings.Contains(name, wantOS) {
			continue
		}
		switch wantOS {
		case "windows":
			if strings.HasSuffix(name, ".zip") {
				return asset
			}
		default:
			if strings.HasSuffix(name, ".tar.gz") {
				return asset
			}
		}
	}
	return ghAsset{}
}

// downloadAsset fetches a release asset's bytes from its public download URL.
func downloadAsset(ctx context.Context, asset ghAsset) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %s", resp.Status)
	}
	return io.ReadAll(resp.Body)
}

// extractBinary pulls the app executable out of a .tar.gz or .zip release archive.
func extractBinary(name string, payload []byte) ([]byte, error) {
	if strings.HasSuffix(strings.ToLower(name), ".zip") {
		reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
		if err != nil {
			return nil, err
		}
		for _, file := range reader.File {
			base := strings.ToLower(filepath.Base(file.Name))
			if file.FileInfo().IsDir() {
				continue
			}
			if strings.HasSuffix(base, ".exe") || base == "yarc" {
				rc, err := file.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
		return nil, fmt.Errorf("no executable found in zip")
	}

	// .tar.gz
	gz, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		base := filepath.Base(header.Name)
		if base == "Yarc" || base == "yarc" || header.FileInfo().Mode()&0o111 != 0 {
			return io.ReadAll(tr)
		}
	}
	return nil, fmt.Errorf("no executable found in archive")
}

// relaunch starts a fresh instance of the app after the binary has been replaced. On macOS it
// re-signs the (modified) .app bundle ad-hoc and opens it; elsewhere it re-execs the binary.
func relaunch() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if runtime.GOOS == "darwin" {
		if app := appBundle(exe); app != "" {
			_ = exec.Command("codesign", "--force", "--deep", "--sign", "-", app).Run()
			return exec.Command("open", app).Start()
		}
	}
	cmd := exec.Command(exe)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}

// appBundle returns the .app path for an executable inside a macOS bundle, or "" otherwise.
func appBundle(exe string) string {
	idx := strings.Index(exe, ".app/")
	if idx < 0 {
		return ""
	}
	return exe[:idx+len(".app")]
}

// compareVersions returns >0 when a is newer than b, comparing dotted numeric components.
func compareVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(a, "v"), ".")
	pb := strings.Split(strings.TrimPrefix(b, "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		na, nb := 0, 0
		if i < len(pa) {
			na, _ = strconv.Atoi(numericPrefix(pa[i]))
		}
		if i < len(pb) {
			nb, _ = strconv.Atoi(numericPrefix(pb[i]))
		}
		if na != nb {
			if na > nb {
				return 1
			}
			return -1
		}
	}
	return 0
}

func numericPrefix(s string) string {
	for i, r := range s {
		if r < '0' || r > '9' {
			return s[:i]
		}
	}
	return s
}
