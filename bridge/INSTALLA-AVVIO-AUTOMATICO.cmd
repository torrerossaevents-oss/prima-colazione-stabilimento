@echo off
setlocal
rem Attiva l'avvio automatico del ponte all'accesso a Windows e il backup giornaliero.
rem Prima chiudere la finestra del ponte aperta a mano (Ctrl+C, poi S).
title Prima Colazione - Avvio automatico del ponte
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
