# CloakManager Testing Guide

## Quick Setup

### 1. Clone & Install
```bash
git clone git@github.com:Gee2424/Oserus-reddit.git
cd Oserus-reddit
npm install
```

### 2. Start the App
```bash
npm run dev
```
Login with: `admin / changeme`

### 3. Start CloakManager
Make sure CloakManager is running on your port (e.g., port 41091)

## Testing the CloakManager Integration

### Step 1: Configure CloakManager Port

1. Click **Settings** in the sidebar
2. Find **Browser Mode Settings** section
3. In **CloakManager Service URL** field, type: `http://127.0.0.1:41091` (or your port)
4. Click **Check Connection** button
5. Should show green dot and "Connected and operational"
6. Click **Save Settings**

### Step 2: Create Test Accounts

1. Click **Accounts** in the sidebar
2. Click **+ Add login** button

#### Test Account 1: Standard Electron Mode
- Model profile: `Test Model`
- Platform: `Reddit`
- Username: `test_electron`
- Password: `your_password`
- Browser mode: `Electron (standard)`
- Click **Add account**

#### Test Account 2: CloakManager Mode
- Model profile: `Test Model`
- Platform: `Reddit`
- Username: `test_cloak`
- Password: `your_password`
- Browser mode: `CloakManager (advanced)`
- CloakManager profile name: Leave blank (auto-generates as `reddit-test_cloak`)
- Click **Add account**

### Step 3: Launch and Test

1. Find the **▶** button next to each account
2. Click launch for Electron account → Opens standard browser
3. Click launch for CloakManager account → Shows launch progress, then opens CloakManager browser
4. Both should work independently

### What to Look For

✅ **Green status dot** in Settings when CloakManager is connected
✅ **Launch status indicators** on account rows ("Checking backend", "Starting browser", "Browser launched")
✅ **Running badge** appears when CloakManager profile is active
✅ **Electron mode still works** exactly as before

### Troubleshooting

**If connection fails:**
- Make sure CloakManager is actually running on your port
- Check the URL format: `http://127.0.0.1:41091`
- Restart the app after changing settings

**If profile creation fails:**
- Verify CloakManager is running
- Check that platform is set to "Reddit" (not RedGifs)

That's it! The integration should work seamlessly once the port is configured correctly.
