Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

electronExe = currentDir & "\frontend\node_modules\electron\dist\electron.exe"
mainScript = currentDir & "\frontend\electron\main.cjs"

If fso.FileExists(electronExe) Then
    WshShell.Run Chr(34) & electronExe & Chr(34) & " " & Chr(34) & mainScript & Chr(34), 0, False
Else
    WshShell.Run "cmd /c cd /d " & Chr(34) & currentDir & "\frontend" & Chr(34) & " && npm.cmd run electron:dev", 0, False
End If
