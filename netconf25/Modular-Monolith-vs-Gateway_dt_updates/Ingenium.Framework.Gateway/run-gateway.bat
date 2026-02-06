@echo off
echo Avvio Gateway su https://localhost:4443 ...
start cmd /k "dotnet run --launch-profile https_gateway"

echo Il Gateway è stato avviato!
pause
