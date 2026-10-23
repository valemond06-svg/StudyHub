' Avvia senza finestre l'elaborazione completa di tutti i corsi (studyhub elabora-tutto).
' Si può rilanciare: riprende da dove era. Log in %TEMP%\studyhub-fullrun.log.
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
logf = sh.ExpandEnvironmentStrings("%TEMP%") & "\studyhub-fullrun.log"
sh.Run "cmd /c """"" & dir & "studyhub.bat"" elabora-tutto >> """ & logf & """ 2>&1""", 0, False
