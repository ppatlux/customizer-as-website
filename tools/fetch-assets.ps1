$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'assets\asset-manifest.json'
$modelsDir = Join-Path $root 'assets\models'

if (-not (Test-Path $manifestPath)) {
  throw "Manifest not found: $manifestPath"
}

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json

foreach ($part in $manifest.PSObject.Properties) {
  foreach ($entry in $part.Value) {
    $targets = @(
      @{ Url = $entry.source; Local = $entry.file },
      @{ Url = ($entry.source -replace '\.glb$', '.step'); Local = ($entry.file -replace '\.glb$', '.step') },
      @{ Url = ($entry.source -replace '\.glb$', '.3mf'); Local = ($entry.file -replace '\.glb$', '.3mf') }
    )

    foreach ($target in $targets) {
      $destination = Join-Path $modelsDir $target.Local
      if (Test-Path $destination) {
        Write-Host "Skip existing $($target.Local)"
        continue
      }

      try {
        Write-Host "Downloading $($target.Local)"
        Invoke-WebRequest -Uri $target.Url -OutFile $destination
      } catch {
        Write-Warning "Failed to download $($target.Url)"
      }
    }
  }
}

Write-Host 'Done.'
