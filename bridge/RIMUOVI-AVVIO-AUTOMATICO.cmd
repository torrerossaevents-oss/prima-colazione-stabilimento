@echo off
setlocal
rem Disattiva l'avvio automatico del ponte e il backup giornaliero. Non ferma un ponte gia' in funzione.
title Prima Colazione - Rimuovi avvio automatico
choice /C SN /N /M "Disattivare l'avvio automatico del ponte e il backup giornaliero? [S/N]: "
if errorlevel 2 goto :cancelled
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvio-automatico.ps1" -Azione Rimuovi
pause
exit /b 0

:cancelled
echo Nessuna modifica.
pause
exit /b 0
