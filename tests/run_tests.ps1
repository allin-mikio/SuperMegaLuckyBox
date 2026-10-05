# JS版エンジンのテストをヘッドレス Edge / Chrome で実行する。
#   1) Flask版から基準データを生成する (gen_golden.py)  ※数分かかる
#   2) tests/run.html をブラウザで開き、結果を表示する
#
# 使い方: powershell -ExecutionPolicy Bypass -File .\tests\run_tests.ps1
#   -SkipGen : 基準データの再生成を省略し、既存の tests\golden.js を使う
#   -SaveDom : ブラウザが出力したDOMを保存する（失敗時の調査用。tests\diff_mismatch.py で使う）
#
# 注意: このファイルは「UTF-8 BOM付き」で保存すること。
#       BOMがないと Windows PowerShell 5.1 が SJIS として読み、日本語が文字化けして構文エラーになる。
param([switch]$SkipGen, [string]$SaveDom = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $SkipGen) {
    $python = Join-Path $root '.venv\Scripts\python.exe'
    & $python (Join-Path $root 'tests\gen_golden.py')
}

$candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Edge または Chrome が見つかりません' }

$url = 'file:///' + ((Join-Path $root 'tests\run.html') -replace '\\', '/')
$profileDir = Join-Path $env:TEMP 'luckybox-test-profile'
$domFile = Join-Path $env:TEMP 'luckybox-test-dom.html'

# ブラウザの出力を PowerShell のパイプに通すと文字化け・欠落するため、cmd のリダイレクトでファイルへ出力する
cmd /c "`"$browser`" --headless=new --disable-gpu --no-first-run --user-data-dir=`"$profileDir`" --allow-file-access-from-files --virtual-time-budget=60000 --dump-dom $url > `"$domFile`" 2> nul"

$text = [System.IO.File]::ReadAllText($domFile, [System.Text.Encoding]::UTF8)
if ($SaveDom) { Copy-Item $domFile $SaveDom -Force }

if ($text -match '(?s)<pre id="out">(.*?)</pre>') {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [System.Net.WebUtility]::HtmlDecode($Matches[1])
} else {
    Write-Host 'ブラウザからテスト結果を取得できませんでした。'
}
