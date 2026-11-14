@echo off
setlocal
rem Ripristina l'archivio dell'impianto da un backup. Il servizio deve essere FERMO.
rem Si puo' trascinare il file di backup sopra questo file, oppure indicarlo quando richiesto.
rem Prima del ripristino viene salvata una copia dell'archivio attuale.
pushd "%~dp0.." || goto :folder_error
call "%~dp0_verifica-node.cmd" || goto :end
set "backupFile=%~1"
if defined backupFile goto :confirm
echo Backup disponibili:
node --disable-warning=ExperimentalWarning "bridge\backup.mjs" elenco --impianto
echo.
set /p "backupFile=Trascina qui il file di backup e premi Invio: "
if not defined backupFile goto :end
set "backupFile=%backupFile:"=%"
:confirm
echo.
echo File scelto: "%backupFile%"
choice /C SN /N /M "Confermi il ripristino con il servizio fermo? [S/N]: "
if errorlevel 2 goto :end
node --disable-warning=ExperimentalWarning "bridge\backup.mjs" ripristina "%backupFile%" --impianto
:end
echo.
pause
popd
exit /b 0

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1
