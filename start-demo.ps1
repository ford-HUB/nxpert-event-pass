# Starts the API and the Angular dev server in separate windows.
# Run from the repo root:  ./start-demo.ps1

$root = $PSScriptRoot

Write-Host "Starting .NET API (http://localhost:5088)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root/backend/EventRegistration.Api'; dotnet run"
)

Write-Host "Starting Angular dev server (http://localhost:4200)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root/frontend/web'; npm start"
)

Write-Host ""
Write-Host "Two windows launched. When both are up, open http://localhost:4200" -ForegroundColor Green
Write-Host "Sign in as admin@demo.com / Admin123!" -ForegroundColor Green
