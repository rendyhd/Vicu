# Registering the Microsoft and Google sign-ins for calendars

Vicu reads Microsoft 365 / Outlook.com and Google calendars through each provider's API, after the
user signs in in the system browser (OAuth 2.0 authorization code flow with PKCE, back to a loopback
address on the user's computer). Each provider needs an OAuth client registered once. This page
covers both the official Vicu clients and "Use my own client" in Settings, which uses the same steps.

The official ids live in one place: `OFFICIAL_CLIENTS` in `src/main/calendar/oauth-clients.ts`.
While an id there is empty, the add dialog says the account type has no registered sign-in and
offers "Use my own client". Once it is filled in, the official client is used and "Use my own
client" moves under Advanced.

What Vicu asks for is read-only and the smallest each provider has:

| Provider | Scopes |
|---|---|
| Microsoft | `Calendars.ReadBasic`, `offline_access`, `openid`, `profile` |
| Google | `https://www.googleapis.com/auth/calendar.events.readonly`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly` |

## Microsoft (Entra app registration)

1. Sign in to the Microsoft Entra admin center (entra.microsoft.com) with the account that will own
   the app. Go to Applications, App registrations, New registration.
2. Name: `Vicu`. Supported account types: **Accounts in any organizational directory (any Microsoft
   Entra ID tenant, multitenant) and personal Microsoft accounts**. Vicu signs in through the
   `common` authority, which needs this choice.
3. Redirect URI: platform **Public client/native (mobile & desktop)**, value `http://localhost`.
   Microsoft ignores the port of a localhost redirect, so Vicu can listen on any free port.
4. After creating it, open Authentication: check that the "Mobile and desktop applications"
   platform lists `http://localhost`, and under Advanced settings set **Allow public client flows**
   to Yes. Do not add a client secret: Vicu is a public client.
5. API permissions: Add a permission, Microsoft Graph, Delegated permissions, `Calendars.ReadBasic`.
   `openid`, `profile` and `offline_access` are added by the sign-in itself. Remove `User.Read` if
   you like; Vicu does not use it. Do not add application permissions.
6. Publisher verification (official app only): under Branding & properties, set a verified
   publisher domain and add the Microsoft Cloud Partner Program (MPN) id of the publisher. Most work
   tenants only let users consent to apps from verified publishers; without it every work account
   needs an admin's consent (see `docs/calendar-it-admins.md`).
7. Copy the **Application (client) ID** from Overview into `OFFICIAL_CLIENTS.microsoft.clientId`.

For "Use my own client" the same registration works; paste the Application (client) ID in Settings,
Plan, Add calendar, Microsoft 365. Publisher verification is not needed for your own accounts.

## Google (Cloud project)

1. In the Google Cloud console (console.cloud.google.com) create a project, for example `Vicu`.
2. APIs & Services, Library: enable the **Google Calendar API**.
3. Google Auth Platform (OAuth consent screen): app name, user support email, developer contact.
   Audience: **External**. For the official app also the app home page, the privacy policy link and
   the authorized domain they are on.
4. Data access: add the two scopes above. Both are sensitive scopes.
5. Clients: Create client, application type **Desktop app**. Copy the client id and the client
   secret. Google documents that a Desktop client's secret is not treated as a secret (it ships in
   every installed copy); Vicu still keeps it encrypted when it is your own. A Desktop client allows
   `http://127.0.0.1` on any port, so no redirect URI is registered.
6. Paste both into `OFFICIAL_CLIENTS.google` (`clientId`, `clientSecret`).

### Testing and production

- **Testing** (the start): only the test users you list (up to 100) can sign in, and Google ends
  every sign-in after **7 days**. Vicu then shows "Sign in again" on the account.
- **In production without verification**: anyone can sign in after an "unverified app" warning,
  up to 100 users in all. Sign-ins no longer end after 7 days. This is the easiest setting for your
  own client.
- **Verified** (needed for the official app): Google reviews apps with sensitive scopes. It asks
  for a verified domain (Search Console) that holds the home page and the privacy policy, a privacy
  policy that says how Google user data is used (and that it follows the Limited Use requirements),
  a short demo video (unlisted on YouTube) that shows the sign-in, the consent screen with the
  scopes, and where the calendar appears in Vicu, and a reason for each scope. A Google Workspace
  organisation can instead mark a client as Internal (only its own users, no review).

## Trying a change without a provider

Unpackaged builds read `VICU_TEST_CALENDAR_ENDPOINTS` (JSON with `microsoft` and `google` endpoint
overrides and optional `clients`), which the unit tests and the harness scenario `calendar-accounts`
point at the local fake in `scripts/ui-verify/fake-calendar-oauth.mjs`. A packaged build ignores it.
