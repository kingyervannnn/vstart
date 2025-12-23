# Gmail OAuth Setup Guide

To use Gmail authentication in VSTART, you need to set up Google OAuth 2.0 credentials.

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your project ID

## Step 2: Enable Gmail API

1. In Google Cloud Console, navigate to **APIs & Services** > **Library**
2. Search for "Gmail API"
3. Click on it and press **Enable**

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - Choose **External** user type (unless you have a Google Workspace)
   - Fill in the required app information
   - Add your email as a test user
   - Complete the consent screen setup

4. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: `VSTART Gmail Integration` (or any name)
   - Authorized redirect URIs: Add:
     ```
     http://localhost:3000/gmail-oauth-callback
     ```
     (If deploying, also add your production URL)

5. Copy the **Client ID** (you'll need this)

## Step 4: Configure in VSTART

1. Open VSTART Settings
2. Go to **Widgets** tab
3. Scroll to **Email module** section
4. Enter your Google OAuth Client ID in the configuration field
5. Save settings

## Step 5: Configure the Gmail backend

To actually exchange OAuth codes for tokens and read your inbox, the local Gmail backend must know your Client ID and Client Secret.

### Local (Vite dev server)

1. Set environment variables in the shell where you run the backend:
   ```bash
   export GMAIL_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export GMAIL_CLIENT_SECRET="your-client-secret"
   ```
2. Start the Gmail backend:
   ```bash
   node server/gmail-server.mjs
   ```
3. In another shell, start the Vite dev server as usual (`pnpm dev` / `npm run dev`).  
   The frontend calls the backend via `/gmail/...` which Vite proxies to `http://127.0.0.1:3500`.

### Docker stack

1. In `docker-compose.yml`, set:
   ```yaml
   GMAIL_CLIENT_ID: your-client-id.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET: your-client-secret
   ```
   (or export them in your shell before `docker-compose up` so the `${...}` placeholders are filled).
2. Bring the stack up:
   ```bash
   docker-compose up -d
   ```
   The `gmail-api` service will be available at `/gmail/...` through nginx.

## Step 6: Test Authentication

1. Click **Sign in with Gmail** button
2. A popup will open for Google sign-in
3. Grant the required permissions
4. The Gmail account will be added to your accounts list

## Important Notes

- **Client Secret**: Never share or expose your OAuth Client Secret publicly
- **Redirect URI**: Must exactly match what you configured in Google Cloud Console
- **Scopes**: The app requests `gmail.readonly`, `userinfo.email`, and `userinfo.profile` scopes
- **Production**: For production use, ensure your redirect URI matches your deployed domain
- **Tokens**: Access tokens are stored locally in your browser (they're only accessible to your local VSTART instance)

## Troubleshooting

### "OAuth Client ID not configured"
- Make sure you've entered the Client ID in settings
- Check that the Client ID is correct (no extra spaces)

### "Redirect URI mismatch"
- Verify the redirect URI in Google Cloud Console matches exactly: `http://localhost:3000/gmail-oauth-callback`
- Check for trailing slashes or protocol mismatches (http vs https)

### "Popup blocked"
- Allow popups for your VSTART domain
- Check browser popup blocker settings

### "Access denied"
- Make sure your email is added as a test user in OAuth consent screen (if app is in testing mode)
- Check that you're granting all requested permissions

## Security Considerations

- OAuth tokens are stored in browser localStorage (only accessible to your local VSTART instance)
- For production deployments, consider implementing server-side token exchange
- Regularly review and revoke unused OAuth credentials in Google Cloud Console







