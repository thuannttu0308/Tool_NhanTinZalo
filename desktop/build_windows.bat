@echo off
chcp 65001 >nul
cd /d "%~dp0"

python -m pip install -r requirements.txt || goto :error

python -m PyInstaller --noconfirm --clean --windowed --onefile ^
  --name "NhanTinZalo" ^
  --add-data "..\ui;ui" ^
  --collect-data playwright ^
  --collect-submodules playwright ^
  --collect-all uiautomation ^
  --hidden-import comtypes.stream ^
  --hidden-import zalo_app --hidden-import zalo_web ^
  main.py || goto :error

echo.
echo Da build xong: desktop\dist\NhanTinZalo.exe
goto :eof

:error
echo Build that bai
exit /b 1
