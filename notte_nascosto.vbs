' Avvia il turno di notte di StudyHub senza finestra (attività pianificata "StudyHub notte").
' Lavori LLM sul 35B del fisso (cavo o tailnet), Whisper sulla GPU del laptop. Il log va in %TEMP%\studyhub-notte.log.
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
logf = sh.ExpandEnvironmentStrings("%TEMP%") & "\studyhub-notte.log"
sh.Run "cmd /c """"" & dir & "studyhub.bat"" notte --solo-locale > """ & logf & """ 2>&1""", 0, True
