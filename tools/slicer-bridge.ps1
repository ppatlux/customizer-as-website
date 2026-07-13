# Starts a tiny local bridge that accepts generated STL files from the engraving page
# and opens them directly in OrcaSlicer or PrusaSlicer on the same Windows machine
# (equivalent to double-clicking the STL, forwarded into an already-running window
# when the target slicer has single-instance mode enabled).

param(
  [int]$Port = 32123
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-CorsHeaders {
  param([System.Net.HttpListenerResponse]$Response)

  $Response.Headers['Access-Control-Allow-Origin'] = '*'
  $Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  $Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
}

function Write-JsonResponse {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$StatusCode,
    [hashtable]$Payload
  )

  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = 'application/json'
  Add-CorsHeaders -Response $Context.Response

  $json = $Payload | ConvertTo-Json -Depth 4 -Compress
  $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
  try {
    $Context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
  } finally {
    try {
      $Context.Response.OutputStream.Close()
    } catch {
    }
  }
}

function Write-FileResponse {
  param(
    [System.Net.HttpListenerContext]$Context,
    [string]$FilePath
  )

  if (-not (Test-Path $FilePath)) {
    Write-JsonResponse -Context $Context -StatusCode 404 -Payload @{
      ok = $false
      error = 'File not found'
    }
    return
  }

  $bytes = [System.IO.File]::ReadAllBytes($FilePath)
  $Context.Response.StatusCode = 200
  $Context.Response.ContentType = 'model/stl'
  Add-CorsHeaders -Response $Context.Response
  $Context.Response.ContentLength64 = $bytes.LongLength
  try {
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } finally {
    try {
      $Context.Response.OutputStream.Close()
    } catch {
    }
  }
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

function Start-SlicerWorkflow {
  param(
    [string]$ModelPath,
    [string]$Slicer
  )

  $config = $SlicerConfig[$Slicer]
  if (-not $config) {
    throw "Unknown slicer '$Slicer'."
  }

  $exePath = Resolve-SlicerExecutableFromProcess -ProcessName $config.processName
  if (-not $exePath) {
    $exePath = Resolve-SlicerExecutableFromRegistry -ProgId $config.progId
  }

  if (-not $exePath) {
    throw "Could not find $($config.displayName). Install/open it at least once so it registers itself, then try again."
  }

  # Passing the file as an argument is the same thing that happens when you double-click
  # an STL/3MF in Explorer. With single-instance mode enabled for the target slicer, this
  # forwards the file into the already-running window instead of opening a new one.
  $argumentList = @($config.extraArgs + "`"$ModelPath`"")
  Start-Process -FilePath $exePath -ArgumentList $argumentList

  return @{
    ok = $true
    message = "Sent the generated STL to $($config.displayName)."
    path = $ModelPath
    filename = [System.IO.Path]::GetFileName($ModelPath)
  }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host "HP Robot slicer bridge listening on http://127.0.0.1:$Port/"
Write-Host 'Leave this window open while using Send to Slicer from the engraving tool.'

try {
  # Deliberately kept outside the project folder: if the engraving page is served
  # through a dev server with file-watching/live-reload, writing the STL into the
  # watched project tree (e.g. exports\orca) triggers a full page reload and wipes
  # all in-browser state (SVG layers, viewport, everything).
  $targetFolder = Join-Path $env:TEMP 'hp-robot-slicer-bridge'
  [System.IO.Directory]::CreateDirectory($targetFolder) | Out-Null

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request

    if ($request.HttpMethod -eq 'OPTIONS') {
      $context.Response.StatusCode = 204
      Add-CorsHeaders -Response $context.Response
      $context.Response.OutputStream.Close()
      continue
    }

    if ($request.HttpMethod -eq 'GET' -and $request.Url.AbsolutePath.StartsWith('/files/')) {
      $encodedName = $request.Url.AbsolutePath.Substring('/files/'.Length)
      $fileName = [System.Uri]::UnescapeDataString($encodedName)
      $safeName = [System.IO.Path]::GetFileName($fileName)
      $filePath = Join-Path $targetFolder $safeName
      Write-FileResponse -Context $context -FilePath $filePath
      continue
    }

    if ($request.HttpMethod -ne 'POST' -or $request.Url.AbsolutePath -ne '/open-model') {
      Write-JsonResponse -Context $context -StatusCode 404 -Payload @{
        ok = $false
        error = 'Not found'
      }
      continue
    }

    try {
      $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
      $body = $reader.ReadToEnd()
      $reader.Close()

      $payload = $body | ConvertFrom-Json
      $filename = [System.IO.Path]::GetFileName(($payload.filename | Out-String).Trim())
      if ([string]::IsNullOrWhiteSpace($filename)) {
        $filename = 'engraved_model.stl'
      }

      $slicer = (($payload.slicer | Out-String).Trim()).ToLowerInvariant()
      if (-not $SlicerConfig.ContainsKey($slicer)) {
        $slicer = 'orca'
      }

      $targetPath = Join-Path $targetFolder $filename
      $bytes = [System.Convert]::FromBase64String(($payload.content_base64 | Out-String).Trim())
      [System.IO.File]::WriteAllBytes($targetPath, $bytes)

      $result = Start-SlicerWorkflow -ModelPath $targetPath -Slicer $slicer
      Write-JsonResponse -Context $context -StatusCode 200 -Payload $result
    } catch {
      Write-JsonResponse -Context $context -StatusCode 500 -Payload @{
        ok = $false
        error = $_.Exception.Message
      }
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
