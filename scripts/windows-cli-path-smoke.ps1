param(
    [Parameter(Mandatory=$true)]
    [string]$Launcher
)

$ErrorActionPreference = 'Stop'
$module = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $Launcher).Path)
$flags = [Reflection.BindingFlags]::Static -bor [Reflection.BindingFlags]::NonPublic
$apply = $module.GetType('BoothCli', $true).GetMethod('ApplyPathRegistration', $flags)
if (!$apply) { throw 'The launcher does not expose its testable PATH registration routine.' }
$registry = [Microsoft.Win32.Registry]::CurrentUser
$keyPath = "Software\TPV-CliSmoke-$([Guid]::NewGuid().ToString('N'))"
$lookup = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
$kind = [Microsoft.Win32.RegistryValueKind]::ExpandString

# Temporary HKCU keys exercise the real Windows registry implementation without
# updating the running user's PATH or the installed Booth's ownership marker.
$root = $registry.CreateSubKey($keyPath)
$pathKey = $root.CreateSubKey('Environment')
$owner = $root.CreateSubKey('Registration')
try {
    $original = 'C:\Unrelated Commands;%SystemRoot%\System32;'
    $first = 'C:\Test Booth\original'
    $moved = 'C:\Test Booth\moved'
    $pathKey.SetValue('Path', $original, $kind)
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $first, $true))
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $first, $true))
    if ($pathKey.GetValue('Path', '', $lookup) -cne "$original;$first") { throw 'Registration edited or duplicated PATH.' }
    if ($pathKey.GetValueKind('Path') -ne $kind) { throw 'Registration changed the value type.' }
    if ($owner.GetValue('InstalledCliPath') -cne $first) { throw 'Installation did not record ownership.' }

    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $first, $false))
    if ($pathKey.GetValue('Path', '', $lookup) -cne $original) { throw 'Uninstall failed to preserve existing entries.' }
    if ($null -ne $owner.GetValue('InstalledCliPath')) { throw 'Uninstall left the ownership marker.' }
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $moved, $true))
    if ($pathKey.GetValue('Path', '', $lookup) -cne "$original;$moved") { throw 'Moved install retained the old location.' }
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $moved, $false))

    $equivalent = ' "%SystemRoot%\System32\" ; C:\Remaining '
    $pathKey.SetValue('Path', $equivalent, $kind)
    $existing = [IO.Path]::Combine($env:SystemRoot, 'System32')
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $existing, $true))
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $existing, $false))
    if ($pathKey.GetValue('Path', '', $lookup) -cne $equivalent -or $null -ne $owner.GetValue('InstalledCliPath')) {
        throw 'An equivalent user-managed PATH entry was removed or claimed.'
    }
    $pathKey.DeleteValue('Path', $false)
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $first, $true))
    $null = $apply.Invoke($null, [object[]]@($pathKey, $owner, $first, $false))
    if ($null -ne $pathKey.GetValue('Path')) { throw 'Uninstall created a value when the original PATH was absent.' }
    'Packaged Windows CLI PATH registration, repair and ownership cleanup passed.'
} finally {
    $owner.Dispose()
    $pathKey.Dispose()
    $root.Dispose()
    $registry.DeleteSubKeyTree($keyPath, $false)
}
