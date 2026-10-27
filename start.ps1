$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$riverNode = Get-Command node -ErrorAction SilentlyContinue
if ($riverNode) {
    & $riverNode.Source server.mjs
} elseif (Test-Path -LiteralPath '.tools/node.exe') {
    & '.tools/node.exe' server.mjs
} else {
    Write-Error '请安装 Node.js 22 或更新版本，然后运行 npm run dev。'
}
