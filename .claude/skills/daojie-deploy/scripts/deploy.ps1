# deploy.ps1 - one-shot production deploy for daojie-yusheng (LXC 192.168.0.191)
# Usage: pwsh -File deploy.ps1 [-Target server|client|both] [-Ref HEAD] [-DryRun] [-SkipVerify]
# Credentials are read from <RepoRoot>/.env/pve.env (gitignored, never commit).
# NOTE: git archive only packs COMMITTED content. Commit and push BEFORE deploying.

param(
  [ValidateSet('server', 'client', 'both')]
  [string]$Target = 'both',
  [string]$Ref = 'HEAD',
  [switch]$DryRun,
  [switch]$SkipVerify,
  # repo root = four levels up from this script (<repo>/.claude/skills/daojie-deploy/scripts/)
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\')).Path
)

$ErrorActionPreference = 'Stop'

# -- environment constants ---------------------------------------------
$HostKey = 'ssh-ed25519 255 BIrLOS6gElJJ08pEYO4nvIBvRInllRlUYtOlKoLlkVw'
$RemoteSrc = '/opt/daojie/src'
$RemoteTar = '/tmp/daojie-src.tar.gz'
$RemoteBuildLog = '/tmp/daojie-build.log'
$HealthUrl = 'http://192.168.0.191:13001/health'
$LiveUrl = 'http://192.168.0.191:13001/live'
$WebUrl = 'http://192.168.0.191:11921/'
$PollIntervalSec = 30
$BuildTimeoutSec = 1800

function Resolve-WinSCP {
  $cmd = Get-Command winscp.com -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # convenience fallback for this workstation only; other clones rely on PATH
  $fallback = 'C:\Users\code_base_new\AppData\Local\Programs\WinSCP\WinSCP.com'
  if (Test-Path $fallback) { return $fallback }
  throw 'winscp.com not found on PATH or fallback location'
}

function Read-PveEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) { throw "pve.env not found: $Path" }
  $map = @{}
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$') { $map[$Matches[1]] = $Matches[2] }
  }
  foreach ($key in @('LXC_HOST', 'LXC_SSH_USER', 'LXC_SSH_PASSWORD')) {
    if (-not $map[$key]) { throw "pve.env missing key: $key" }
  }
  return $map
}

function Invoke-WinSCP {
  param([string]$ScriptPath)
  $winscp = Resolve-WinSCP
  $output = & $winscp /script="$ScriptPath" 2>&1
  $text = $output -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "WinSCP script failed (exit $LASTEXITCODE): $ScriptPath`n$text"
  }
  return $text
}

function Write-WinSCPScript {
  param([string[]]$Lines, [string]$Name)
  $dir = Join-Path $env:TEMP 'daojie-deploy'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $path = Join-Path $dir $Name
  $content = ($Lines -join "`r`n") + "`r`n"
  # ASCII-only content; write plain to keep encoding irrelevant
  [System.IO.File]::WriteAllText($path, $content, [System.Text.ASCIIEncoding]::new())
  return $path
}

# -- step 0: credentials + archive -------------------------------------
$envMap = Read-PveEnv -Path (Join-Path $RepoRoot '.env\pve.env')
$LxcHost = $envMap['LXC_HOST']
$LxcUser = $envMap['LXC_SSH_USER']
$LxcPass = $envMap['LXC_SSH_PASSWORD']

Write-Host "[1/6] git archive $Ref -> daojie-src.tar.gz"
$tarPath = Join-Path $RepoRoot 'daojie-src.tar.gz'
git -C $RepoRoot archive --format=tar.gz -o $tarPath $Ref
if ($LASTEXITCODE -ne 0) { throw 'git archive failed (commit your changes first)' }
$tarMb = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
Write-Host "      tarball: $tarMb MB"

$targets = if ($Target -eq 'both') { @('server', 'client') } else { @($Target) }
$buildChain = ($targets | ForEach-Object { "docker build -f packages/$($_)/Dockerfile -t daojie-$($_):lxc ." }) -join ' && '
# DOCKER_BUILDKIT=1 讓 --mount=type=cache 生效（Docker 20.10 預設關閉）
$remoteBuildCmd = "cd $RemoteSrc && export DOCKER_BUILDKIT=1 && $buildChain"

Write-Host "[plan] target=$Target ref=$Ref"
Write-Host "[plan] remote build chain: $buildChain"
if ($DryRun) { Remove-Item $tarPath -Force; Write-Host '[DryRun] stop before remote operations.'; exit 0 }

# -- step 1: upload + unpack + kick build ------------------------------
Write-Host "[2/6] upload tarball to $LxcHost"
$openLine = "open sftp://$LxcHost/ -username=$LxcUser -password=`"$LxcPass`" -hostkey=`"$HostKey`""
$uploadScript = Write-WinSCPScript -Name '01-upload.txt' -Lines @(
  'option batch abort',
  $openLine,
  "put `"$tarPath`" `"$RemoteTar`"",
  "call stat $RemoteTar",
  'exit'
)
Invoke-WinSCP -ScriptPath $uploadScript | Out-Null
Remove-Item $tarPath -Force

