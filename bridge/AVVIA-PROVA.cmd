@echo off
setlocal
pushd "%~dp0.." || goto :folder_error
where node >nul 2>nul
if errorlevel 1 goto :node_missing
node -e "const v=process.versions.node.split('.').map(Number); if(v[0] < 22 || (v[0] === 22 && v[1] < 13)) process.exit(1);" >nul 2>nul
if errorlevel 1 goto :node_version
title Prima Colazione - Prova locale LOGO!
echo SIMULAZIONE LOCALE - nessun dato viene inviato al gestionale.
echo Atteso: articolo A 200 cartoni, articolo B 150, totale 350.
echo.
node bridge/simulate.mjs

set "bridgeExit=%ERRORLEVEL%"
echo.
if not "%bridgeExit%"=="0" echo Operazione non completata. Leggi il messaggio sopra.
pause
popd
exit /b %bridgeExit%

:node_missing
echo Node.js non trovato. Occorre Node.js 22.13 o superiore sul PC.
echo Chiedi al tecnico di installarlo dal sito ufficiale nodejs.org.
pause
popd
exit /b 1

:node_version
echo La versione disponibile di Node.js non e' compatibile.
echo Occorre Node.js 22.13 o superiore. Chiedi al tecnico di verificarla.
pause
popd
exit /b 1

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1
