@echo off
rem Runs the evenkeel server and restarts it whenever it exits.
rem Started at boot by the "evenkeel" scheduled task (see install.ps1).
rem Settings come from .env in the repo root; output goes to data\server.log.
cd /d "%~dp0.."
if not exist data mkdir data
:loop
echo [%date% %time%] starting>> data\server.log
node --env-file-if-exists=.env --import tsx packages\server\src\index.ts >> data\server.log 2>&1
echo [%date% %time%] exited with code %errorlevel%, restarting in 5 s>> data\server.log
rem (timeout.exe refuses to run without a console, so wait with ping.)
ping -n 6 127.0.0.1 > nul
goto loop
