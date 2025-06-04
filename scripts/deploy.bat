@echo off
REM scripts/deploy.bat - Windows deployment script for Google Cloud Functions

set PROJECT_ID=gong-chatgpt-integration
set REGION=us-central1
set RUNTIME=nodejs18

echo 🚀 Starting deployment to Google Cloud Functions

REM Check if gcloud is installed
gcloud version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ gcloud CLI not found. Please install Google Cloud SDK.
    pause
    exit /b 1
)

REM Set project
echo 📋 Setting project to %PROJECT_ID%
gcloud config set project %PROJECT_ID%

REM Deploy main function (replaces your Vercel middleware)
echo 🚢 Deploying main Gong API function
cd functions\gong-api

gcloud functions deploy gong-api ^
  --gen2 ^
  --runtime=%RUNTIME% ^
  --region=%REGION% ^
  --source=. ^
  --entry-point=gongApi ^
  --trigger=https ^
  --memory=512MB ^
  --timeout=540s ^
  --max-instances=100 ^
  --min-instances=1 ^
  --allow-unauthenticated ^
  --set-env-vars="NODE_ENV=production" ^
  --quiet

if %errorlevel% neq 0 (
    echo ❌ Failed to deploy main function
    cd ..\..
    pause
    exit /b 1
)

cd ..\..

REM Deploy calls function (enhanced call management)
echo 🚢 Deploying enhanced calls function
cd functions\calls

gcloud functions deploy gong-calls ^
  --gen2 ^
  --runtime=%RUNTIME% ^
  --region=%REGION% ^
  --source=. ^
  --entry-point=callsHandler ^
  --trigger=https ^
  --memory=1GB ^
  --timeout=540s ^
  --max-instances=50 ^
  --min-instances=0 ^
  --allow-unauthenticated ^
  --set-env-vars="NODE_ENV=production" ^
  --quiet

cd ..\..

REM Deploy users function
echo 🚢 Deploying users management function
cd functions\users

gcloud functions deploy gong-users ^
  --gen2 ^
  --runtime=%RUNTIME% ^
  --region=%REGION% ^
  --source=. ^
  --entry-point=usersHandler ^
  --trigger=https ^
  --memory=512MB ^
  --timeout=300s ^
  --max-instances=20 ^
  --min-instances=0 ^
  --allow-unauthenticated ^
  --set-env-vars="NODE_ENV=production" ^
  --quiet

cd ..\..

REM Deploy transcript function
echo 🚢 Deploying transcript processing function
cd functions\transcript

gcloud functions deploy gong-transcript ^
  --gen2 ^
  --runtime=%RUNTIME% ^
  --region=%REGION% ^
  --source=. ^
  --entry-point=transcriptHandler ^
  --trigger=https ^
  --memory=1GB ^
  --timeout=540s ^
  --max-instances=20 ^
  --min-instances=0 ^
  --allow-unauthenticated ^
  --set-env-vars="NODE_ENV=production" ^
  --quiet

cd ..\..

REM Deploy AI analysis function
echo 🚢 Deploying AI analysis function
cd functions\ai-analysis

gcloud functions deploy gong-ai-analysis ^
  --gen2 ^
  --runtime=%RUNTIME% ^
  --region=%REGION% ^
  --source=. ^
  --entry-point=aiAnalysisHandler ^
  --trigger=https ^
  --memory=2GB ^
  --timeout=540s ^
  --max-instances=10 ^
  --min-instances=0 ^
  --allow-unauthenticated ^
  --set-env-vars="NODE_ENV=production" ^
  --quiet

cd ..\..

REM Deploy daily summary function
echo 🚢 Deploying daily summary function
cd functions\daily-summary

gcloud functions deploy daily-summary ^
  --gen2 ^
  --runtime=%RUNTIME% ^
  --region=%REGION% ^
  --source=. ^
  --entry-point=dailySummary ^
  --trigger=https ^
  --memory=1GB ^
  --timeout=540s ^
  --max-instances=5 ^
  --min-instances=0 ^
  --allow-unauthenticated ^
  --set-env-vars="NODE_ENV=production" ^
  --quiet

cd ..\..

REM Get function URLs
echo ✅ Deployment completed!
echo.
echo 📍 Function URLs:

REM Get all function URLs
for /f "tokens=*" %%i in ('gcloud functions describe gong-api --region=%REGION% --gen2 --format="value(serviceConfig.uri)"') do set MAIN_URL=%%i
for /f "tokens=*" %%i in ('gcloud functions describe gong-calls --region=%REGION% --gen2 --format="value(serviceConfig.uri)"') do set CALLS_URL=%%i
for /f "tokens=*" %%i in ('gcloud functions describe gong-users --region=%REGION% --gen2 --format="value(serviceConfig.uri)"') do set USERS_URL=%%i
for /f "tokens=*" %%i in ('gcloud functions describe gong-transcript --region=%REGION% --gen2 --format="value(serviceConfig.uri)"') do set TRANSCRIPT_URL=%%i
for /f "tokens=*" %%i in ('gcloud functions describe gong-ai-analysis --region=%REGION% --gen2 --format="value(serviceConfig.uri)"') do set AI_URL=%%i
for /f "tokens=*" %%i in ('gcloud functions describe daily-summary --region=%REGION% --gen2 --format="value(serviceConfig.uri)"') do set SUMMARY_URL=%%i

echo Main API (ChatGPT endpoint): %MAIN_URL%
echo Enhanced Calls: %CALLS_URL%
echo Users Management: %USERS_URL%
echo Transcript Processing: %TRANSCRIPT_URL%
echo AI Analysis: %AI_URL%
echo Daily Summary: %SUMMARY_URL%

REM Save URLs to file
echo # Gong Cloud Functions URLs > function-urls.txt
echo. >> function-urls.txt
echo ## Main Functions >> function-urls.txt
echo Main API (ChatGPT endpoint): %MAIN_URL% >> function-urls.txt
echo Enhanced Calls: %CALLS_URL% >> function-urls.txt
echo Users Management: %USERS_URL% >> function-urls.txt
echo. >> function-urls.txt
echo ## Advanced Functions >> function-urls.txt
echo Transcript Processing: %TRANSCRIPT_URL% >> function-urls.txt
echo AI Analysis: %AI_URL% >> function-urls.txt
echo Daily Summary: %SUMMARY_URL% >> function-urls.txt
echo. >> function-urls.txt
echo Deployment Date: %date% %time% >> function-urls.txt

echo.
echo 🎉 Deployment complete!
echo URLs saved to function-urls.txt
echo.
echo 📋 Next steps:
echo 1. 🔗 Update your ChatGPT custom GPT endpoint to: %MAIN_URL%
echo 2. 🧪 Test the integration with ChatGPT
echo 3. 📊 Monitor function logs: gcloud functions logs tail gong-api --region=%REGION%
echo 4. 🔍 Try advanced features like AI analysis and daily summaries
echo.
echo 💡 Pro tip: The main API function is backward compatible with your existing ChatGPT setup
echo    while the other functions provide enhanced capabilities for advanced use cases.
echo.
pause