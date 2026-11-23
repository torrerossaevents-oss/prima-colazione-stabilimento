# Avvio automatico del ponte e backup giornaliero con l'Utilita' di pianificazione di Windows.
# Uso (dal file INSTALLA-AVVIO-AUTOMATICO.cmd o RIMUOVI-AVVIO-AUTOMATICO.cmd):
#   powershell -NoProfile -ExecutionPolicy Bypass -File avvio-automatico.ps1 -Azione Installa | Rimuovi | Stato | Controlla
# Controlla: rifiuta una cartella temporanea (file aperto da dentro lo ZIP), una chiavetta o un'unita' di rete.
# Le attivita' girano con l'utente attuale, all'accesso a Windows, finestra ridotta a icona.
# Nessuna password viene chiesta o salvata; nessuna impostazione di sicurezza di Windows viene cambiata.
param([ValidateSet('Installa', 'Rimuovi', 'Stato', 'Controlla')][string]$Azione = 'Stato')
$ErrorActionPreference = 'Stop'
$bridge = $PSScriptRoot
$taskPonte = 'Prima Colazione Ponte'
$taskBackup = 'Prima Colazione Backup ponte'

function Show-State {
  foreach ($name in $taskPonte, $taskBackup) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
      $info = Get-ScheduledTaskInfo -TaskName $name
      Write-Host ("{0}: {1}, ultima esecuzione {2}, prossima {3}" -f $name, $task.State, $info.LastRunTime, $info.NextRunTime)
    } else { Write-Host ("{0}: non installata" -f $name) }
  }
}

function Find-RunningBridge {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*service.mjs*--impianto*' }
}

function Assert-Location {
  $here = $bridge.TrimEnd('\') + '\'
  $suggested = Join-Path $env:USERPROFILE 'PonteLOGO'
  $temps = @([IO.Path]::GetTempPath(), $env:TEMP, $env:TMP) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') + '\' }
  $inTemp = @($temps | Where-Object { $here.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
  if ($inTemp -or $here -match '\.zip\\') {
    throw "ESTRAI PRIMA LO ZIP. Questo file e' stato aperto da dentro lo ZIP (cartella temporanea $bridge). Clic destro sul file ZIP > Estrai tutto, nella cartella $suggested, poi lancia INSTALLA-AVVIO-AUTOMATICO.cmd dalla cartella estratta."
  }
  $root = [IO.Path]::GetPathRoot($bridge)
  if ($root.StartsWith('\\')) {
    throw "La cartella del ponte e' in rete ($root). Copia la cartella prima-colazione-logo in $suggested e lancia il file da li'."
  }
  $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $root.TrimEnd('\') + "'") -ErrorAction SilentlyContinue
  if ($disk -and ($disk.DriveType -eq 2 -or $disk.DriveType -eq 4)) {
    throw "La cartella del ponte e' su una chiavetta o su un'unita' di rete ($root). Copia la cartella prima-colazione-logo in $suggested e lancia il file da li': il ponte deve restare sul disco del PC."
  }
}

if ($Azione -eq 'Stato') { Show-State; exit 0 }
if ($Azione -eq 'Controlla') { Assert-Location; exit 0 }

if ($Azione -eq 'Rimuovi') {
  foreach ($name in $taskPonte, $taskBackup) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Host "Rimossa: $name"
    }
  }
  Write-Host "Il ponte non partira' piu' da solo. Se e' in funzione continua finche' non lo fermi."
  Write-Host 'Per avviarlo a mano: AVVIA-SERVIZIO-IMPIANTO.cmd.'
  exit 0
}

Assert-Location
foreach ($file in 'ponte.local.json', 'token.local.json', 'AVVIA-SERVIZIO-IMPIANTO.cmd', 'BACKUP-ARCHIVIO.cmd') {
  if (-not (Test-Path (Join-Path $bridge $file))) { throw "Manca bridge\$file. Completa la configurazione del ponte prima di attivare l'avvio automatico." }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js non trovato nel Path di questo utente: aggiungilo come descritto nella guida, poi riprova." }
if (Find-RunningBridge) {
  throw "Il ponte e' gia' in funzione (finestra aperta a mano?). Chiudi quella finestra con Ctrl+C e S, poi rilancia questo file."
}

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

$start = Join-Path $bridge 'AVVIA-SERVIZIO-IMPIANTO.cmd'
$actionPonte = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $bridge -Argument ('/s /c "start "Prima Colazione - Ponte automatico" /min "' + $start + '" /automatico"')
$triggerPonte = New-ScheduledTaskTrigger -AtLogOn -User $user
$settingsPonte = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskPonte -Action $actionPonte -Trigger $triggerPonte -Settings $settingsPonte -Principal $principal -Description "Avvia il ponte LOGO! - gestionale all'accesso di $user (riprova da solo ogni 60 s se si ferma)." -Force | Out-Null
Write-Host "Installata: $taskPonte (all'accesso di $user)"

$backup = Join-Path $bridge 'BACKUP-ARCHIVIO.cmd'
$actionBackup = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $bridge -Argument ('/s /c ""' + $backup + '" /automatico"')
$triggerBackup = New-ScheduledTaskTrigger -Daily -At '13:10'
$settingsBackup = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskBackup -Action $actionBackup -Trigger $triggerBackup -Settings $settingsBackup -Principal $principal -Description 'Copia giornaliera dell archivio del ponte; restano gli ultimi 30 backup.' -Force | Out-Null
Write-Host "Installata: $taskBackup (ogni giorno alle 13:10, o appena possibile se il PC era spento)"

Start-ScheduledTask -TaskName $taskPonte
Write-Host ''
Write-Host "Ponte avviato ora in automatico: trovi la finestra ridotta a icona sulla barra delle applicazioni."
Write-Host 'Tra 30 secondi controlla STATO-PONTE.cmd e, nel gestionale, Configurazione > Dispositivi: deve risultare Attivo.'
Show-State
