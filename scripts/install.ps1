#Requires -RunAsAdministrator
<#
  Sets this PC up to run evenkeel around the clock (the same pattern as foodlab and sideshow):
    - writes .env (port, backup folder)
    - registers the "evenkeel" scheduled task: starts at boot, runs whether or not anyone is
      signed in, and restarts the server if it exits (scripts\run.cmd)
    - allows the port through Windows Firewall on private networks (LAN / Tailscale)
    - builds the app and starts it
  Run once from an admin PowerShell in the server's clone (C:\Apps\evenkeel):
    .\scripts\install.ps1 [-Port 8083] [-BackupDir <folder>]
  Safe to run again. A setting you leave out keeps its value from .env; on a first install it
  defaults to port 8083 and backups in data\backups.
  The mini PC uses: -Port 8083 -BackupDir \\evnas\Junk\Tech\DBBackups\evenkeel
#>
param(
  [int]$Port,
  # Daily database copies; keep them off this machine (NAS, OneDrive). "" = data\backups.
  [string]$BackupDir
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Only PORT and EVENKEEL_BACKUP_DIR are ours; keep every other line.
$envLines = @()
$current = @{}
if (Test-Path "$root\.env") {
  foreach ($line in Get-Content "$root\.env") {
    if ($line -match "^(PORT|EVENKEEL_BACKUP_DIR)=(.*)$") { $current[$Matches[1]] = $Matches[2] }
    else { $envLines += $line }
  }
}
if (-not $PSBoundParameters.ContainsKey("Port")) {
  $Port = if ($current.PORT) { [int]$current.PORT } else { 8083 }
}
if (-not $PSBoundParameters.ContainsKey("BackupDir")) {
  $BackupDir = if ($current.ContainsKey("EVENKEEL_BACKUP_DIR")) { $current.EVENKEEL_BACKUP_DIR } else { "" }
}
$envLines += "PORT=$Port"
if ($BackupDir) { $envLines += "EVENKEEL_BACKUP_DIR=$BackupDir" }
# No byte-order mark: Node would read it as part of the first key.
[IO.File]::WriteAllLines("$root\.env", $envLines, (New-Object Text.UTF8Encoding $false))
Write-Host "== .env" -ForegroundColor Cyan
$envLines | Where-Object { $_ -match "^(PORT|EVENKEEL_BACKUP_DIR)=" } | ForEach-Object { Write-Host "   $_" }

Write-Host "== scheduled task 'evenkeel'" -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$root\scripts\run.cmd`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName evenkeel -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "evenkeel server ($root)" -Force | Out-Null

Write-Host "== firewall (port $Port, private networks)" -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName "evenkeel" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "evenkeel" -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Profile Private -Action Allow | Out-Null

& "$PSScriptRoot\update.ps1" -NoPull
exit $LASTEXITCODE
