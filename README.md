# SouthOps V4.0.3 — JavaScript Test Build

This is the easy-to-run JavaScript test build of SouthOps V4.

## What this test build includes

- Permanent driver profiles linked to Discord user IDs
- Automatic driver stats derived from stored operational history
- Duties stored as unique historical instances (duty numbers may be reused on later days without overwriting history)
- Shift claiming + permanent claim history
- Sign On / Sign Off
- Break tracking
- Staff `/driver @user` record + Claim History button
- Fleet database
- Vehicle allocations and vehicle-change history
- Defect reporting + staff defect board
- Driver requests to Control
- Incident history
- Control Messages channel
- Individual-driver targeting
- Route targeting: SouthOps automatically finds signed-on drivers on selected routes and @mentions them
- Duty targeting and all-active-driver targeting
- Acknowledge button for Control messages
- Multiple depot configuration
- Driver / Controller / Supervisor / Admin permissions
- Operational audit log
- Atomic persistent JSON saves and automatic backups
- Manual `/backup`
- GitHub-friendly project structure

## Priority #1: data durability

Live data is stored in `data/southops-v4.json` and is never meant to be committed to GitHub.

Before replacing the data file SouthOps copies the previous version into `data/backups/latest.json`. It also keeps timestamped rolling backups. Writes go to a temporary file and are flushed before replacing the live file.

**Do not delete the `data` folder if you want to keep your test company's history.**

The data model stores the underlying records, not just lifetime counters. Driver totals are recalculated from claims, duties, breaks, allocations, defects, requests and incidents.

## Quick local setup

1. Install Node.js 18+.
2. Open this folder in Command Prompt / Terminal.
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env` and enter:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_test_server_id
AUTO_DEPLOY_COMMANDS=true
```

5. Start SouthOps:

```bash
node index.js
```

With `AUTO_DEPLOY_COMMANDS=true`, test-server slash commands are refreshed automatically when the bot starts.

## Recommended first test

1. `/setup` — set company name, roles and channels.
2. `/config depot-add` — add one or more depots.
3. `/profile create` — make a driver profile.
4. As Control: `/fleet add` — add a bus.
5. As Control: `/duty create` — create a duty and routes.
6. `/duties` — press **Claim**.
7. `/myduty` — **Sign On**.
8. As Control: `/allocate` — allocate the bus.
9. Try `/control-message route` using one of that duty's routes. SouthOps should automatically @mention the signed-on driver.
10. Try **Start Break / End Break** and `/defect`.
11. **Sign Off**.
12. As Control: `/driver @user` and open **Claim History**.
13. Restart the bot and repeat `/driver @user` to verify the data is still there.

## Permissions

- Driver: normal driver workflow.
- Controller: operational management.
- Supervisor: staff management.
- Admin / Manage Server: configuration and backup.

If no Driver role is configured, normal members are allowed to test driver features.

## GitHub later

`.gitignore` intentionally excludes `.env` and live `data/*.json` files. That prevents tokens and live company history being committed by accident.

For hosted production V4, the storage adapter can later be switched to a hosted database while keeping the bot's command/workflow layer.


## V4.0.3 additions
- Permanent public Live Allocations board via the allocations channel selected in `/setup`.
- Allocation numbers (for example T101) can be assigned to duties independently of fleet numbers.
- Control/Supervisors can edit allocation number, fleet number and duty routes at any time with `/allocation edit`.
- `/allocate` accepts a fleet number, allocation number, or both.
- `/allocations` displays the live sheet to everyone.
- `/fleet remove` archives a vehicle from the active fleet without deleting history.
- `/fleet restore` restores an archived vehicle with all history intact.

### Existing V4.0.2 data
Copy your existing `data` folder into this build before starting it. V4.0.3 normalizes the old data and does not reset it. Always keep a backup.
