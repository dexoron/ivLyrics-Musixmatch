#!/usr/bin/env bash
set -euo pipefail

OS_NAME="$(uname -s)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${1:-}"

if [[ -z "$APP_DIR" ]]; then
    APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

unregister_macos() {
    local app_path="${APP_DIR}/updater/macos/ivLyrics Updater.app"
    local legacy_updater_root="${HOME}/Library/Application Support/ivLyrics/Updater"
    local legacy_app_path="${legacy_updater_root}/ivLyrics Updater.app"

    if [[ -d "$app_path" && -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]]; then
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -u "$app_path" >/dev/null 2>&1 || true
    fi

    if [[ -d "$legacy_app_path" && -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]]; then
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -u "$legacy_app_path" >/dev/null 2>&1 || true
    fi

    rm -rf "$app_path" "$legacy_updater_root"
    echo "Unregistered ivlyrics-updater:// protocol for macOS."
}

unregister_linux() {
    local data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
    local updater_root="${data_home}/ivLyrics/updater"
    local desktop_file="${data_home}/applications/ivlyrics-updater.desktop"

    if command -v xdg-mime >/dev/null 2>&1; then
        local current
        current="$(xdg-mime query default x-scheme-handler/ivlyrics-updater 2>/dev/null || true)"
        if [[ "$current" == "ivlyrics-updater.desktop" ]]; then
            xdg-mime default "" x-scheme-handler/ivlyrics-updater >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$desktop_file"
    rm -rf "$updater_root"

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "${data_home}/applications" >/dev/null 2>&1 || true
    fi

    echo "Unregistered ivlyrics-updater:// protocol for Linux."
}

case "$OS_NAME" in
    Darwin) unregister_macos ;;
    Linux) unregister_linux ;;
    *) echo "Unsupported OS for updater protocol: $OS_NAME" >&2; exit 1 ;;
esac
