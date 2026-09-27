@echo off
rem One listening pass for Windows Task Scheduler: read the sources, then judge
rem what is new. Output goes to .amble-data\logs, one file per day.
rem
rem   schtasks /Create /TN "Amble listen" /SC DAILY /ST 08:00 /RI 240 /DU 12:00 ^
rem     /TR "\"C:\dev\amble\scripts\listen-scheduled.cmd\""

setlocal
cd /d "%~dp0.."
if not exist ".amble-data\logs" mkdir ".amble-data\logs"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set DAY=%%d
set PATH=C:\nodejs;%PATH%
echo ==== %DATE% %TIME% >> ".amble-data\logs\listen-%DAY%.log"
call npm run -s listen >> ".amble-data\logs\listen-%DAY%.log" 2>&1
