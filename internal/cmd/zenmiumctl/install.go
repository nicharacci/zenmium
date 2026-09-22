package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// install-host writes the native-messaging host manifest into the per-user
// Chromium NativeMessagingHosts directory. Chromium itself verifies the
// manifest (name regex, absolute path, stdio type, allowed_origins) and the
// host binary before spawning — the Electron realpath/mode/signature checks
// are the platform's job here.
//
// macOS: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts
//   (Helium scans Chrome's native-messaging dirs already —
//   scan-chrome-native-messaging-hosts.patch — so the stock path is correct)
// Windows: registered under HKCU\Software\Chromium\NativeMessagingHosts
//   via the installer; this command prints the manifest for the .reg/ini.

const hostManifestName = "io.zenmium.control"
const extensionID = "koaiegnjnlbfgibjpjdcbnjejnihgfoa"

func installHost(args []string) {
	fs := flag.NewFlagSet("install-host", flag.ExitOnError)
	hostName := fs.String("host-name", hostManifestName, "native messaging host name")
	hostBin := fs.String("host-bin", "", "absolute path to zenmium-control-host")
	_ = fs.Parse(args)
	if *hostBin == "" {
		if exe, err := os.Executable(); err == nil {
			dir := filepath.Dir(exe)
			if runtime.GOOS == "windows" {
				*hostBin = dir + `\zenmium-control-host.exe`
			} else {
				*hostBin = dir + "/zenmium-control-host"
			}
		}
	}
	manifest := map[string]any{
		"name":            *hostName,
		"description":     "Zenmium internal control channel",
		"path":            *hostBin,
		"type":            "stdio",
		"allowed_origins": []string{"chrome-extension://" + extensionID + "/"},
	}
	b, _ := json.MarshalIndent(manifest, "", "  ")

	var dir string
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, "Library", "Application Support", "Chromium", "NativeMessagingHosts")
	case "windows":
		fmt.Println(string(b))
		fmt.Fprintln(os.Stderr, "Windows: register this manifest under HKCU\\Software\\Chromium\\NativeMessagingHosts\\"+*hostName)
		return
	default:
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config", "chromium", "NativeMessagingHosts")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir: %v\n", err)
		os.Exit(1)
	}
	p := filepath.Join(dir, *hostName+".json")
	if err := os.WriteFile(p, b, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write %s: %v\n", p, err)
		os.Exit(1)
	}
	fmt.Printf("wrote %s\n", p)
}
