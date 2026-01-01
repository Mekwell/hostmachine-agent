# Fixed ARK: Ascended entrypoint for Windows Docker
$SteamCmd = "C:\steamcmd\steamcmd.exe"

Write-Host ">>> Ensuring SteamCMD is up to date..."
Start-Process $SteamCmd -ArgumentList "+quit" -Wait

Write-Host ">>> Synchronizing ARK: Ascended via SteamCMD (App 2430930)..."

# Create script file
$SyncScript = @"
force_install_dir C:\data
login anonymous
app_set_config 2430930 modbranch public
app_update 2430930 validate
quit
"@
$SyncScript | Out-File -FilePath C:\sync_script.txt -Encoding ascii

# Run synchronization
Start-Process $SteamCmd -ArgumentList "+runscript C:\sync_script.txt" -Wait

$BinPath = "C:\data\ShooterGame\Binaries\Win64\ArkAscendedServer.exe"

if (-not (Test-Path $BinPath)) {
    Write-Host "!!! CRITICAL: ARK: Ascended binary NOT FOUND at $BinPath !!!"
    exit 1
}

Write-Host ">>> ARK: Ascended binary synchronization COMPLETE."
Write-Host ">>> Starting ARK: Ascended Native Server..."

$Map = if ($env:MAP) { $env:MAP } else { "TheIsland_WP" }
$ServerName = if ($env:SERVER_NAME) { $env:SERVER_NAME } else { "HostMachine ASA Server" }
$AdminPassword = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { "admin123" }
$MaxPlayers = if ($env:MAX_PLAYERS) { $env:MAX_PLAYERS } else { 70 }

$Args = "$Map?listen?SessionName=$ServerName?ServerPassword=$AdminPassword?ServerAdminPassword=$AdminPassword -WinLiveMaxPlayers=$MaxPlayers -NoBattlEye -server -log -baseport=7777"

# Start the game server
Start-Process $BinPath -ArgumentList $Args -NoNewWindow -Wait