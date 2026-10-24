# Sync SW_BUILD in docs/sw.js with APP_VERSION in docs/js/version.js.
#
# Why: Safari on iPad/iPhone cannot detect changes in scripts that sw.js loads via importScripts
# (version.js), so it only starts a Service Worker update when sw.js itself changes.
# After editing version.js for a release, run this (or sync_sw_version.bat).
# (This file is ASCII only on purpose: Windows PowerShell 5 reads BOM-less files as ANSI.)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$versionFile = Join-Path $root 'docs\js\version.js'
$swFile = Join-Path $root 'docs\sw.js'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$versionText = [System.IO.File]::ReadAllText($versionFile, $utf8)
$m = [regex]::Match($versionText, "APP_VERSION\s*=\s*'([^']+)'")
if (-not $m.Success) {
    Write-Host 'ERROR: could not read APP_VERSION from version.js' -ForegroundColor Red
    exit 1
}
$version = $m.Groups[1].Value

$swText = [System.IO.File]::ReadAllText($swFile, $utf8)
$pattern = "const SW_BUILD = '[^']*';"
if (-not [regex]::IsMatch($swText, $pattern)) {
    Write-Host 'ERROR: "const SW_BUILD = ...;" line not found in sw.js' -ForegroundColor Red
    exit 1
}
$newText = [regex]::Replace($swText, $pattern, "const SW_BUILD = '$version';")

if ($newText -eq $swText) {
    Write-Host "OK: SW_BUILD in sw.js is already $version (no change)."
} else {
    [System.IO.File]::WriteAllText($swFile, $newText, $utf8)
    Write-Host "OK: SW_BUILD in sw.js set to $version."
}
