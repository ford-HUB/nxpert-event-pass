# Resets the demo database to a clean seeded state.
# Run this before every rehearsal and the live demo.
#
#   ./reseed.ps1
#
# It drops EventRegistrationDb; the API re-creates and re-seeds it on next startup
# (admin@demo.com / Admin123!, 5 contacts, and the "Q3 Product Seminar" event).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Dropping EventRegistrationDb..." -ForegroundColor Cyan
dotnet ef database drop --force

Write-Host ""
Write-Host "Done. Start the API (dotnet run) and it will re-seed automatically." -ForegroundColor Green
