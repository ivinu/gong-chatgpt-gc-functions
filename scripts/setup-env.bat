@echo off
REM scripts/setup-env.bat - Windows environment setup script

set PROJECT_ID=gong-chatgpt-integration
set REGION=us-central1

echo 🔧 Setting up Google Cloud environment

REM Check if gcloud is installed
gcloud version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ gcloud CLI not found. Please install Google Cloud SDK.
    echo Download from: https://cloud.google.com/sdk/docs/install
    pause
    exit /b 1
)

REM Check authentication
gcloud auth list --filter=status:ACTIVE --format="value(account)" | findstr "@" >nul
if %errorlevel% neq 0 (
    echo 🔐 Please authenticate with Google Cloud
    gcloud auth login
)

REM Create project if it doesn't exist
echo 📋 Setting up project: %PROJECT_ID%
gcloud projects describe %PROJECT_ID% >nul 2>&1
if %errorlevel% neq 0 (
    echo Creating new project...
    gcloud projects create %PROJECT_ID% --name="Gong ChatGPT Integration"
) else (
    echo ✅ Project already exists
)

REM Set as default project
gcloud config set project %PROJECT_ID%

REM Enable required APIs
echo 🔌 Enabling required APIs...
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable firestore.googleapis.com
gcloud services enable cloudscheduler.googleapis.com

REM Create secrets
echo 🔐 Creating secrets in Secret Manager...

REM Check and create gong-access-key
gcloud secrets describe gong-access-key >nul 2>&1
if %errorlevel% neq 0 (
    echo Creating secret: gong-access-key
    echo SHMUKDPJZXK32T2D6WMVSX5ZTSDOOWR7| gcloud secrets create gong-access-key --data-file=-
) else (
    echo Secret gong-access-key already exists
)

REM Check and create gong-secret-key
gcloud secrets describe gong-secret-key >nul 2>&1
if %errorlevel% neq 0 (
    echo Creating secret: gong-secret-key
    echo eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjIwNjM5ODk0MDMsImFjY2Vzc0tleSI6IlNITVVLRFBKWlhLMzJUMkQ2V01WU1g1WlRTRE9PV1I3In0.WV-hohYUamJKNa66bAjuOuyHSdU8oFgDRL-kqGUMBvY| gcloud secrets create gong-secret-key --data-file=-
) else (
    echo Secret gong-secret-key already exists
)

REM Check and create gong-api-base-url
gcloud secrets describe gong-api-base-url >nul 2>&1
if %errorlevel% neq 0 (
    echo Creating secret: gong-api-base-url
    echo https://us-22394.api.gong.io/v2| gcloud secrets create gong-api-base-url --data-file=-
) else (
    echo Secret gong-api-base-url already exists
)

echo ✅ Environment setup completed!
echo.
echo ⚠️  Important: Make sure billing is enabled for your project
echo Visit: https://console.cloud.google.com/billing/linkedaccount?project=%PROJECT_ID%
echo.
echo Next steps:
echo 1. Enable billing for the project
echo 2. Run: scripts\deploy.bat
echo.
pause