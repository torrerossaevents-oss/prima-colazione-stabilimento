@echo off
rem Controllo comune richiamato dagli altri file: Node.js 22.13 o superiore.
where node >nul 2>nul
if errorlevel 1 goto :missing
node -e "const v=process.versions.node.split('.').map(Number); if(v[0] < 22 || (v[0] === 22 && v[1] < 13)) process.exit(1);" >nul 2>nul
if errorlevel 1 goto :old
exit /b 0

:missing
echo Node.js non trovato. Occorre Node.js 22.13 o superiore sul PC.
echo Chiedi al tecnico di installarlo dal sito ufficiale nodejs.org.
exit /b 1

:old
echo La versione disponibile di Node.js non e' compatibile.
echo Occorre Node.js 22.13 o superiore. Chiedi al tecnico di verificarla.
exit /b 1
