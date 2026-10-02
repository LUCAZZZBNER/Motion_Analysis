param(
    [string]$Python = '',
    [ValidateRange(1024,65535)][int]$Port = 8000,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not $Python) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $Python = $bundledPython }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { $Python = (Get-Command python).Source }
    else { throw '没有找到已有 Python，请用 -Python 指定 Python 3.11 或更新版本。不需要安装第三方软件包。' }
}
$launchArgs = @((Join-Path $PSScriptRoot 'app.py'), '--port', $Port)
if ($NoBrowser) { $launchArgs += '--no-browser' }
& $Python @launchArgs
if ($LASTEXITCODE -ne 0) { throw '启动失败，请查看上方说明；端口占用时可使用 -Port 8001。' }
