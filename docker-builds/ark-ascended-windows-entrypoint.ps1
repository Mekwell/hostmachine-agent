# HostMachine ARK: Survival Ascended Windows Entrypoint
$ServerName = $env:SERVER_NAME -ifnot $env:SERVER_NAME -then "HostMachine ASA Windows"
$Password = $env:PASSWORD
$AdminPassword = $env:ADMIN_PASSWORD -ifnot $env:ADMIN_PASSWORD -then "adminsecret"

Write-Host ">>> Synchronizing ARK: Ascended via SteamCMD (Windows)..."
& C:\steamcmd\steamcmd.exe +force_install_dir C:\data +login anonymous +app_update 2430930 validate +quit

$BinPath = "C:\data\ShooterGame\Binaries\Win64\ArkAscendedServer.exe"

if (-not (Test-Path $BinPath)) {
    Write-Error "!!! CRITICAL: ARK: Ascended binary NOT FOUND at $BinPath !!!"
    exit 1
}

Set-Location "C:\data\ShooterGame\Binaries\Win64"

$QueryStr = "TheIsland_WP?listen?SessionName=$ServerName"
if ($Password) {
    $QueryStr += "?ServerPassword=$Password"
}
$QueryStr += "?ServerAdminPassword=$AdminPassword"

Write-Host ">>> Starting ARK: Ascended ($ServerName)..."
# Start process and wait (exec equivalent in PS is usually direct call or Start-Process -Wait)
& .\ArkAscendedServer.exe "$QueryStr" -server -log -Port=7777 -QueryPort=27015
