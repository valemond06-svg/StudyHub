' Apre StudyHub con un doppio clic (usato dal collegamento sul desktop).
' Se il server locale non è già acceso lo avvia senza finestre, aspetta che risponda
' e apre l'app in una finestra a sé del browser predefinito (Brave/Chrome/Edge: modalità app).
Option Explicit
Dim sh, fso, dir, url, logf, i, ok, browser
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName) & "\"
url = "http://127.0.0.1:8765"
logf = sh.ExpandEnvironmentStrings("%TEMP%") & "\studyhub-server.log"

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1500
  http.Open "GET", url & "/api/storage", False
  http.Send
  If Err.Number = 0 Then ServerUp = (http.Status = 200)
  On Error GoTo 0
End Function

Function DefaultBrowser()
  ' Eseguibile del browser predefinito per http, se è basato su Chromium (supporta --app).
  Dim progId, cmd, exe
  DefaultBrowser = ""
  On Error Resume Next
  progId = sh.RegRead("HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice\ProgId")
  cmd = sh.RegRead("HKCR\" & progId & "\shell\open\command\")
  On Error GoTo 0
  If Left(cmd, 1) = """" Then
    exe = Mid(cmd, 2, InStr(2, cmd, """") - 2)
  Else
    exe = Split(cmd, " ")(0)
  End If
  If InStr(1, exe, "brave", 1) + InStr(1, exe, "chrome", 1) + InStr(1, exe, "msedge", 1) > 0 Then
    DefaultBrowser = exe
  Else
    ' Firefox o altro: Edge c'è su ogni Windows e apre l'app in una finestra a sé.
    exe = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
    If fso.FileExists(exe) Then DefaultBrowser = exe
  End If
End Function

If Not ServerUp() Then
  sh.Run "cmd /c """"" & dir & "studyhub.bat"" serve --no-open > """ & logf & """ 2>&1""", 0, False
  ok = False
  For i = 1 To 90
    WScript.Sleep 1000
    If ServerUp() Then ok = True: Exit For
  Next
  If Not ok Then
    MsgBox "StudyHub non è partito entro 90 secondi." & vbCrLf & "Dettagli nel log: " & logf, vbExclamation, "StudyHub"
    WScript.Quit 1
  End If
End If

' Indirizzo diverso a ogni apertura: il browser non può riusare una copia vecchia della pagina.
Dim pageUrl
pageUrl = url & "/?avvio=" & Replace(CStr(Timer), ",", "")
browser = DefaultBrowser()
If browser <> "" Then
  sh.Run """" & browser & """ --app=" & pageUrl, 1, False
Else
  sh.Run pageUrl, 1, False
End If
