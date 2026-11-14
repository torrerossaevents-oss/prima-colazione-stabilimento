@echo off
setlocal
rem Copia coerente (VACUUM INTO) dell'archivio dell'impianto in bridge\data\impianto\backup.
rem Funziona anche con il servizio acceso. Copiare poi il file anche fuori da questo PC.
pushd "%~dp0.." || goto :folder_error
call "%~dp0_verifica-node.cmd" || goto :end
node --disable-warning=ExperimentalWarning "bridge\backup.mjs" backup --impianto
:end
echo.
pause
popd
exit /b 0

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1
