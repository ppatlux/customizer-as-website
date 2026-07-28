' Hidden launcher for slicer-open-handler.ps1, registered as the hprobotslicer:// protocol's
' command instead of invoking powershell.exe directly. "powershell.exe -WindowStyle Hidden"
' still briefly flashes a console window because PowerShell hides itself AFTER the window is
' created; WScript.Shell.Run with window style 0 never creates the window at all, so this is
' the only reliable way to make the click produce zero visible windows besides the slicer
' itself opening.

Dim fso, shell, scriptDir, handlerPath, url, cmd, q
q = Chr(34)

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
handlerPath = scriptDir & "\slicer-open-handler.ps1"

url = ""
If WScript.Arguments.Count > 0 Then
  url = WScript.Arguments(0)
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & q & handlerPath & q & " " & q & url & q

Set shell = CreateObject("WScript.Shell")
shell.Run cmd, 0, False
