' Avvia l'auto-sync di StudyHub senza finestra (usato dall'attività pianificata "StudyHub sync").
' Il log va in %TEMP%\studyhub-sync.log.
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
logf = sh.ExpandEnvironmentStrings("%TEMP%") & "\studyhub-sync.log"
sh.Run "cmd /c """"" & dir & "studyhub.bat"" auto-sync > """ & logf & """ 2>&1""", 0, True
