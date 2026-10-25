@echo off
chcp 65001 >nul
echo Opening Windows Firewall for TCP port 8765 (needs admin)...
powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=GunGameServerTCP8765 dir=in action=allow protocol=TCP localport=8765' -Verb RunAs"
echo If a UAC window popped up, click Yes.
echo Firewall rule 'GunGameServerTCP8765' added (or already exists).
pause
