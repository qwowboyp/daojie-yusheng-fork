# Canonical client hot-static release wrapper.
# Modes: publish (default), bootstrap, recovery-source-build.
# Publish/bootstrap never fall back to recovery. DryRun is credential-free.
param(
  [ValidateSet('publish', 'bootstrap', 'recovery-source-build')]
  [string]$Mode = 'publish',
  [string]$Ref = 'HEAD',
  [string[]]$Proof,
  [string]$KnownHosts,
  [string]$AdoptCommit,
  [string]$ExpectedImage,
  [string]$Output,
  [string]$EnvFile,
  [switch]$DryRun,
  [switch]$SkipVerify,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$canonicalEntrypoint = 'scripts/client-release/deploy.ps1'

function Get-Proofs {
  param($Proof)
  return @(@($Proof) | Where-Object { $_ -and "$_".Trim() })
}

function Resolve-HeadCommit {
  param([string]$RepoRoot, [string]$Ref)
  $resolved = git -C $RepoRoot rev-parse --verify --end-of-options "$Ref^{commit}"
  if ($LASTEXITCODE -ne 0) { throw 'invalid-ref' }
  $resolved = ([string]$resolved).Trim()
  if ($resolved -notmatch '^[a-f0-9]{40}$') { throw 'invalid-ref' }
  $head = ([string](git -C $RepoRoot rev-parse --verify HEAD)).Trim()
  if ($resolved -ne $head) { throw 'ref-not-head' }
  return $resolved
}

function Resolve-OutputRoot {
  param([string]$RepoRoot, [string]$Output)
  $releases = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot '.runtime\releases'))
  if ($Output) {
    if ([System.IO.Path]::IsPathRooted($Output)) {
      $resolved = [System.IO.Path]::GetFullPath($Output)
    } else {
      $resolved = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Output))
    }
  } else {
    $resolved = $releases
  }
  $prefix = $releases.TrimEnd('\') + '\'
  if ($resolved -ne $releases -and -not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'output-outside-releases'
  }
  return $resolved
}

function Resolve-RepoPath {
  param([string]$RepoRoot, [string]$Value)
  if (-not $Value) { return $Value }
  $trimmed = ([string]$Value).Trim()
  if (-not $trimmed) { return $trimmed }
  if ([System.IO.Path]::IsPathRooted($trimmed)) {
    return [System.IO.Path]::GetFullPath($trimmed)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $trimmed))
}

function Write-HotPlan {
  param([hashtable]$Plan)
  $ordered = [ordered]@{}
  foreach ($key in @(
      'ok', 'dryRun', 'mode', 'entrypoint', 'ref', 'resolvedRef', 'base', 'baseFrom', 'proofs',
      'expectedImage', 'phases', 'output', 'automaticFallback', 'envRead', 'sourceArchive',
      'sftpFullRepo', 'dockerBuild', 'containerRecreate', 'authorized'
    )) {
    if ($Plan.ContainsKey($key)) { $ordered[$key] = $Plan[$key] }
  }
  Write-Output ($ordered | ConvertTo-Json -Compress -Depth 6)
}

