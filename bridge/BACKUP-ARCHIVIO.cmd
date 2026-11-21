@echo off
setlocal
rem Copia coerente (VACUUM INTO) dell'archivio dell'impianto in bridge\data\impianto\backup.
rem Funziona anche con il servizio acceso. Copiare poi il file anche fuori da questo PC.
rem Con /automatico (attivita' giornaliera, vedi INSTALLA-AVVIO-AUTOMATICO.cmd) non chiede nulla,
rem conserva gli ultimi 30 backup e scrive l'esito in bridge\data\impianto\backup-automatico.log.
pushd "%~dp0.." || goto :folder_error
if /i "%~1"=="/automatico" goto :automatic
call "%~dp0_verifica-node.cmd" || goto :end
node --disable-warning=ExperimentalWarning "bridge\backup.mjs" backup --impianto
:end
echo.
pause
popd
exit /b 0

:automatic
if not exist "bridge\data\impianto" mkdir "bridge\data\impianto"
set "BACKUPLOG=bridge\data\impianto\backup-automatico.log"
echo %DATE% %TIME% backup automatico>> "%BACKUPLOG%"
call "%~dp0_verifica-node.cmd" >> "%BACKUPLOG%" 2>&1
if errorlevel 1 goto :automatic_end
node --disable-warning=ExperimentalWarning "bridge\backup.mjs" backup --impianto --mantieni 30 >> "%BACKUPLOG%" 2>&1
:automatic_end
set "backupExit=%ERRORLEVEL%"
popd
exit /b %backupExit%

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
if /i "%~1"=="/automatico" exit /b 1
pause
exit /b 1
