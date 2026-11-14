param(
    [string]$DotNet = 'dotnet',
    [string]$ContractsSource = '',
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$repository = [System.IO.Path]::GetFullPath((Join-Path $projectDirectory '..\..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repository 'release' }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$arguments = @('build', (Join-Path $projectDirectory 'TPV.KHostBridge.csproj'), '--configuration', 'Release')
if ($ContractsSource) { $arguments += @('--source', $ContractsSource) }
& $DotNet @arguments
if ($LASTEXITCODE -ne 0) { throw 'KHost bridge compilation failed.' }
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
$stage = Join-Path $temporaryRoot ('tpv-khost-package-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $stage 'tpv-companion-bridge'
New-Item -ItemType Directory -Path $payload | Out-Null
try {
    $buildDirectory = Join-Path $projectDirectory 'bin\Release\net10.0'
    foreach ($name in @('TPV.KHostBridge.dll', 'TPV.KHostBridge.deps.json', 'manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $buildDirectory $name) -Destination (Join-Path $payload $name)
    }
    # Deliberately excludes the host's MIT contracts DLL and any other KHost code.
    Copy-Item -LiteralPath (Join-Path $repository 'docs\khost-bridge.md') -Destination (Join-Path $payload 'README.md')
    Copy-Item -LiteralPath (Join-Path $projectDirectory 'THIRD-PARTY-NOTICES.md') -Destination $payload
    $dependency = Get-Content -Raw -LiteralPath (Join-Path $payload 'TPV.KHostBridge.deps.json') | ConvertFrom-Json
    if (-not $dependency.libraries.'KHost.Abstractions/1.0.0') { throw 'Bridge dependency identity is missing.' }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $archive = Join-Path $OutputDirectory 'TPV-KHost-Bridge-0.1.0.zip'
    Compress-Archive -LiteralPath $payload -DestinationPath $archive -Force
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'TPV-KHost-Bridge-0.1.0-SHA256SUMS.txt'),
        $hash + '  ' + [System.IO.Path]::GetFileName($archive) + "`n", [System.Text.UTF8Encoding]::new($false))
    $sourceCommit = (& git -C $repository rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify the bridge source revision.' }
    $sourceStatus = & git -c core.fileMode=false -C $repository status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect bridge source status.' }
    $receipt = [ordered]@{
        version = '0.1.0'; protocol = 1; targetFramework = 'net10.0'; contractsPackage = 'KHost.Abstractions/1.0.0'
        sourceCommit = $sourceCommit; sourceHasUncommittedChanges = [bool]$sourceStatus
        createdAt = [DateTime]::UtcNow.ToString('o'); sha256 = $hash; artifact = [System.IO.Path]::GetFileName($archive)
        externalPlayback = $true; embeddedPlayback = $false; acquisition = $false
    }
    [System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'TPV-KHost-Bridge-0.1.0-build.json'),
        ($receipt | ConvertTo-Json) + "`n", [System.Text.UTF8Encoding]::new($false))
    Write-Output "Built TPV KHost Bridge 0.1.0: $archive"
    Write-Output "SHA256: $hash"
}
finally {
    $actual = (Resolve-Path -LiteralPath $stage).Path
    if ([System.IO.Path]::GetDirectoryName($actual).TrimEnd('\', '/') -ne $temporaryRoot -or
        -not [System.IO.Path]::GetFileName($actual).StartsWith('tpv-khost-package-')) { throw 'Unsafe packaging cleanup path.' }
    Remove-Item -LiteralPath $actual -Recurse -Force
}
