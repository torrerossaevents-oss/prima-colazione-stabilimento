@echo off
setlocal
rem IMPIANTO: legge il LOGO! configurato e invia al gestionale.
rem Richiede bridge\ponte.local.json completo e bridge\token.local.json (esclusi da Git).
rem Con il parametro /automatico (Utilita' di pianificazione) non chiede nulla, scrive
rem solo i messaggi di avvio/errore in bridge\data\impianto\avvio-automatico.log (il log completo e' in
rem bridge\data\impianto\log) e riparte dopo 60 s se si ferma con errore.
pushd "%~dp0.." || goto :folder_error
call "%~dp0_verifica-node.cmd" || goto :end_error
if not exist "bridge\ponte.local.json" goto :config_missing
if not exist "bridge\token.local.json" goto :token_missing
if /i "%~1"=="/automatico" goto :automatic
title Prima Colazione - Ponte IMPIANTO
echo IMPIANTO - lettura del LOGO! e invio al gestionale.
echo Il conteggio non sostituisce arresti o dispositivi di sicurezza della macchina.
echo Per fermare: Ctrl+C, poi rispondere S alla domanda di Windows.
echo.
node --disable-warning=ExperimentalWarning "bridge\service.mjs" --impianto
set "bridgeExit=%ERRORLEVEL%"
echo.
if not "%bridgeExit%"=="0" echo Servizio fermato con errore. Leggi il messaggio sopra e il log in bridge\data\impianto\log.
pause
popd
exit /b %bridgeExit%

:automatic
if not exist "bridge\data\impianto" mkdir "bridge\data\impianto"
:automatic_loop
echo %DATE% %TIME% avvio automatico>> "bridge\data\impianto\avvio-automatico.log"
node --disable-warning=ExperimentalWarning "bridge\service.mjs" --impianto --silenzioso >> "bridge\data\impianto\avvio-automatico.log" 2>&1
if "%ERRORLEVEL%"=="0" goto :automatic_end
timeout /t 60 /nobreak >nul
goto :automatic_loop
:automatic_end
popd
exit /b 0

:config_missing
echo Manca bridge\ponte.local.json.
echo Copiare bridge\ponte.config.example.json in bridge\ponte.local.json e farlo compilare dal tecnico.
goto :end_error

:token_missing
echo Manca bridge\token.local.json con il token del dispositivo.
echo Copiare bridge\token.example.json in bridge\token.local.json e incollare il token creato in Configurazione.
goto :end_error

:end_error
if /i "%~1"=="/automatico" (popd & exit /b 1)
pause
popd
exit /b 1

:folder_error
echo Impossibile aprire la cartella del pacchetto. Estrai prima tutto il file ZIP.
pause
exit /b 1
