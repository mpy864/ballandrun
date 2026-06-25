@echo off
cd C:\tops-tt-dashboard
for /f "usebackq tokens=1,2 delims==" %%a in (.env) do set %%a=%%b
C:\Users\HP\anaconda3\envs\wtt\python.exe scripts\send_todays_results.py --auto --db