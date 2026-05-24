$ErrorActionPreference = "Stop"
$ProtocolRoot = "HKCU:\Software\Classes\ivlyrics-updater"

if (Test-Path -LiteralPath $ProtocolRoot) {
    Remove-Item -LiteralPath $ProtocolRoot -Recurse -Force
}

Write-Host "Unregistered ivlyrics-updater:// protocol."
