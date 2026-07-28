# One-time setup for the engraving page's "Send to OrcaSlicer" / "Send to PrusaSlicer" buttons.
#
# Registers a custom hprobotslicer:// URL protocol (under HKCU, no admin rights needed) that
# points at slicer-open-handler.vbs in this same folder. Once registered, no background
# process or terminal window needs to stay open: Windows launches the handler on demand,
# exactly like clicking a mailto: or vscode:// link, whenever the page invokes the protocol.
#
# The command runs through slicer-open-handler.vbs (wscript.exe), not powershell.exe directly:
# "powershell.exe -WindowStyle Hidden" still flashes a console window briefly because it hides
# itself AFTER the window is created. The VBScript wrapper launches PowerShell via
# WScript.Shell.Run with window style 0, which never creates a window at all - the only thing
# the user sees is the slicer itself opening.
#
# Run once:
#   powershell -ExecutionPolicy Bypass -File tools/install-slicer-protocol.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$protocol = 'hprobotslicer'
$vbsPath = Join-Path $PSScriptRoot 'slicer-open-handler.vbs'
$handlerPath = Join-Path $PSScriptRoot 'slicer-open-handler.ps1'

if (-not (Test-Path $vbsPath)) {
  throw "Could not find slicer-open-handler.vbs next to this script at: $vbsPath"
}
if (-not (Test-Path $handlerPath)) {
  throw "Could not find slicer-open-handler.ps1 next to this script at: $handlerPath"
}
$resolvedVbs = (Resolve-Path $vbsPath).Path

$keyPath = "HKCU:\Software\Classes\$protocol"
New-Item -Path $keyPath -Force | Out-Null
Set-ItemProperty -Path $keyPath -Name '(Default)' -Value 'URL:HP Robot Slicer Bridge'
Set-ItemProperty -Path $keyPath -Name 'URL Protocol' -Value ''

New-Item -Path "$keyPath\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$keyPath\DefaultIcon" -Name '(Default)' -Value 'shell32.dll,1'

New-Item -Path "$keyPath\shell\open\command" -Force | Out-Null
$command = "`"$env:WINDIR\System32\wscript.exe`" //B `"$resolvedVbs`" `"%1`""
Set-ItemProperty -Path "$keyPath\shell\open\command" -Name '(Default)' -Value $command

Write-Host "Registered the '${protocol}://' protocol."
Write-Host "Handler: $resolvedVbs"
Write-Host ''
Write-Host 'You can now use "Send to OrcaSlicer" / "Send to PrusaSlicer" on the engraving page.'
Write-Host 'The first time you click it, your browser will ask to confirm opening "HP Robot Slicer Bridge" -'
Write-Host 'check "Always allow" (or equivalent) so future clicks skip the prompt entirely.'
Write-Host 'From then on the only thing that appears is the slicer itself opening - no console window, no popups.'
