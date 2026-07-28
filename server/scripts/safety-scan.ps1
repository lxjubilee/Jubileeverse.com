<#
  safety-scan.ps1 — family-safe / Christian-audience NSFW gate for generated images.

  Sends each PNG in a folder to the isolated NudeNet classifier on the GPU box
  (D:\inspire-imgsafe, one-shot — no standing service / no open port) and reports
  safe/unsafe. Exits 1 if any image is flagged, so it can gate a publish step.

  Usage:
    powershell -File scripts\safety-scan.ps1 -Dir "J:\articles\celebration-mishpakhah\images"
#>
param(
  [string]$Dir = "J:\articles\celebration-mishpakhah\images",
  [string]$Server = "HDC-INSPIRESERVER.JubileeIntelligence.com"
)
$ErrorActionPreference = 'Stop'
$incomingUnc = "\\$Server\D`$\inspire-imgsafe\incoming"
$pngs = Get-ChildItem $Dir -Filter '*.png' -File
if (-not $pngs) { Write-Output "No PNGs in $Dir"; exit 0 }

New-Item -ItemType Directory -Force $incomingUnc | Out-Null
$pngs | ForEach-Object { Copy-Item $_.FullName $incomingUnc -Force }
$names = $pngs.Name

$json = Invoke-Command -ComputerName $Server -ArgumentList (,$names) -ScriptBlock {
  param($names)
  $env:PYTHONUTF8 = '1'
  $paths = $names | ForEach-Object { "D:\inspire-imgsafe\incoming\$_" }
  $out = & 'D:\inspire-imgsafe\venv\Scripts\python.exe' 'D:\inspire-imgsafe\safety_check.py' @paths
  $out | Where-Object { $_ -match '^\[' }
}
$results = $json | ConvertFrom-Json
$unsafe = 0
foreach ($r in $results) {
  $name = Split-Path $r.file -Leaf
  if ($r.error) { Write-Output ("ERROR  {0}  {1}" -f $name, $r.error); $unsafe++ }
  elseif ($r.safe) { Write-Output ("SAFE   {0}" -f $name) }
  else { Write-Output ("UNSAFE {0}  score={1}  flags={2}" -f $name, $r.score, ($r.flags.class -join ',')); $unsafe++ }
}
Write-Output ("--- {0} image(s), {1} flagged ---" -f $results.Count, $unsafe)
if ($unsafe -gt 0) { exit 1 } else { exit 0 }
