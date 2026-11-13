# Проверка расширения dashboard через COM (без веб-сервера).
# Запуск: powershell -File onec-extension\test-com.ps1 -Base "E:\3kvadrata\1c-base" -User Develop -Password ***
param(
  [string]$Base = "E:\3kvadrata\1c-base",
  [string]$User,
  [string]$Password,
  [string]$From = "2026-10-01",
  [string]$To = "2026-10-27",
  [int]$Preview = 700
)

$cn = New-Object -ComObject V83.COMConnector
$c = $cn.Connect("File=""$Base"";Usr=""$User"";Pwd=""$Password""")
$mod = [System.__ComObject].InvokeMember("дш_ДашбордСервер", [Reflection.BindingFlags]::GetProperty, $null, $c, $null)

function Call([string]$res, [string]$query) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $out = [System.__ComObject].InvokeMember("ПроверочныйЗапрос", [Reflection.BindingFlags]::InvokeMethod, $null, $mod, @($res, $query))
  $ms = [int]$sw.Elapsed.TotalMilliseconds
  $code, $body = $out -split "`n", 2
  $total = if ($body -match '"total":(\d+)') { $Matches[1] } else { "-" }
  "== ${res}?${query}  HTTP $code  $ms ms  total=$total"
  if ($body.Length -gt $Preview) { $body.Substring(0, $Preview) + " ..." } else { $body }
  ""
}

$p = "from=$From&to=$To&limit=2"
Call "ping" ""
foreach ($r in "sales", "returns", "checks", "receipts", "writeoffs", "recounts") { Call $r $p }
Call "stock" "limit=2"
Call "stock" "date=$To&limit=2"
foreach ($r in "products", "stores", "sellers", "suppliers") { Call $r "limit=2" }
# Ошибки параметров
Call "sales" "from=2026-01-01&to=2026-10-27"
Call "sales" "from=2026-13-01&to=2026-10-27"
Call "sales" ""
Call "unknown" ""
