Dim WShell
Set WShell = CreateObject("WScript.Shell")
WShell.CurrentDirectory = "C:\Users\Dell\Desktop\Videso to shorts"

' Run spawn_tunnel.js via Node.js attached to Windows Desktop Shell (0 = Hidden, False = Detached background process)
WShell.Run """C:\Program Files\RStudio\resources\app\bin\node\node.exe"" spawn_tunnel.js", 0, False
