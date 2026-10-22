# Setting up integrations

Tabspace never ships OAuth credentials. Google Calendar and Spotify each need a free developer client ID that **you**
create and paste into **Settings → Integrations**. Both use the redirect URI that Settings shows for your install:

```
https://<your-extension-id>.chromiumapp.org/
```

(The ID is shown on `chrome://extensions` and in Settings. It stays stable for an unpacked extension loaded from the same folder.)

## Google Calendar (read-only)

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create or pick a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **OAuth consent screen**: user type *External*, set an app name and your email. While the app is in *Testing*, add your own Google account as a **Test user**.
4. **Data access**: add the scope `https://www.googleapis.com/auth/calendar.readonly`.
5. **Clients → Create client → Web application**. Under *Authorized redirect URIs* add the exact URI from Settings (with the trailing slash).
6. Copy the **Client ID** (ends with `.apps.googleusercontent.com`; no client secret is used). Paste it in Settings → Integrations → Google Calendar → **Save**, then **Connect**.
7. On the Calendar page choose **Add calendar → Connect Google Calendar** and pick the calendars to show.

Notes: Tabspace uses Google's token flow through `chrome.identity.launchWebAuthFlow`; access tokens are kept only in
`chrome.storage.session` and renewed silently while you are signed in to Google in Chrome. If silent renewal fails the
calendar shows *Reconnect needed*.

## Spotify

1. Sign in at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Under Spotify's 2026 Development Mode rules the app owner needs Premium and an app is limited to a handful of allow-listed users.
2. **Create app**, tick **Web API**, and set the Redirect URI to the exact URI from Settings.
3. Copy the **Client ID** (never the client secret — Tabspace uses Authorization Code with PKCE).
4. **User Management**: add every Spotify account that will use it.
5. Paste the Client ID in Settings → Integrations → Spotify → **Save**, then **Connect**.
6. Playback controls need Spotify Premium on the listening account and an active Spotify device. Otherwise the Focus Playlist card explains why and offers **Open in Spotify**.

## ICS / iCal feeds

On the Calendar page choose **Add calendar → Subscribe via ICS URL** and paste the feed's secret address
(`https://…/basic.ics` or `webcal://…`). Chrome will ask for permission to access that one host. The feed is fetched
directly from your browser — never through a proxy. Feed URLs are excluded from data exports unless you tick the option.
