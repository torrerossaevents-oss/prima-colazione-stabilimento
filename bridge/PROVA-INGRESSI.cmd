@echo off
setlocal
pushd "%~dp0.." || goto :folder_error
call "%~dp0_verifica-node.cmd" || goto :node_error
title Prima Colazione - Prova ingressi LOGO!
echo PROVA INGRESSI - sola lettura: non modifica il LOGO! e non invia dati al gestionale.
echo Serve il programma conta-cartoni caricato nel LOGO! con l'accesso Modbus attivo.
echo.
set "LOGOIP="
set /p "LOGOIP=Indirizzo del LOGO! (es. 192.168.0.3), poi Invio: "
if "%LOGOIP%"=="" goto :cancelled
node bridge/prova-ingressi.mjs --host "%LOGOIP%"

set "bridgeExit=%ERRORLEVEL%"
echo.
if not "%bridgeExit%"=="0" echo Operazione non completata. Leggi il messaggio sopra.
pause
popd
exit /b %bridgeExit%

:node_error
pause
popd
exit /b 1

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1

:cancelled
echo Prova annullata. Nessun collegamento eseguito.
pause
popd
exit /b 0
