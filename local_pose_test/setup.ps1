param([string]$Python = '')
$ErrorActionPreference = 'Stop'
if (-not $Python) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $Python = $bundledPython }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { $Python = (Get-Command python).Source }
    else { throw '找不到已有 Python，请用 -Python 指定其路径。' }
}
& $Python (Join-Path $PSScriptRoot 'app.py') --check
if ($LASTEXITCODE -ne 0) { throw '资源检查失败。本脚本不会自动下载或安装，请查看 README.md。' }
Write-Host '资源齐全，无需安装依赖。运行 .\start.ps1 即可。'
