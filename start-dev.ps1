# Starts the Vite dev server detached, so it survives the calling shell.
$log = Join-Path $PSScriptRoot "vite-dev.log"

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npx vite --port 5199 --strictPort > `"$log`" 2>&1" `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -PassThru | Select-Object Id, ProcessName

Start-Sleep -Seconds 4
Get-Content $log -ErrorAction SilentlyContinue
