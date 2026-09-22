# Local nested Cloud-shaped manifest for OTA real-upgrade validation.
# Serves GET /manifest → nested client/agent pointing at GitHub v1.0.6-test assets.
# Usage: powershell -File serve-test-manifest.ps1

$ErrorActionPreference = "Stop"
$port = 18765
$clientUrl = "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe"
$agentUrl = "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Agent-v2.4.6.zip"
$clientSha = "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1"
$agentSha = "ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d"

$body = @{
  client = @{
    version = "1.0.6"
    url     = $clientUrl
    sha256  = $clientSha
  }
  agent = @{
    version = "2.4.6"
    url     = $agentUrl
    sha256  = $agentSha
  }
} | ConvertTo-Json -Depth 5

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "MANIFEST_URL=http://127.0.0.1:$port/manifest"
Write-Host "Serving nested test manifest. Ctrl+C to stop."

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  if ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -eq "/manifest") {
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $res.StatusCode = 200
    $res.ContentType = "application/json; charset=utf-8"
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
  }
  $res.Close()
}
