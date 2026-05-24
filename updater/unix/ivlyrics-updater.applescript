on open location theURL
    set updaterScript to POSIX path of (path to home folder) & ".config/spicetify/CustomApps/ivLyrics/updater/unix/ivlyrics-updater.sh"
    tell application "Terminal"
        activate
        do script "/bin/bash " & quoted form of updaterScript & " " & quoted form of theURL
    end tell
end open location

on run
    open location "ivlyrics-updater://update"
end run
