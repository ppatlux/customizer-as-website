# Handler for the hprobotslicer:// custom protocol. Registered by install-slicer-protocol.ps1
# under HKCU\Software\Classes so Windows invokes this script (no admin rights needed, no
# background process to keep running) whenever the engraving page opens a link like:
#   hprobotslicer://open?file=<name>.stl&slicer=orca
#
# Windows passes the full clicked URL as the script's sole argument (the "%1" registered in
# the protocol's shell\open\command).

param(
  [Parameter(Position = 0)]
  [string]$Url
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Parse-QueryString {
  param([string]$Query)

  $result = @{}
  if ([string]::IsNullOrEmpty($Query)) {
    return $result
  }

  foreach ($pair in ($Query.TrimStart('?') -split '&')) {
    if ($pair -match '^([^=]+)=(.*)$') {
      $key = [System.Uri]::UnescapeDataString($Matches[1])
      $value = [System.Uri]::UnescapeDataString($Matches[2])
      $result[$key] = $value
    }
  }
  return $result
}

$SlicerConfig = @{
  orca = @{
    processName = 'orca-slicer'
    progId = 'orcaslicer'
    extraArgs = @()
    displayName = 'OrcaSlicer'
  }
  prusa = @{
    processName = 'prusa-slicer'
    progId = 'prusaslicer'
    extraArgs = @('--single-instance')
    displayName = 'PrusaSlicer'
  }
}

function Resolve-SlicerExecutableFromRegistry {
  param([string]$ProgId)

  $command = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$ProgId\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  if (-not $command) {
    return $null
  }

  $quoted = [regex]::Match($command, '^\s*"([^"]+)"')
  if ($quoted.Success -and (Test-Path $quoted.Groups[1].Value)) {
    return $quoted.Groups[1].Value
  }

  $firstToken = ($command -split '\s+')[0].Trim('"')
  if ($firstToken -and (Test-Path $firstToken)) {
    return $firstToken
  }

  return $null
}

function Resolve-SlicerExecutableFromProcess {
  param([string]$ProcessName)

  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc -and $proc.Path -and (Test-Path $proc.Path)) {
    return $proc.Path
  }
  return $null
}

function Show-HandlerError {
  param([string]$Message)

  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($Message, 'HP Robot Slicer Bridge', 'OK', 'Error') | Out-Null
  } catch {
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($Url)) {
    throw 'No URL was passed to the handler.'
  }

  $uri = [System.Uri]$Url
  $query = Parse-QueryString -Query $uri.Query

  $fileName = [System.IO.Path]::GetFileName((($query['file'] | Out-String).Trim()))
  if ([string]::IsNullOrWhiteSpace($fileName)) {
    throw 'No file name was provided in the hprobotslicer:// link.'
  }

  $slicer = (($query['slicer'] | Out-String).Trim()).ToLowerInvariant()
  if (-not $SlicerConfig.ContainsKey($slicer)) {
    $slicer = 'orca'
  }
  $config = $SlicerConfig[$slicer]

  # The page just triggered a normal browser download of this exact file name into the
  # default Downloads folder. Give the write a moment to land, then look for it there.
  $downloadsFolder = Join-Path $env:USERPROFILE 'Downloads'
  $filePath = Join-Path $downloadsFolder $fileName

  $waitedMs = 0
  $maxWaitMs = 8000
  while (-not (Test-Path $filePath) -and $waitedMs -lt $maxWaitMs) {
    Start-Sleep -Milliseconds 200
    $waitedMs += 200
  }

  if (-not (Test-Path $filePath)) {
    throw "Could not find the downloaded file in $downloadsFolder`: $fileName. If your browser saves downloads somewhere else, open it manually from there."
  }

  $exePath = Resolve-SlicerExecutableFromProcess -ProcessName $config.processName
  if (-not $exePath) {
    $exePath = Resolve-SlicerExecutableFromRegistry -ProgId $config.progId
  }

  if (-not $exePath) {
    throw "Could not find $($config.displayName). Install/open it at least once so it registers itself, then try again."
  }

  # Passing the file as an argument is the same thing that happens when you double-click
  # an STL in Explorer. With single-instance mode enabled for the target slicer, this
  # forwards the file into the already-running window instead of opening a new one.
  $argumentList = @($config.extraArgs + "`"$filePath`"")
  Start-Process -FilePath $exePath -ArgumentList $argumentList
} catch {
  Show-HandlerError -Message $_.Exception.Message
}