Write-Host "[3/6] unpack + start docker build ($($targets -join ', ')) in background"
$buildScript = Write-WinSCPScript -Name '02-build.txt' -Lines @(
  'option batch abort',
  $openLine,
  "call rm -rf $RemoteSrc",
  "call mkdir -p $RemoteSrc",
  "call tar -xzf $RemoteTar -C $RemoteSrc",
  "call rm -f $RemoteBuildLog",
  "call nohup bash -c '$remoteBuildCmd' > $RemoteBuildLog 2>&1 & echo BUILD_STARTED",
  'exit'
)
Invoke-WinSCP -ScriptPath $buildScript | Out-Null
Start-Sleep -Seconds 15  # let docker build process spawn before first pgrep poll

# -- step 2: poll build until all images tagged or build process dies --
Write-Host "[4/6] polling build log (interval ${PollIntervalSec}s, timeout ${BuildTimeoutSec}s)"
$deadline = (Get-Date).AddSeconds($BuildTimeoutSec)
$statusLine = "call echo `"STATUS PGREP=`$(pgrep -fc 'docker build') SRV=`$(grep -cE 'Successfully tagged daojie-server:lxc|naming to docker.io/library/daojie-server:lxc' $RemoteBuildLog) CLI=`$(grep -cE 'Successfully tagged daojie-client:lxc|naming to docker.io/library/daojie-client:lxc' $RemoteBuildLog)`""
$pollScript = Write-WinSCPScript -Name '03-poll.txt' -Lines @(
  'option batch continue',
  $openLine,
  $statusLine,
  'exit'
)
while ($true) {
  $out = Invoke-WinSCP -ScriptPath $pollScript
  if ($out -notmatch 'STATUS PGREP=(\d+) SRV=(\d+) CLI=(\d+)') {
    throw "unexpected poll output: $($out -join ' ')"
  }
  $running = [int]$Matches[1] -gt 0
  $srvTagged = [int]$Matches[2] -ge 1
  $cliTagged = [int]$Matches[3] -ge 1
  $serverDone = ($targets -notcontains 'server') -or $srvTagged
  $clientDone = ($targets -notcontains 'client') -or $cliTagged
  if ($serverDone -and $clientDone) { Write-Host '      build OK'; break }
  if (-not $running) {
    $failScript = Write-WinSCPScript -Name '04-failtail.txt' -Lines @(
      'option batch abort', $openLine, "call tail -30 $RemoteBuildLog", 'exit'
    )
    Invoke-WinSCP -ScriptPath $failScript | Write-Host
    throw "docker build process exited without tagging all targets (log: $LxcHost`:$RemoteBuildLog)"
  }
  if ((Get-Date) -gt $deadline) { throw "build timeout after ${BuildTimeoutSec}s (log: $RemoteBuildLog)" }
  Write-Host '      building...'
  Start-Sleep -Seconds $PollIntervalSec
}

# -- step 3: rerun deploy script (idempotent) --------------------------
Write-Host '[5/6] run /opt/daojie/lxc-deploy.sh (recreates 4 containers)'
$deployScript = Write-WinSCPScript -Name '05-deploy.txt' -Lines @(
  'option batch abort',
  $openLine,
  'call bash /opt/daojie/lxc-deploy.sh 2>&1 | tail -15',
  'exit'
)
$deployOut = Invoke-WinSCP -ScriptPath $deployScript
Write-Host $deployOut
if ($deployOut -notmatch 'DEPLOY_DONE') { throw 'lxc-deploy.sh did not print DEPLOY_DONE' }

# -- step 3b: prune dangling layers AFTER new containers are running ----
# lxc-deploy.sh already prunes; this is a logged safety net.
# Only dangling (untagged) images + dangling build cache; never tagged images.
Write-Host '[5b/6] prune dangling Docker images / build cache on LXC (best-effort)'
$pruneScript = Write-WinSCPScript -Name '05b-prune.txt' -Lines @(
  'option batch continue',
  $openLine,
  'call echo PRUNE_BEFORE',
  'call df -h /',
  'call docker system df',
  'call docker image prune -f',
  'call docker builder prune -f',
  'call echo PRUNE_AFTER',
  'call df -h /',
  'call docker system df',
  'exit'
)
try {
  $pruneOut = Invoke-WinSCP -ScriptPath $pruneScript
  Write-Host $pruneOut
} catch {
  Write-Host "      [warn] prune step failed (non-fatal): $_" -ForegroundColor Yellow
}

# -- step 4: verify from local machine ---------------------------------
if ($SkipVerify) { Write-Host '[6/6] verification skipped'; exit 0 }
Write-Host '[6/6] verify health / live / web + server log'
$fail = @()
foreach ($pair in @(@('health', $HealthUrl), @('live', $LiveUrl), @('web', $WebUrl))) {
  $code = & curl.exe -s -o NUL -w '%{http_code}' $pair[1]
  Write-Host "      $($pair[0]) = $code"
  if ($code -ne '200') { $fail += $pair[0] }
}
if ($fail.Count -gt 0) { throw "verify failed: $($fail -join ', ') not 200" }

$logScript = Write-WinSCPScript -Name '06-logcheck.txt' -Lines @(
  'option batch continue', $openLine,
  'call docker logs daojie-server --since 3m 2>&1 | grep -iE "warn|error" | head -5',
  'exit'
)
$logOut = (Invoke-WinSCP -ScriptPath $logScript) -split "`n" | Where-Object { $_ -match 'warn|error' }
if ($logOut) { Write-Host '      [warn] recent server log warnings:' -ForegroundColor Yellow; $logOut | ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow } }
else { Write-Host '      server log clean (3m)' }

Write-Host 'DEPLOY SUCCESS' -ForegroundColor Green
exit 0
