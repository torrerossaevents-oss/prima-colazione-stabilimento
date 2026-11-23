@echo off
setlocal
rem Attiva l'avvio automatico del ponte all'accesso a Windows e il backup giornaliero.
rem Prima chiudere la finestra del ponte aperta a mano (Ctrl+C, poi S).
title Prima Colazione - Avvio automatico del ponte
rem Aperto da dentro lo ZIP Windows copia solo questo file in una cartella temporanea.
if not exist "%~dp0avvio-automatico.ps1" goto :notextracted
if not exist "%~dp0service.mjs" goto :notextracted
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvio-automatico.ps1" -Azione Controlla
if errorlevel 1 goto :stopped
echo AVVIO AUTOMATICO DEL PONTE
echo - il ponte partira' da solo quando questo utente accede a Windows, ridotto a icona;
echo - se si ferma per un errore riprova da solo ogni 60 secondi;
echo - ogni giorno alle 13:10 viene fatta una copia dell'archivio, restano le ultime 30.
echo Prima chiudi la finestra del ponte aperta a mano: Ctrl+C, poi S.
echo.
choice /C SN /N /M "Procedere? [S/N]: "
if errorlevel 2 goto :cancelled
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvio-automatico.ps1" -Azione Installa
if errorlevel 1 echo Operazione non completata. Leggi il messaggio sopra.
pause
exit /b 0

:cancelled
echo Nessuna modifica.
pause
exit /b 0

:notextracted
echo ESTRAI PRIMA LO ZIP.
echo Questo file e' stato aperto da dentro il file ZIP: cosi' non funziona.
echo 1. Chiudi questa finestra.
echo 2. Clic destro sul file ZIP, poi "Estrai tutto", nella cartella PonteLOGO del tuo utente.
echo 3. Apri la cartella estratta, poi bridge, e lancia da li' INSTALLA-AVVIO-AUTOMATICO.cmd.
echo Nessuna modifica.
pause
exit /b 1

:stopped
echo Nessuna modifica. Leggi il messaggio sopra.
pause
exit /b 1
