# Windows Quick Start Guide

## Prerequisites

### 1. Install Google Cloud SDK

1. Download from: https://cloud.google.com/sdk/docs/install-sdk#windows
2. Run the installer
3. Open a **new** Command Prompt or PowerShell window
4. Test: `gcloud version`

### 2. Install Node.js

1. Download from: https://nodejs.org/
2. Install version 18 or higher
3. Test: `node --version`

## Setup Steps

### Step 1: Setup Google Cloud Environment

```cmd
# Run the Windows setup script
scripts\setup-env.bat
```

This will:
- Create Google Cloud project
- Enable required APIs
- Create secrets for Gong credentials
- Set up authentication

### Step 2: Enable Billing

**Important**: Go to Google Cloud Console and enable billing:
1. Visit: https://console.cloud.google.com/billing/linkedaccount?project=gong-chatgpt-integration
2. Link a billing account
3. This is required for Cloud Functions to work

### Step 3: Deploy Functions

```cmd
# Deploy all functions
scripts\deploy.bat
```

This will:
- Deploy the main Gong API function
- Deploy the daily summary function
- Display the function URLs

### Step 4: Update ChatGPT

1. Copy the **Main API URL** from the deployment output
2. Go to ChatGPT and edit your "Gong Call Assistant" custom GPT
3. Update the Actions endpoint URL to your new Cloud Function URL
4. Test with a simple query like "Show me users"

## Alternative: Using PowerShell

If Command Prompt doesn't work, try PowerShell:

```powershell
# Setup environment
.\scripts\setup-env.bat

# Deploy functions
.\scripts\deploy.bat
```

## Troubleshooting

### "gcloud not found"
- Make sure Google Cloud SDK is installed
- Restart your terminal/VS Code after installation
- Add to PATH if needed: `C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin`

### "Authentication required"
- Run: `gcloud auth login`
- Follow the browser authentication flow

### "Billing not enabled"
- Enable billing in Google Cloud Console
- This is required for Cloud Functions

### "Function deployment failed"
- Check if billing is enabled
- Verify you have the correct permissions
- Check the error message for specific issues

## Useful Commands

```cmd
# View logs
gcloud functions logs tail gong-api --region=us-central1

# Test function
curl -X POST "YOUR_FUNCTION_URL" -H "Content-Type: application/json" -d "{\"path\": \"/users\", \"method\": \"GET\"}"

# Update function
cd functions\gong-api
gcloud functions deploy gong-api --gen2 --source=. --entry-point=gongApi --trigger=https --runtime=nodejs18 --region=us-central1

# Check project status
gcloud config get-value project
gcloud services list --enabled
```

## Success Indicators

You'll know everything is working when:

1. ✅ Both functions deploy successfully
2. ✅ Function URLs are displayed
3. ✅ ChatGPT can connect to your new endpoint
4. ✅ You can make requests like "Show me calls from this week"

## Getting Help

If you run into issues:

1. **Check the error message** - Most issues are clearly described
2. **Verify billing** - This is the #1 cause of deployment failures
3. **Check authentication** - Make sure you're logged in to gcloud
4. **Review logs** - Use `gcloud functions logs tail gong-api`
5. **Start simple** - Test with just the main function first