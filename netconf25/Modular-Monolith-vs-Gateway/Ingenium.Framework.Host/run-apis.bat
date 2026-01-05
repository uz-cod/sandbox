@echo off
echo Avvio Cart Api su https://localhost:6443 ...
start cmd /k "dotnet run --launch-profile https_cart"

echo Avvio Catalog Api su https://localhost:7443 ...
start cmd /k "dotnet run --launch-profile https_catalog"

echo Entrambe le istanze sono state avviate!
pause
