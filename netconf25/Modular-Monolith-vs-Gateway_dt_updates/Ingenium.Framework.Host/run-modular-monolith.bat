@echo off
echo Avvio Modular Monolith su https://localhost:5443 ...
start cmd /k "dotnet run --launch-profile https_all"

echo Modular monolith avviato!
pause
