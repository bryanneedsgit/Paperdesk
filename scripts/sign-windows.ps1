param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'

function Resolve-SignTool {
  if ($env:PAPERDESK_SIGNTOOL_PATH) {
    if (Test-Path -LiteralPath $env:PAPERDESK_SIGNTOOL_PATH) {
      return (Resolve-Path -LiteralPath $env:PAPERDESK_SIGNTOOL_PATH).Path
    }

    throw "PAPERDESK_SIGNTOOL_PATH does not point to an existing signtool.exe."
  }

  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitRoots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  foreach ($root in $kitRoots) {
    $candidate = Get-ChildItem -LiteralPath $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw "signtool.exe was not found. Install the Windows SDK or set PAPERDESK_SIGNTOOL_PATH."
}

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Cannot sign missing file: $Path"
}

$signTool = Resolve-SignTool
$timestampUrl = if ($env:PAPERDESK_TIMESTAMP_URL) {
  $env:PAPERDESK_TIMESTAMP_URL
} else {
  'http://timestamp.digicert.com'
}

$commonArgs = @('sign', '/fd', 'SHA256', '/tr', $timestampUrl, '/td', 'SHA256')

if ($env:PAPERDESK_SIGN_CERT_SHA1) {
  & $signTool @commonArgs /sha1 $env:PAPERDESK_SIGN_CERT_SHA1 $Path
  exit $LASTEXITCODE
}

if ($env:PAPERDESK_SIGN_CERT_PATH) {
  if (-not (Test-Path -LiteralPath $env:PAPERDESK_SIGN_CERT_PATH)) {
    throw "PAPERDESK_SIGN_CERT_PATH does not point to an existing certificate file."
  }

  $pfxArgs = @('/f', $env:PAPERDESK_SIGN_CERT_PATH)
  if ($env:PAPERDESK_SIGN_CERT_PASSWORD) {
    $pfxArgs += @('/p', $env:PAPERDESK_SIGN_CERT_PASSWORD)
  }

  & $signTool @commonArgs @pfxArgs $Path
  exit $LASTEXITCODE
}

throw "No Windows signing certificate configured. Set PAPERDESK_SIGN_CERT_SHA1 or PAPERDESK_SIGN_CERT_PATH."
