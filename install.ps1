#Requires -Version 5.1
<#
.SYNOPSIS
Install the Lorelum CLI release for Windows x64.

.DESCRIPTION
Downloads a release archive and SHA256SUMS, verifies both before extracting,
then atomically installs the package under the versions directory and creates
a managed lore.cmd shim. Adds the shim directory to the current user's Path
when it is absent. Pass -Version to install one specific release.

Environment overrides (matching install.sh):
  LORELUM_INSTALL_RELEASE_BASE_URL     release download base
  LORELUM_INSTALL_RELEASE_API_BASE_URL releases API base
  LORELUM_INSTALL_ROOT                 installation root
  LORELUM_INSTALL_BIN_DIR              shim directory
#>
[CmdletBinding()]
param(
  [string]$Version
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 renders Invoke-WebRequest progress per received chunk, which makes
# multi-megabyte release downloads tens of times slower and looks frozen; keep the progress
# UI off and report progress through Write-Output instead.
$ProgressPreference = 'SilentlyContinue'
$repository = 'https://github.com/lorelum/lorelum'
$releaseBase = if ($env:LORELUM_INSTALL_RELEASE_BASE_URL) { $env:LORELUM_INSTALL_RELEASE_BASE_URL } else { "$repository/releases/download" }
$releaseApiBase = if ($env:LORELUM_INSTALL_RELEASE_API_BASE_URL) { $env:LORELUM_INSTALL_RELEASE_API_BASE_URL } else { 'https://api.github.com/repos/lorelum/lorelum/releases' }
$installRoot = if ($env:LORELUM_INSTALL_ROOT) { $env:LORELUM_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'Lorelum' }
$binDirectory = if ($env:LORELUM_INSTALL_BIN_DIR) { $env:LORELUM_INSTALL_BIN_DIR } else { Join-Path $installRoot 'bin' }

function Fail([string]$Message) {
  # A terminating error preserves an interactive caller session; exit would close it.
  throw "lore install: $Message"
}

function Get-Sha256([string]$Path) {
  (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Normalize-PathEntry([string]$Value) {
  $trimmed = $Value.Trim().Trim('"')
  if (-not $trimmed) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables($trimmed)
  try {
    return [System.IO.Path]::GetFullPath($expanded).TrimEnd('\')
  } catch {
    return $expanded.TrimEnd('\')
  }
}

function Resolve-PathTarget {
  # Process scope lets the Windows integration test exercise this path without
  # writing a temporary test directory into the developer's actual user Path.
  $name = if ($env:LORELUM_INSTALL_PATH_TARGET) { $env:LORELUM_INSTALL_PATH_TARGET } else { 'User' }
  try {
    $target = [System.Enum]::Parse([System.EnvironmentVariableTarget], $name, $true)
  } catch {
    Fail "invalid Path target: $name"
  }
  if ($target -notin @([System.EnvironmentVariableTarget]::User, [System.EnvironmentVariableTarget]::Process)) {
    Fail "unsupported Path target: $name"
  }
  return $target
}

function Broadcast-UserEnvironmentChange {
  # Best-effort notice so running shells refresh their environment; a failure here must
  # never fail an otherwise-successful install (new terminals read the registry anyway).
  try {
    if (-not ('Lorelum.Native.EnvironmentChange' -as [type])) {
      Add-Type @'
using System;
using System.Runtime.InteropServices;

namespace Lorelum.Native {
  public static class EnvironmentChange {
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(
      IntPtr hWnd,
      uint msg,
      UIntPtr wParam,
      string lParam,
      uint flags,
      uint timeout,
      out UIntPtr result);
  }
}
'@
    }
    # [UIntPtr]0 fails to convert on Windows PowerShell 5.1; Zero is already the right type.
    [UIntPtr]$result = [UIntPtr]::Zero
    [void][Lorelum.Native.EnvironmentChange]::SendMessageTimeout(
      [IntPtr]0xffff,
      0x001a,
      [UIntPtr]::Zero,
      'Environment',
      0x0002,
      5000,
      [ref]$result
    )
  } catch {
    Write-Verbose "environment change broadcast skipped: $($_.Exception.Message)"
  }
}

function Add-LorelumBinToPath([string]$Directory, [System.EnvironmentVariableTarget]$Target) {
  $normalizedDirectory = Normalize-PathEntry $Directory
  $current = [Environment]::GetEnvironmentVariable('Path', $Target)
  $entries = @(
    ([string]$current -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  )
  foreach ($entry in $entries) {
    if ([string]::Equals((Normalize-PathEntry $entry), $normalizedDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }
  [Environment]::SetEnvironmentVariable('Path', (@($entries + $Directory) -join ';'), $Target)
  if ($Target -eq [System.EnvironmentVariableTarget]::User) { Broadcast-UserEnvironmentChange }
  return $true
}

# PowerShell 5.1 defaults may not negotiate TLS 1.2 with GitHub.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Test-WindowsX64 {
  # [Environment] has resolved in every observed Windows PowerShell session, while sessions
  # exist where [RuntimeInformation] members misbehave (observed: OSArchitecture yields no
  # value), which made the previous check reject actual Windows x64 hosts as unsupported.
  # 64-bit Windows includes ARM64 hosts running the x64 package under emulation.
  $env:OS -eq 'Windows_NT' -and [Environment]::Is64BitOperatingSystem
}
if (-not (Test-WindowsX64)) {
  Fail ("only Windows x64 is currently supported (detected OS={0}, 64-bit OS={1}, 64-bit process={2}, PowerShell {3})" -f
    $env:OS, [Environment]::Is64BitOperatingSystem, [Environment]::Is64BitProcess, $PSVersionTable.PSVersion)
}

# System32 bsdtar ships with Windows 10 1809+ and handles both listing and extraction.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tar)) { Fail "tar is required to extract the release archive: $tar" }

function Normalize-Version([string]$Value) {
  $trimmed = $Value.TrimStart('v')
  if ($trimmed -notmatch '^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)*$') { return $null }
  return $trimmed
}

function Get-ManagedLoreExecutable([string]$Content, [string]$Root) {
  $match = [regex]::Match($Content, '\A@echo off\r?\n"(?<target>[^"\r\n]+)" %\*\r?\n\z')
  if (-not $match.Success) { return $null }
  $rawTarget = $match.Groups['target'].Value
  if (-not [System.IO.Path]::IsPathRooted($rawTarget) -or
      $rawTarget.Contains('/') -or
      $rawTarget -match '[\x00-\x1F<>|*?"]') {
    return $null
  }
  if (($rawTarget -split '\\') -contains '.' -or ($rawTarget -split '\\') -contains '..') {
    return $null
  }
  try {
    $versionsRoot = [System.IO.Path]::GetFullPath((Join-Path $Root 'versions')).TrimEnd('\')
  } catch {
    return $null
  }
  $prefix = $versionsRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $rawTarget.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  $relative = $rawTarget.Substring($prefix.Length)
  if ($relative -notmatch '^[^\\/:*?<>|]+\\lore\.exe$') { return $null }
  return $rawTarget
}

$script:lastStopDiagnostic = ''
function Invoke-LoreBackendStop([string]$Executable) {
  $script:lastStopDiagnostic = ''
  $diagnosticPath = Join-Path $temporary ("backend-stop-" + [System.IO.Path]::GetRandomFileName() + '.log')
  try {
    if (-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
      $script:lastStopDiagnostic = 'the backend stop executable is missing or is not a regular file'
      return $false
    }
    & $Executable 'backend' 'stop' *> $diagnosticPath
    if ($LASTEXITCODE -eq 0) { return $true }
    $value = if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
      ((Get-Content -LiteralPath $diagnosticPath -Raw) -replace '[\r\n]+', ' ').Trim()
    } else {
      ''
    }
    $script:lastStopDiagnostic = if ($value) {
      $value.Substring(0, [Math]::Min(512, $value.Length))
    } else {
      'the backend stop command returned no diagnostic output'
    }
    return $false
  } catch {
    $script:lastStopDiagnostic = $_.Exception.Message.Substring(0, [Math]::Min(512, $_.Exception.Message.Length))
    return $false
  }
}

function Resolve-LatestTag {
  $latestPath = Join-Path $temporary 'latest-release.json'
  try {
    Invoke-WebRequest -Uri "$releaseApiBase/latest" -OutFile $latestPath -UseBasicParsing
  } catch {
    return $null
  }
  try {
    $latest = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
  if (-not $latest.tag_name -or (Normalize-Version $latest.tag_name) -eq $null) { return $null }
  return $latest.tag_name
}

$installRoot = [System.IO.Path]::GetFullPath($installRoot)
$binDirectory = [System.IO.Path]::GetFullPath($binDirectory)
$pathTarget = Resolve-PathTarget
New-Item -ItemType Directory -Force -Path $installRoot, $binDirectory | Out-Null
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("lore-install-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  if (-not $Version) {
    $releaseTag = Resolve-LatestTag
    if (-not $releaseTag) { Fail 'cannot resolve the latest stable release' }
    $Version = Normalize-Version $releaseTag
    if (-not $Version) { Fail 'cannot resolve the latest stable release' }
  } else {
    $normalized = Normalize-Version $Version
    if (-not $normalized) { Fail "invalid version: $Version" }
    $Version = $normalized
    $releaseTag = "v$Version"
  }

  $target = 'win32-x64'
  $archiveName = "lore-$Version-$target.zip"
  $packageName = "lore-$Version-$target"
  $archiveUrl = "$releaseBase/$releaseTag/$archiveName"
  $checksumsUrl = "$releaseBase/$releaseTag/SHA256SUMS"
  $archivePath = Join-Path $temporary $archiveName
  $checksumsPath = Join-Path $temporary 'SHA256SUMS'

  try {
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
  } catch {
    Fail "cannot download $archiveUrl"
  }
  try {
    Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath -UseBasicParsing
  } catch {
    Fail "cannot download $checksumsUrl"
  }

  $digests = @(Get-Content -LiteralPath $checksumsPath | ForEach-Object {
    $parts = $_ -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $archiveName) { $parts[0].Trim() }
  })
  if ($digests.Count -ne 1) { Fail "SHA256SUMS must contain exactly one digest for $archiveName" }
  if ($digests[0] -notmatch '^[0-9a-f]{64}$') { Fail "SHA256SUMS contains an invalid digest for $archiveName" }
  if ((Get-Sha256 $archivePath) -ne $digests[0]) { Fail 'archive checksum does not match SHA256SUMS' }

  $extracted = Join-Path $temporary 'extracted'
  New-Item -ItemType Directory -Path $extracted | Out-Null
  $listOutput = & $tar '-tf' $archivePath 2>$null
  if ($LASTEXITCODE -ne 0) { Fail 'archive cannot be listed' }
  foreach ($entry in $listOutput) {
    $entryName = $entry -replace '/', '\'
    if ($entryName -notlike "$packageName*") { Fail 'archive contains an unexpected root path' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $extracted $entryName))
    if (-not $full.StartsWith($extracted, [System.StringComparison]::OrdinalIgnoreCase)) {
      Fail 'archive contains an unsafe path'
    }
  }

  & $tar '-xf' $archivePath '-C' $extracted | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'archive extraction failed' }
  $packageDirectory = Join-Path $extracted $packageName
  if (-not (Test-Path -LiteralPath (Join-Path $packageDirectory 'lore.exe') -PathType Leaf)) { Fail 'archive CLI executable is missing' }
  foreach ($required in @('LICENSE', 'THIRD_PARTY_NOTICES.txt', "native\$target\lore-model.exe", "native\$target\manifest.json")) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageDirectory $required) -PathType Leaf)) { Fail "archive $required is missing" }
  }

  $destination = Join-Path $installRoot "versions\$Version"
  $commandPath = Join-Path $binDirectory 'lore.cmd'
  $expectedTarget = Join-Path $destination 'lore.exe'
  $shimContent = "@echo off`r`n`"$expectedTarget`" %*`r`n"
  $currentExecutable = $null

  if (Test-Path -LiteralPath $commandPath) {
    if (-not (Test-Path -LiteralPath $commandPath -PathType Leaf)) {
      Fail "existing command is not managed by Lorelum: $commandPath"
    }
    $existing = Get-Content -LiteralPath $commandPath -Raw
    if ($existing -notmatch [regex]::Escape((Join-Path $installRoot 'versions\'))) {
      Fail "existing command is not managed by Lorelum: $commandPath"
    }
    $currentExecutable = Get-ManagedLoreExecutable $existing $installRoot
  }

  if (Test-Path -LiteralPath $destination) {
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'lore.exe') -PathType Leaf)) {
      Fail "existing version path is not a Lorelum install: $destination"
    }
    if ((Get-Sha256 (Join-Path $packageDirectory 'lore.exe')) -ne (Get-Sha256 (Join-Path $destination 'lore.exe'))) {
      Fail "existing version differs from the verified archive: $Version"
    }
  }

  if ((Test-Path -LiteralPath $commandPath) -and
      -not [string]::Equals($currentExecutable, $expectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Output 'Stopping the existing Lorelum Backend before upgrading.'
    $stopped = $false
    if ($currentExecutable) {
      $stopped = Invoke-LoreBackendStop $currentExecutable
    }
    if (-not $stopped) {
      $stopped = Invoke-LoreBackendStop (Join-Path $packageDirectory 'lore.exe')
    }
    if (-not $stopped) {
      $recovery = if ($currentExecutable) {
        "`"$currentExecutable`" backend stop"
      } else {
        'the previous release''s backend stop command'
      }
      Fail "cannot safely stop the existing Lorelum Backend; the previous release remains active and was not replaced. Run $recovery, resolve its reported error, then rerun the installer. Last stop result: $script:lastStopDiagnostic"
    }
  }

  if (-not (Test-Path -LiteralPath $destination)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $installRoot 'versions') | Out-Null
    # Move is atomic on the same volume (the default layout: temp and install root both
    # under the user profile drive). A LORELUM_INSTALL_ROOT on another drive degrades
    # Move-Item to copy+delete; an interrupted copy is caught by the version checks above.
    Move-Item -LiteralPath $packageDirectory -Destination $destination
  }

  $temporaryShim = Join-Path $binDirectory ('.lore-install-' + [System.IO.Path]::GetRandomFileName() + '.cmd')
  Set-Content -LiteralPath $temporaryShim -Value $shimContent -NoNewline -Encoding Ascii
  Move-Item -LiteralPath $temporaryShim -Destination $commandPath -Force

  Write-Output "Installed lore $Version to $destination"
  if (Add-LorelumBinToPath $binDirectory $pathTarget) {
    if ($pathTarget -eq [System.EnvironmentVariableTarget]::User) {
      Write-Output "Added $binDirectory to the user PATH. Open a new terminal to run lore."
    } else {
      Write-Output "Added $binDirectory to the process PATH."
    }
  }
} finally {
  if (Test-Path -LiteralPath $temporary) {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}
