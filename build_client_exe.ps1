$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command
  )

  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit code $LASTEXITCODE): $Command"
  }
}

Write-Host "[1/4] Building frontend production bundle..."
Push-Location frontend
Invoke-CheckedCommand "npm run build"
Pop-Location

Write-Host "[2/4] Installing PyInstaller if missing..."
Invoke-CheckedCommand "python -m pip install --upgrade pyinstaller"

Write-Host "[2.5/4] Checking for incompatible enum34 package..."
python -m pip show enum34 *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "enum34 detected. Removing it to avoid PyInstaller failure..."
  Invoke-CheckedCommand "python -m pip uninstall -y enum34"
}

Write-Host "[3/4] Building one-file launcher exe..."
Invoke-CheckedCommand "python -m PyInstaller --noconfirm --clean --onefile --name FillWiseStudio --paths backend --hidden-import server --hidden-import comment_docx_parser --hidden-import comment_docx_editor --exclude-module PyQt5 --exclude-module PyQt6 --exclude-module PySide2 --exclude-module PySide6 --add-data 'backend;backend' --add-data 'frontend/build;frontend/build' launch_fillwise.py"

$exePath = Join-Path $PSScriptRoot "dist/FillWiseStudio.exe"
if (-not (Test-Path $exePath)) {
  throw "Build finished without expected output file: $exePath"
}

Write-Host "[4/4] Done. Exe created at dist/FillWiseStudio.exe"
Write-Host "Client note: MongoDB and Ollama must be available on the client machine."
