@echo off
setlocal
cd /d "%~dp0"

echo Installing the GameSphere website build dependencies...
call npm install --prefix ..\..
if errorlevel 1 (
  echo.
  echo Website dependency installation failed.
  exit /b 1
)

echo.
echo Installing GameSphere Windows app build tools...
call npm install
if errorlevel 1 (
  echo.
  echo Dependency installation failed.
  exit /b 1
)

echo.
echo Building the GameSphere Windows installer...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo Windows app build failed.
  exit /b 1
)

echo.
echo Build complete. Find the versioned GameSphere installer in the release folder.
endlocal