function Get-FinalJsonObject {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  $last = $null
  $n = $Text.Length
  $i = 0
  while ($i -lt $n) {
    if ($Text[$i] -ne '{') { $i++; continue }
    $depth = 0
    $inString = $false
    $escape = $false
    $j = $i
    while ($j -lt $n) {
      $ch = $Text[$j]
      if ($inString) {
        if ($escape) { $escape = $false; $j++; continue }
        if ($ch -eq '\') { $escape = $true; $j++; continue }
        if ($ch -eq '"') { $inString = $false }
        $j++; continue
      }
      if ($ch -eq '"') { $inString = $true; $j++; continue }
      if ($ch -eq '{') { $depth++ }
      elseif ($ch -eq '}') {
        $depth--
        if ($depth -eq 0) {
          $slice = $Text.Substring($i, $j - $i + 1)
          try { $last = $slice | ConvertFrom-Json -ErrorAction Stop } catch { }
          break
        }
      }
      $j++
    }
    $i++
  }
  return $last
}

function Test-MissingHotStatic {
  param($Json)
  if ($null -eq $Json) { return $false }
  $artifact = [string]$Json.currentArtifact
  $commit = [string]$Json.liveCommit
  if ($artifact -and $commit) { return $false }
  $errorText = [string]$Json.error
  return [bool]($errorText -match '(?i)current')
}

function Write-BootstrapGuidance {
  Write-Host 'bootstrap-required'
  Write-Host 'example: pwsh -NoProfile -File scripts/client-release/deploy.ps1 -Mode bootstrap -Proof <proof> -KnownHosts <known_hosts> -AdoptCommit <40-hex> -ExpectedImage sha256:<64-hex>'
  Write-Host 'no automatic fallback to recovery-source-build'
}

function Invoke-Native {
  param([string]$File, [string[]]$Arguments)
  $lines = New-Object System.Collections.Generic.List[string]
  & $File @Arguments | ForEach-Object {
    $text = [string]$_
    [void]$lines.Add($text)
    Write-Host $text
  }
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
  return [pscustomobject]@{
    ExitCode = $code
    Output = [string]::Join("`n", $lines)
  }
}

$proofs = Get-Proofs -Proof $Proof
$hot = $Mode -eq 'publish' -or $Mode -eq 'bootstrap'
if ($hot) {
  if ($proofs.Count -lt 1) { throw 'missing-proof' }
  if (-not $KnownHosts -or -not ([string]$KnownHosts).Trim()) { throw 'missing-known-hosts' }
  if ($SkipVerify) { throw 'skip-verify-rejected' }
}
if ($Mode -eq 'bootstrap') {
  if ($AdoptCommit -notmatch '^[a-f0-9]{40}$') { throw 'missing-bootstrap-identities' }
  if ($ExpectedImage -notmatch '^sha256:[a-f0-9]{64}$') { throw 'missing-bootstrap-identities' }
}

$resolvedRef = Resolve-HeadCommit -RepoRoot $RepoRoot -Ref $Ref
$outputRoot = Resolve-OutputRoot -RepoRoot $RepoRoot -Output $Output
$knownHostsPath = if ($KnownHosts) { Resolve-RepoPath -RepoRoot $RepoRoot -Value $KnownHosts } else { $KnownHosts }
$envPath = if ($EnvFile) {
  Resolve-RepoPath -RepoRoot $RepoRoot -Value $EnvFile
} else {
  [System.IO.Path]::GetFullPath((Join-Path $RepoRoot '.env\pve.env'))
}

if ($DryRun) {
  $plan = @{
    ok = $true
    dryRun = $true
    mode = $Mode
    entrypoint = $canonicalEntrypoint
    ref = $Ref
    resolvedRef = $resolvedRef
    proofs = @($proofs)
    output = $outputRoot
    automaticFallback = $false
    envRead = $false
  }
  if ($Mode -eq 'publish') {
    $plan.baseFrom = 'preflight.liveCommit'
    $plan.phases = @('preflight', 'plan', 'prepare', 'remote-plan', 'remote-publish')
    $plan.sourceArchive = $false
    $plan.sftpFullRepo = $false
    $plan.dockerBuild = $false
    $plan.containerRecreate = $false
  } elseif ($Mode -eq 'bootstrap') {
    $plan.base = $AdoptCommit
    $plan.expectedImage = $ExpectedImage
    $plan.phases = @('plan', 'prepare', 'remote-plan', 'remote-bootstrap')
    $plan.sourceArchive = $false
    $plan.sftpFullRepo = $false
    $plan.dockerBuild = $false
    $plan.containerRecreate = $false
  } else {
    $plan.phases = @('legacy-source-archive', 'remote-sftp-full-repo', 'docker-build', 'container-recreate')
    $plan.sourceArchive = $true
    $plan.sftpFullRepo = $true
    $plan.dockerBuild = $true
    $plan.containerRecreate = $true
    $plan.authorized = $true
  }
  Write-HotPlan -Plan $plan
  exit 0
}

if ($hot -and -not (Test-Path -LiteralPath $knownHostsPath -PathType Leaf)) {
  throw 'missing-known-hosts'
}

if ($Mode -eq 'recovery-source-build') {
  $legacy = Join-Path $RepoRoot '.claude\skills\daojie-deploy\scripts\deploy.ps1'
  $recoveryArgs = @{
    Target = 'client'
    Ref = $Ref
    RepoRoot = $RepoRoot
    AllowClientSourceBuildRecovery = $true
  }
  if ($SkipVerify) { $recoveryArgs['SkipVerify'] = $true }
  & $legacy @recoveryArgs
  exit $LASTEXITCODE
}

$planScript = Join-Path $RepoRoot 'scripts\client-release\plan.mjs'
$prepareScript = Join-Path $RepoRoot 'scripts\client-release\prepare.mjs'
$publishScript = Join-Path $RepoRoot 'scripts\client-release\remote_publish.py'
$proofArgs = @()
foreach ($item in $proofs) { $proofArgs += @('--proof', $item) }

if ($Mode -eq 'publish') {
  $preflightScript = Join-Path $RepoRoot 'scripts\client-release\preflight.py'
  $preflight = Invoke-Native -File python -Arguments @('-B', '-X', 'utf8', $preflightScript, '--checkout', $RepoRoot, '--env-file', $envPath, '--known-hosts', $knownHostsPath)
  $preflightJson = Get-FinalJsonObject -Text $preflight.Output
  if (Test-MissingHotStatic $preflightJson) {
    Write-BootstrapGuidance
    exit 1
  }
  if ($null -eq $preflightJson) { throw 'preflight-failed' }
  if ($preflight.ExitCode -ne 0 -or -not $preflightJson.ready) {
    $preflightError = [string]$preflightJson.error
    if ($preflightError) { Write-Host $preflightError }
    throw 'preflight-failed'
  }
  $base = [string]$preflightJson.liveCommit
  $expectedCurrent = [string]$preflightJson.currentArtifact
  if (-not $base -or -not $expectedCurrent) { throw 'preflight-failed' }
} else {
  $base = $AdoptCommit
}

$planArgs = @($planScript, '--base', $base, '--ref', $Ref) + $proofArgs
$planResult = Invoke-Native -File node -Arguments $planArgs
if ($planResult.ExitCode -ne 0) { throw 'plan-failed' }

$prepareArgs = @($prepareScript, '--base', $base, '--ref', $Ref, '--output', $outputRoot) + $proofArgs
$prepareResult = Invoke-Native -File node -Arguments $prepareArgs
if ($prepareResult.ExitCode -ne 0) { throw 'prepare-failed' }
$prepareJson = Get-FinalJsonObject -Text $prepareResult.Output
if ($null -eq $prepareJson) { throw 'prepare-failed' }
$bundle = [string]$prepareJson.artifactDir
if (-not $bundle) { throw 'prepare-failed' }

$remotePlan = Invoke-Native -File python -Arguments @($publishScript, '--mode', 'plan', '--bundle', $bundle, '--env-file', $envPath, '--known-hosts', $knownHostsPath)
if ($remotePlan.ExitCode -ne 0) { throw 'remote-plan-failed' }

if ($Mode -eq 'publish') {
  $remotePublish = Invoke-Native -File python -Arguments @(
    $publishScript, '--mode', 'publish', '--bundle', $bundle,
    '--expected-current', $expectedCurrent, '--env-file', $envPath, '--known-hosts', $knownHostsPath, '--execute'
  )
} else {
  $remotePublish = Invoke-Native -File python -Arguments @(
    $publishScript, '--mode', 'bootstrap', '--bundle', $bundle,
    '--expected-image', $ExpectedImage, '--adopt-commit', $AdoptCommit,
    '--env-file', $envPath, '--known-hosts', $knownHostsPath, '--execute'
  )
}
if ($remotePublish.ExitCode -ne 0) { throw 'remote-publish-failed' }
Write-Output $remotePublish.Output
exit 0
