# Временный мост для разработки, пока база не опубликована на веб-сервере:
# принимает GET http://localhost:<Port>/hs/dashboard/v1/<ресурс>?... и отдаёт
# ответ расширения dashboard через COM (дш_ДашбордСервер.ПроверочныйЗапрос).
# Слушает только localhost. Запросы обрабатываются по одному.
#
# Запуск:
#   powershell -File onec-extension\com-bridge.ps1 -User Develop -Password ***
# В .env дашборда: ONEC_HS_URL=http://localhost:8099/hs/dashboard/v1
param(
  [string]$Base = "E:\3kvadrata\1c-base",
  [string]$User,
  [string]$Password,
  [int]$Port = 8099
)

$ErrorActionPreference = "Stop"
$cn = New-Object -ComObject V83.COMConnector
$c = $cn.Connect("File=""$Base"";Usr=""$User"";Pwd=""$Password""")
$mod = [System.__ComObject].InvokeMember("дш_ДашбордСервер", [Reflection.BindingFlags]::GetProperty, $null, $c, $null)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
# Через SSH-туннель запросы приходят с Host: 127.0.0.1
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "COM-мост: http://localhost:$Port/hs/dashboard/v1/  (база $Base)"

$prefix = "/hs/dashboard/v1/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $path = $req.Url.AbsolutePath
    if (-not $path.StartsWith($prefix)) {
      $code = 404; $body = '{"error":"not found"}'
    } else {
      $resource = $path.Substring($prefix.Length)
      $query = $req.Url.Query.TrimStart("?")
      $out = [System.__ComObject].InvokeMember("ПроверочныйЗапрос", [Reflection.BindingFlags]::InvokeMethod, $null, $mod, @($resource, $query))
      $parts = $out -split "`n", 2
      $code = [int]$parts[0]; $body = $parts[1]
    }
  } catch {
    $code = 500
    $body = (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $res.StatusCode = $code
  $res.ContentType = "application/json; charset=utf-8"
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
  Write-Host ("{0} {1} -> {2} ({3} ms, {4} bytes)" -f $req.HttpMethod, $req.Url.PathAndQuery, $code, [int]$sw.Elapsed.TotalMilliseconds, $bytes.Length)
}
