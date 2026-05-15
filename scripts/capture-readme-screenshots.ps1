<#
.SYNOPSIS
  Genera las PNG del README contra la web servida por Docker (servicio compose `web`).

.PARAMETER BaseUrl
  URL base sin barra final. Por defecto: http://127.0.0.1 y puerto WEB_PUBLISH_PORT o 3000.

.EXAMPLE
  .\scripts\capture-readme-screenshots.ps1
.EXAMPLE
  .\scripts\capture-readme-screenshots.ps1 -BaseUrl "http://127.0.0.1:3001"
#>
param(
  [string]$BaseUrl = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outDir = Join-Path $repoRoot "docs/screenshots"
$pwCwd = Join-Path $repoRoot "apps/web"

if (-not $BaseUrl) {
  $port = "3000"
  if ($env:WEB_PUBLISH_PORT -and $env:WEB_PUBLISH_PORT.Trim() -ne "") {
    $port = $env:WEB_PUBLISH_PORT.Trim()
  }
  $BaseUrl = "http://127.0.0.1:$port"
}
$BaseUrl = $BaseUrl.TrimEnd("/")

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "Esperando respuesta en $BaseUrl/ ..."
$deadline = (Get-Date).AddMinutes(3)
$ok = $false
while ((Get-Date) -lt $deadline) {
  try {
    $code = curl.exe -s -o NUL -w "%{http_code}" "$BaseUrl/"
    if ($code -eq "200") {
      $ok = $true
      break
    }
  } catch { }
  Start-Sleep -Seconds 2
}
if (-not $ok) {
  Write-Error "No hay respuesta HTTP 200 en $BaseUrl/. Levanta el stack (docker compose up -d) y el servicio web."
}

Push-Location $pwCwd
try {
  & npx @("--yes", "playwright@1.56.0", "screenshot", "-b", "chromium",
    "--viewport-size", "1480,900",
    "--wait-for-timeout", "8000",
    "--wait-for-selector", "text=RAG Studio",
    "$BaseUrl/",
    (Join-Path $outDir "vista-chat-escritorio.png"))

  # Evitar caracteres acentuados en la línea de comandos (encoding en consolas Windows).
  & npx @("--yes", "playwright@1.56.0", "screenshot", "-b", "chromium",
    "--viewport-size", "1480,900",
    "--wait-for-timeout", "8000",
    "--wait-for-selector", "text=Volver al chat",
    "$BaseUrl/settings",
    (Join-Path $outDir "vista-configuracion-ia.png"))

  & npx @("--yes", "playwright@1.56.0", "screenshot", "-b", "chromium",
    "--viewport-size", "390,844",
    "--wait-for-timeout", "8000",
    "--wait-for-selector", "text=Asistente IA",
    "$BaseUrl/",
    (Join-Path $outDir "vista-chat-movil.png"))
}
finally {
  Pop-Location
}

Write-Host "Listo: $outDir"
