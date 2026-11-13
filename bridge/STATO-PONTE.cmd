@echo off
setlocal
rem Mostra lo stato del ponte dal file stato.json. Non contatta PLC o gestionale.
pushd "%~dp0.." || goto :folder_error
call "%~dp0_verifica-node.cmd" || goto :end
choice /C IS /N /M "Stato dell'impianto [I] o della simulazione [S]? "
if errorlevel 2 (set "mode=--simulazione") else (set "mode=--impianto")
echo.
node "bridge\status.mjs" %mode%
:end
echo.
pause
popd
exit /b 0

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1
