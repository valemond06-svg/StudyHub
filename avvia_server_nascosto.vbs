' Avvia solo il server di StudyHub, senza finestre e senza aprire il browser.
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
logf = sh.ExpandEnvironmentStrings("%TEMP%") & "\studyhub-server.log"
sh.Run "cmd /c """"" & dir & "studyhub.bat"" serve --no-open > """ & logf & """ 2>&1""", 0, False
