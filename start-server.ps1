param(
  [int]$Port = 8080
)

# АвтоЖурнал - tiny static file server for local testing.
# No Node.js, Python or other software required.
# Bound to 127.0.0.1 only, so it is not accessible from the network.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  '.html'       = 'text/html; charset=utf-8'
  '.css'        = 'text/css; charset=utf-8'
  '.js'         = 'text/javascript; charset=utf-8'
  '.json'       = 'application/json; charset=utf-8'
  '.webmanifest'= 'application/manifest+json; charset=utf-8'
  '.png'        = 'image/png'
  '.jpg'        = 'image/jpeg'
  '.jpeg'       = 'image/jpeg'
  '.svg'        = 'image/svg+xml'
  '.ico'        = 'image/x-icon'
  '.txt'        = 'text/plain; charset=utf-8'
  '.map'        = 'application/json; charset=utf-8'
}

function Send-Response {
  param(
    $Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$HeadOnly
  )
  $header = "HTTP/1.1 $StatusCode $StatusText`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Cache-Control: no-store`r`n" +
            "X-Content-Type-Options: nosniff`r`n" +
            "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

$listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
try {
  $listener.Start()
} catch {
  Write-Host "Could not start the server on port $Port." -ForegroundColor Red
  Write-Host "Maybe another program is using this port. Try: powershell -File start-server.ps1 -Port 8081"
  exit 1
}

Write-Host ""
Write-Host "  АвтоЖурнал" -ForegroundColor Cyan
Write-Host "  http://localhost:$Port/" -ForegroundColor White
Write-Host "  Tests: http://localhost:$Port/tests/tests.html" -ForegroundColor DarkGray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $client.SendTimeout = 5000
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)

      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        $client.Close()
        continue
      }

      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') { break }
      }

      $parts = $requestLine -split ' '
      $method = $parts[0].ToUpperInvariant()
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
      $headOnly = $method -eq 'HEAD'

      if ($method -ne 'GET' -and $method -ne 'HEAD') {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
        Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' $body $false
        continue
      }

      $pathOnly = ($rawPath -split '\?')[0]
      $decoded = [System.Uri]::UnescapeDataString($pathOnly)
      if ($decoded -eq '/') { $decoded = '/index.html' }

      $relative = $decoded.TrimStart('/') -replace '/', '\'
      $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relative))
      $rootPrefix = $root.TrimEnd('\') + '\'

      if (-not $full.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
        Send-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' $body $false
        continue
      }

      if ([System.IO.Directory]::Exists($full)) {
        $full = [System.IO.Path]::Combine($full, 'index.html')
      }

      if (-not [System.IO.File]::Exists($full)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
        Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' $body $false
        continue
      }

      $extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $contentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      Send-Response $stream 200 'OK' $contentType $bytes $headOnly
    } catch {
      # A broken connection should not stop the server.
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}
