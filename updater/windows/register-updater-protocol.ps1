param(
    [string]$AppDir = ""
)

$ErrorActionPreference = "Stop"
$ProtocolName = "ivlyrics-updater"
$UpdaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"

if ([string]::IsNullOrWhiteSpace($AppDir)) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$SourceScript = Join-Path $PSScriptRoot "ivlyrics-updater.ps1"
if (-not (Test-Path -LiteralPath $SourceScript)) {
    throw "Updater script not found: $SourceScript"
}

New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
$TargetScript = Join-Path $UpdaterRoot "ivlyrics-updater.ps1"
Copy-Item -LiteralPath $SourceScript -Destination $TargetScript -Force

$PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Command = "`"$PowerShellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$TargetScript`" `"%1`""
$ProtocolRoot = "HKCU:\Software\Classes\$ProtocolName"

New-Item -Path $ProtocolRoot -Force | Out-Null
Set-Item -Path $ProtocolRoot -Value "URL:ivLyrics Updater Protocol"
Set-ItemProperty -Path $ProtocolRoot -Name "URL Protocol" -Value ""

New-Item -Path "$ProtocolRoot\DefaultIcon" -Force | Out-Null
Set-Item -Path "$ProtocolRoot\DefaultIcon" -Value "`"$PowerShellExe`",0"

New-Item -Path "$ProtocolRoot\shell\open\command" -Force | Out-Null
Set-Item -Path "$ProtocolRoot\shell\open\command" -Value $Command

Write-Host "Registered ${ProtocolName}:// protocol."
