@echo off
cd C:\tops-tt-dashboard
set PYTHONIOENCODING=utf-8
for /f "usebackq tokens=1,2 delims==" %%a in (.env) do set %%a=%%b
C:\Users\HP\anaconda3\envs\wtt\python.exe scripts\live_updater.py --auto --points --db
