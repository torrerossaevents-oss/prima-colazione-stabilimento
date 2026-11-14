@echo off
setlocal
rem SIMULAZIONE: PLC e gestionale finti su questo PC. Non tocca il LOGO! e non invia dati reali.
pushd "%~dp0.." || goto :folder_error
call "%~dp0_verifica-node.cmd" || goto :end_error
title Prima Colazione - Ponte in SIMULAZIONE
echo SIMULAZIONE - PLC e gestionale finti su questo PC. Nessun dato reale.
echo Ogni 20 cartoni simulati viene premuto il pulsante di chiusura simulato.
echo Per fermare: Ctrl+C, poi rispondere S alla domanda di Windows.
echo.
node --disable-warning=ExperimentalWarning "bridge\service.mjs" --simulazione
set "bridgeExit=%ERRORLEVEL%"
echo.
if not "%bridgeExit%"=="0" echo Operazione non completata. Leggi il messaggio sopra.
pause
popd
exit /b %bridgeExit%

:end_error
pause
popd
exit /b 1

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1
