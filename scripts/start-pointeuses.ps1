$ErrorActionPreference = 'Stop'
$mycProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mycHeaders = @{ Origin = 'https://d-rh-hn7b.vercel.app' }
try {
    $mycHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $mycHeaders -TimeoutSec 2
    if ($mycHealth.protocol -eq 'myc-pointage-bridge-v1') {
        Write-Output 'Le connecteur MYC fonctionne deja sur ce PC.'
        exit 0
    }
} catch { }

if (-not (Test-Path -LiteralPath (Join-Path $mycProject '.pointage-tools\python\zk'))) {
    throw 'Executez npm run pointeuses:setup avant de demarrer le connecteur.'
}
$mycNode = (Get-Command node -ErrorAction Stop).Source
$mycBridge = Join-Path $PSScriptRoot 'pointeuses-bridge.mjs'
$mycLogDirectory = Join-Path $mycProject '.pointage-tools\logs'
$null = New-Item -ItemType Directory -Path $mycLogDirectory -Force
$mycProcess = Start-Process -FilePath $mycNode -ArgumentList @('"' + $mycBridge + '"') `
    -WorkingDirectory $mycProject -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $mycLogDirectory 'bridge.log') `
    -RedirectStandardError (Join-Path $mycLogDirectory 'bridge-error.log')
for ($mycAttempt = 0; $mycAttempt -lt 20; $mycAttempt++) {
    Start-Sleep -Milliseconds 250
    if ($mycProcess.HasExited) { throw 'Le connecteur ne peut pas demarrer. Consulter .pointage-tools\logs\bridge-error.log.' }
    try {
        $mycHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $mycHeaders -TimeoutSec 1
        if ($mycHealth.protocol -eq 'myc-pointage-bridge-v1') {
            Write-Output ('Connecteur MYC demarre en arriere-plan (PID ' + $mycProcess.Id + ').')
            exit 0
        }
    } catch { }
}
throw 'Le connecteur ne repond pas encore. Consulter les journaux locaux.'
