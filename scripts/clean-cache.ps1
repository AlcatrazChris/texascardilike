param([switch]$DryRun, [switch]$IncludeDeploymentTools)
$ErrorActionPreference = 'Stop'
$riverWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$riverTools = Join-Path $riverWorkspace '.tools'
if (!(Test-Path -LiteralPath $riverTools)) { return }
if ((Get-Item -LiteralPath $riverTools -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked tools directory.' }
# Generated browser profiles and download cache; never touch env, credentials, source or Node.
$riverNames = @('npm-cache', 'browser-profile', 'table-updates-profile', 'fixed-table-profile', 'reconnect-fixes-profile', 'edge-records-20261026', 'review-profile', 'multiplayer-profile', 'seat-review-profile', 'ai-diagnostics-profile', 'performance-profile', 'npm.tgz', 'feature-fixtures.json', 'deploy-dry.json', 'seat-qa-results.json')
if ($IncludeDeploymentTools) { $riverNames += 'vc' }
$riverTargets = @($riverNames | ForEach-Object { Join-Path $riverTools $_ })
$riverTargets += @(Get-ChildItem -LiteralPath $riverTools -File -Filter '*.png' | ForEach-Object { $_.FullName })
$riverFreed = 0L
foreach ($riverTarget in $riverTargets) {
    if (!(Test-Path -LiteralPath $riverTarget)) { continue }
    $riverResolved = (Resolve-Path -LiteralPath $riverTarget).Path
    if (!$riverResolved.StartsWith($riverTools + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target outside workspace tools directory.' }
    $riverItem = Get-Item -LiteralPath $riverResolved -Force
    if ($riverItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked cache target.' }
    if ($riverItem.PSIsContainer) {
        $riverLinks = @(Get-ChildItem -LiteralPath $riverResolved -Recurse -Force -Attributes ReparsePoint)
        if ($riverLinks.Count) { throw 'Refusing cache directory containing links.' }
        $riverSize = (Get-ChildItem -LiteralPath $riverResolved -Recurse -Force -File | Measure-Object Length -Sum).Sum
    } else { $riverSize = $riverItem.Length }
    if (!$DryRun) { Remove-Item -LiteralPath $riverResolved -Recurse -Force }
    $riverFreed += $riverSize
    Write-Output ('{0}: {1:N2} MB' -f $riverItem.Name, ($riverSize / 1MB))
}
Write-Output ('{0}: {1:N2} MB' -f $(if ($DryRun) {'Reclaimable'} else {'Reclaimed'}), ($riverFreed / 1MB))
