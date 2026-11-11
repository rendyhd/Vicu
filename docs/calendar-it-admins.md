# Vicu and your organisation's calendars: a page for IT

Vicu is a desktop task app. A user can show their work calendar's events on Vicu's planning
screen, so that meetings count as busy time when they plan their day. When they connect a
Microsoft 365 account, Vicu asks Microsoft for read-only access. If your organisation does not let
users consent to apps themselves, they see "Your organisation needs to approve Vicu" and are sent
here.

## What Vicu asks for

| Permission (Microsoft Graph, delegated) | Why |
|---|---|
| `Calendars.ReadBasic` | Read the user's calendar list and events: times, title, location, show-as, the user's response |
| `offline_access` | Stay signed in without asking again every hour |
| `openid`, `profile` | Know which account signed in (name and sign-in address) |

- **Read-only.** Vicu never creates, changes or deletes an event, never answers an invitation and
  never asks for a write permission.
- `Calendars.ReadBasic` does not include event descriptions, attendees' details, attachments or
  extensions. Vicu does not ask for mail, files, contacts or any application permission.
- Only the calendars the user picks are read, and only for the weeks around the days on screen.

## Where the data goes

- **It stays on the user's computer.** Vicu talks to Microsoft Graph directly from the desktop app.
  There is no Vicu server.
- The sign-in (refresh and access tokens) is kept encrypted with the operating system's protection
  (Windows DPAPI, macOS Keychain, the Linux keyring), in the user's profile only.
- A copy of the last events read is kept on the device, also encrypted, so the planner works
  offline. A calendar can be set to "Busy only", which keeps no titles or places at all.
- Calendar events are **never sent to the user's Vikunja server** (where their tasks are), never
  synced to their other devices, and **never sent to Vicu's AI assistant**. The assistant only ever
  gets free time ranges, never an event's title, place or calendar.
- Removing the account in Vicu deletes the tokens and the copy from the device.

## Granting consent for everyone

An administrator with the Cloud Application Administrator or Application Administrator role (or
Global Administrator) can consent once for the whole tenant.

- **From the Entra admin center:** Enterprise applications, find Vicu (after one user has tried to
  sign in, or via the URL below), Permissions, **Grant admin consent for (your organisation)**.
- **With a URL:** open this address, signed in as an administrator, with your tenant's id or
  primary domain and Vicu's application (client) ID:

  ```
  https://login.microsoftonline.com/{tenant}/v2.0/adminconsent?client_id={client-id}&scope=https://graph.microsoft.com/Calendars.ReadBasic&redirect_uri=http://localhost
  ```

  After consenting, the browser goes to `http://localhost` and shows a connection error. That is
  expected: the consent is recorded.

Vicu's application (client) ID is published in the Vicu repository (`OFFICIAL_CLIENTS` in
`src/main/calendar/oauth-clients.ts`). If a user connected with their own registered client
("Use my own client"), use that client's id instead.

Your Conditional Access policies apply to Vicu's sign-in like any other app. To remove access
later, delete Vicu under Enterprise applications; users can also remove it at myaccount.microsoft.com.

## Google Workspace

A Google account asks for `calendar.events.readonly` and `calendar.calendarlist.readonly`, read-only.
If your Workspace restricts third-party apps, an administrator can allow Vicu in the Admin console:
Security, Access and data control, API controls, Manage third-party app access, then add Vicu by its
OAuth client id and set it to Trusted or Limited. The same rules apply: data stays on the device,
nothing goes to a Vicu server, the Vikunja server or the assistant.
