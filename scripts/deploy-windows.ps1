$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd([char[]]"\/")
Set-Location $projectRoot

Write-Host ""
Write-Host "Moneymatters Windows/Plesk deployment" -ForegroundColor Cyan
Write-Host "Project root: $projectRoot"

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
    throw "package.json was not found in project root: $projectRoot"
}
if (-not (Test-Path (Join-Path $projectRoot 'package-lock.json'))) {
    throw "package-lock.json is missing; refusing to install an unpinned dependency tree."
}

$nodeVersionText = (& node -p "process.versions.node").Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Node.js is not available in this terminal."
}
try {
    $nodeVersion = [version]$nodeVersionText
} catch {
    throw "Unable to parse Node.js version '$nodeVersionText'."
}
if ($nodeVersion -lt [version]'24.18.1' -or $nodeVersion -ge [version]'25.0.0') {
    throw "This repository requires Node.js >=24.18.1 and <25. Detected $nodeVersionText."
}
Write-Host "Node.js $nodeVersionText verified." -ForegroundColor Green

# Stop only Node processes that appear to be serving this project's Next.js app.
# Do not terminate unrelated Node.js applications on a shared Windows host.
$runningAppProcesses = @(
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object {
            $commandLine = [string]$_.CommandLine
            $belongsToProject = $commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
            $looksLikeApplication = $commandLine -match '(?i)(server\.js|node_modules[\\/]+next[\\/]+dist[\\/]+server|next(?:\.cmd)?\s+(?:start|dev)|\.next[\\/]+server)'
            $belongsToProject -and $looksLikeApplication
        }
)

foreach ($process in $runningAppProcesses) {
    Write-Host "Stopping project Node.js process $($process.ProcessId) before replacing dependencies."
    try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
        throw "Could not stop project process $($process.ProcessId). Stop the mm.nilanga.in application pool in Plesk, then run this command again. Details: $($_.Exception.Message)"
    }
}

if ($runningAppProcesses.Count -gt 0) {
    Start-Sleep -Seconds 2
    $remainingIds = @($runningAppProcesses | ForEach-Object { $_.ProcessId })
    $remainingProcesses = @(
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
            Where-Object { $remainingIds -contains $_.ProcessId }
    )
    if ($remainingProcesses.Count -gt 0) {
        throw "Project Node.js processes are still running. Stop the website's application pool in Plesk and retry."
    }
}

# npm ci must remove node_modules. Do that only after scoped app processes stop,
# and fail with a clear message if antivirus/permissions still hold native DLLs.
$nodeModules = Join-Path $projectRoot 'node_modules'
if (Test-Path $nodeModules) {
    Write-Host "Removing existing node_modules after stopping project processes..."
    try {
        Remove-Item -LiteralPath $nodeModules -Recurse -Force -ErrorAction Stop
    } catch {
        throw "Could not remove node_modules. A process (often the Plesk application pool or antivirus) may still hold a native DLL, or the subscription lacks delete permission. Stop the mm.nilanga.in application pool in Plesk, check the file lock/permissions, then rerun. Details: $($_.Exception.Message)"
    }
}
if (Test-Path $nodeModules) {
    throw "node_modules still exists after cleanup. Refusing to continue with a partial dependency tree."
}

function Invoke-NpmStep {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string[]]$NpmArguments
    )
    Write-Host ""
    Write-Host "==> $Label" -ForegroundColor Cyan
    & npm @NpmArguments
    if ($LASTEXITCODE -ne 0) {
        $displayCommand = 'npm ' + ($NpmArguments -join ' ')
        throw "$displayCommand failed with exit code $LASTEXITCODE. Deployment has stopped; do not start the site until corrected."
    }
}

Invoke-NpmStep -Label 'Clean, lockfile-pinned dependency installation' -NpmArguments @('ci', '--no-audit', '--no-fund')
$nextBin = Join-Path $projectRoot 'node_modules\next\dist\bin\next'
if (-not (Test-Path $nextBin)) {
    throw "npm ci returned success but the Next.js CLI is missing at $nextBin. Check npm output and package-lock.json."
}

Invoke-NpmStep -Label 'TypeScript' -Arguments @('run', 'typecheck')
Invoke-NpmStep -Label 'ESLint' -Arguments @('run', 'lint')
# Do not run the integration/E2E suite on a live production Plesk instance:
# configured smoke-test fixtures can create financial transactions. CI owns test execution.
Invoke-NpmStep -Label 'Production build' -Arguments @('run', 'build')

Write-Host ""
Write-Host "Dependency install, typecheck, lint, and production build all passed. CI tests must pass before deploying this commit." -ForegroundColor Green
Write-Host "The site process was stopped for the clean install. Start/restart the mm.nilanga.in Node.js application in Plesk now." -ForegroundColor Yellow
