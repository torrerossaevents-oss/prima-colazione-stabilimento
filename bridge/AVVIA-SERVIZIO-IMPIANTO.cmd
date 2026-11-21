@echo off
setlocal
rem IMPIANTO: legge il LOGO! configurato e invia al gestionale.
rem Richiede bridge\ponte.local.json completo e bridge\token.local.json (esclusi da Git).
rem Con il parametro /automatico (avvio automatico, vedi INSTALLA-AVVIO-AUTOMATICO.cmd) non chiede nulla,
rem scrive ogni avvio ed ogni errore in bridge\data\impianto\avvio-automatico.log (il log completo e' in
rem bridge\data\impianto\log) e riprova dopo 60 s se il servizio si ferma con errore.
pushd "%~dp0.." || goto :folder_error
if /i "%~1"=="/automatico" goto :automatic
call "%~dp0_verifica-node.cmd" || goto :end_error
if not exist "bridge\ponte.local.json" goto :config_missing
if not exist "bridge\token.local.json" goto :token_missing
title Prima Colazione - Ponte IMPIANTO
echo IMPIANTO - lettura del LOGO! e invio al gestionale.
echo Il conteggio non sostituisce arresti o dispositivi di sicurezza della macchina.
echo Per fermare: Ctrl+C, poi rispondere S alla domanda di Windows.
echo Non cliccare dentro questa finestra: un clic la mette in pausa.
echo.
node --disable-warning=ExperimentalWarning "bridge\service.mjs" --impianto
set "bridgeExit=%ERRORLEVEL%"
echo.
if not "%bridgeExit%"=="0" echo Servizio fermato con errore. Leggi il messaggio sopra e il log in bridge\data\impianto\log.
pause
popd
exit /b %bridgeExit%

:automatic
title Prima Colazione - Ponte automatico
if not exist "bridge\data\impianto" mkdir "bridge\data\impianto"
set "AUTOLOG=bridge\data\impianto\avvio-automatico.log"
:automatic_loop
echo %DATE% %TIME% avvio automatico>> "%AUTOLOG%"
call "%~dp0_verifica-node.cmd" >> "%AUTOLOG%" 2>&1
if errorlevel 1 goto :automatic_wait
if not exist "bridge\ponte.local.json" echo %DATE% %TIME% ERRORE: manca bridge\ponte.local.json>> "%AUTOLOG%"
if not exist "bridge\ponte.local.json" goto :automatic_wait
if not exist "bridge\token.local.json" echo %DATE% %TIME% ERRORE: manca bridge\token.local.json>> "%AUTOLOG%"
if not exist "bridge\token.local.json" goto :automatic_wait
node --disable-warning=ExperimentalWarning "bridge\service.mjs" --impianto --silenzioso >> "%AUTOLOG%" 2>&1
if "%ERRORLEVEL%"=="0" goto :automatic_end
:automatic_wait
echo %DATE% %TIME% servizio non in funzione: nuovo tentativo tra 60 secondi>> "%AUTOLOG%"
timeout /t 60 /nobreak >nul
goto :automatic_loop
:automatic_end
echo %DATE% %TIME% servizio fermato senza errori>> "%AUTOLOG%"
popd
exit /b 0

:config_missing
echo Manca bridge\ponte.local.json.
echo Copiare bridge\ponte.config.24ce.json in bridge\ponte.local.json e completarlo.
goto :end_error

:token_missing
echo Manca bridge\token.local.json con il token del dispositivo.
echo Copiare bridge\token.example.json in bridge\token.local.json e incollare il token creato in Configurazione.
goto :end_error

:end_error
pause
popd
exit /b 1

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
if /i "%~1"=="/automatico" exit /b 1
pause
exit /b 1
