@echo off
cd /d "%~dp0"

echo.
echo ============================================
echo   AresWear Dashboard -- Data Refresh
echo ============================================
echo.

REM Step 1: Convert Excel files in imports\ to JSON
echo [1/3] Converting Excel files to JSON...
echo.
node import-excel-reports.js
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Conversion failed.
    echo  Make sure all 3 Excel files are saved in the imports\ folder.
    echo.
    pause
    exit /b 1
)

REM Step 2: Stage the refreshed data files
echo.
echo [2/3] Staging updated data files...
git add data/report-activities.json data/report-bulk.json data/report-team-store.json

REM Step 3: Commit and push to GitHub
echo [3/3] Checking for changes...
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo.
    echo  No changes detected -- data is already up to date.
    echo  Save the new Excel files to the imports\ folder first.
    echo.
    pause
    exit /b 0
)

echo [3/3] Pushing to GitHub...
git commit -m "Refresh dashboard data"
git push origin main

echo.
echo ============================================
echo   Done! Dashboard updates in about 1 min:
echo   https://areswearsales.netlify.app
echo ============================================
echo.
pause