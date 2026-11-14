# Runbook: evenkeel on the mini PC

evenkeel is hosted exactly like foodlab and sideshow, beside them on the same mini PC.
**sideshow's runbook is the reference** (tools, Cloudflare, reboots, why this setup) and
**foodlab's** has the same steps with its names; this file has only what's different.
Legend: **[Evan]** = needs Evan.

## At a glance

| | |
|---|---|
| Code | `C:\Apps\evenkeel`, a clone that only pulls `main` |
| Server | Scheduled task **evenkeel** (at startup, as SYSTEM); `scripts\run.cmd` restarts it |
| Port | **8083**, reached as `127.0.0.1:8083` (8080 Caddy, 8081 sideshow, 8082 foodlab) |
| Address | **https://evenkeel.evans.tools** |
| Login | Cloudflare Access app `evenkeel`, only Evan's email; `evenkeel icons` app lets the manifest and icons through (needed for Android) |
| Data | `C:\Apps\evenkeel\data\evenkeel.db`; dev note files in `data\files` |
| Backups | Daily to `\\evnas\Junk\Tech\DBBackups\evenkeel`, 30 kept |
| Log | `C:\Apps\evenkeel\data\server.log` |

## First run on NOSTROMO (before deploying)

1. **[Evan]** `git clone https://github.com/eacartwright/evenkeel C:\Dev\evenkeel`, then in it
   `npm install`, `npm test`, `npm run dev`. Open http://localhost:5175.
2. If the server says `listen EACCES`, reserve 8789 and 5175 the way 8787 / 8788 were
   (sideshow's runbook), rather than picking another port.
3. The phone can try it on the LAN at the "Network" URL Vite prints (no install or share target
   over plain http; that needs the deployed https address).

## First deploy

1. On the mini PC:
   ```powershell
   git clone https://github.com/eacartwright/evenkeel C:\Apps\evenkeel
   cd C:\Apps\evenkeel
   npm ci
   npm test
   ```
2. **[Evan]** Admin PowerShell:
   ```powershell
   cd C:\Apps\evenkeel
   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Port 8083 -BackupDir \\evnas\Junk\Tech\DBBackups\evenkeel
   ```
   Ends with `evenkeel is up on http://127.0.0.1:8083 …`.
3. **[Evan]** Cloudflare, in this order (sideshow runbook §3b–3e):
   - **Access app first**: Self-hosted, name `evenkeel`, hostname `evenkeel.evans.tools`,
     session 1 month, policy Allow → Emails → Evan's.
   - **Tunnel hostname**: the existing evans.tools tunnel → Public hostname `evenkeel` ·
     `evans.tools` → HTTP `127.0.0.1:8083`.
   - **Public icons** (`evenkeel icons`, Bypass, Everyone) for `manifest.webmanifest`,
     `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`. Without it Chrome makes
     a plain shortcut, which can't be a share target.
4. Verify: the site and `/api/health` → 302 to the Access login; the five icon paths → 200;
   **[Evan]** desktop: sign in, status **Saved**.
5. **[Evan]** Android: Chrome → `evenkeel.evans.tools` → sign in → ⋮ → **Install app**. Share any
   web page and look for **Evenkeel** in the share sheet; long-press the icon for Capture,
   Today and Inbox shortcuts. It has to be **Chrome's** install.

## Everyday

- **Update** after a push to `main`: the **Update Evenkeel** shortcut on the desktop (it runs
  `.\scripts\update.ps1` in `C:\Apps\evenkeel` as admin).
  The installed app offers **↻ Update** next time it's opened. Or from a dev machine:
  `ssh ripley-deploy evenkeel`. **Deploys over SSH** (all the apps in `C:\Apps`) are set up in
  foodlab's runbook ("Deploys over SSH"): a key locked to `C:\Apps\deploy.ps1`, which runs an
  app's `scripts\update.ps1` and nothing else.
- **Health:** `Invoke-RestMethod http://127.0.0.1:8083/api/health`.
- **Restore a backup:** `Stop-ScheduledTask evenkeel`, copy the backup over `data\evenkeel.db`,
  delete `data\evenkeel.db-wal` and `-shm`, `Start-ScheduledTask evenkeel`.
- **Signed out:** the status badge says **Signed out · Sign in**; changes wait on the device.
- **Dev notes** are mirrored to `data\dev-notes.md` (`Z:\Apps\evenkeel\data\dev-notes.md` from
  the laptop). Never open the live `evenkeel.db` over the share.

## AI keys (next: ramble capture and clarify)

The same keys as foodlab, added the same way (foodlab's runbook, "AI keys"): `ANTHROPIC_API_KEY`
and `OPENAI_API_KEY` in `C:\Apps\evenkeel\.env`, then restart the task. Separate keys per app
("evenkeel mini PC") keep each app's spend visible on the providers' dashboards.
