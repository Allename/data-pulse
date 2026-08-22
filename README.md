# DataPulse

A small, self-hosted dashboard that tracks your **MTN FiberX** daily and monthly
data usage by reading the byte counters straight off your own router. No MTN
login, no cloud account, no third party — **all data stays on your machine.**

![daily + cumulative usage charts, on your own machine]

## How it works

DataPulse logs into your router on your home network, reads the total bytes that
have passed through the fibre connection, and records the difference every 30
minutes. From that it shows you today's usage, your monthly total, a daily
pace line, and an end-of-cycle projection.

Because it talks to a router that only exists on *your* network, **there is no
central website to sign up for — each person runs their own copy at home.** Think
of it like a printer on your LAN: it only works from inside the house.

## Requirements

- A computer on the same network as your router that can stay on (your everyday
  Mac/PC is fine; a Raspberry Pi is ideal for 24/7 tracking).
- [Node.js](https://nodejs.org) 18 or newer.
- Your **router admin password** (the one for the router's web page, not your
  Wi-Fi password or your MTN account).

> **Router compatibility:** this was built and tested against a **Huawei
> HG8145X7** ONT (the unit MTN ships with FiberX). MTN also ships other models —
> if yours is different, the login flow or the stats page may not match and
> DataPulse may need adjusting for it.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Tell DataPulse how to reach your router (asks for address + admin password)
npm run setup

# 3. Build and start the dashboard
npm start
```

Then open **http://localhost:5177**.

The first sync captures a baseline; **actual usage appears after the second sync
(~30 minutes later)**, once there are two readings to compare.

### Finding your router details

- **Router address:** usually your network's gateway. On the setup prompt the
  default is `https://192.168.100.1:80`. If that's not yours, run
  `ipconfig getifaddr en0` (Mac) or check your OS network settings for the
  "router"/"gateway" address. Note the `:80` — this firmware serves its admin
  page over HTTPS on port 80, which is unusual but correct.
- **Admin password:** printed on a sticker on the router, or whatever you changed
  it to. It's the password for the router's own web interface.

## Keeping it running 24/7

For continuous tracking, DataPulse needs to keep running and syncing. The good
news: **the byte counter lives on your router, which is always on, so a sleeping
computer never loses data** — the next sync after wake captures everything that
passed while it was asleep. Sleep only smears *which day* overnight usage is
attributed to; your monthly total stays exact.

So you only need to (1) keep the server auto-starting, and optionally (2) wake
the machine briefly before midnight for clean per-day splits.

### macOS (launchd)

A ready-made service file, `com.datapulse.tracker.plist`, is included. Edit the
two absolute paths inside it to match your machine (your `node` path — find it
with `which node` — and the project folder), then install it:

```bash
cp com.datapulse.tracker.plist ~/Library/LaunchAgents/ && launchctl load -w ~/Library/LaunchAgents/com.datapulse.tracker.plist
```

It now starts at every login and restarts itself if it crashes. Remove it with
`launchctl unload -w ~/Library/LaunchAgents/com.datapulse.tracker.plist`.

*Optional — clean daily splits:* wake the Mac daily at 11:57 PM so a sync lands
before midnight (needs your password; best when plugged in):

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 23:57:00
```

### Windows (Task Scheduler)

Use the built-in Task Scheduler — no extra software needed.

1. **Create Task** (not "Basic Task"). Name it `DataPulse`.
2. **General:** tick *Run whether user is logged on or not*.
3. **Triggers → New:** *At startup*.
4. **Actions → New:** Start a program.
   - Program: your Node path, e.g. `C:\Program Files\nodejs\node.exe`
   - Add arguments: `serve.mjs`
   - Start in: the project folder, e.g. `C:\Users\you\Desktop\datapulse`
5. **Settings:** tick *If the task fails, restart every 1 minute* (up to 3 times),
   and set *If the task is already running: Do not start a new instance.*

*Optional — clean daily splits:* add a second **Trigger** *Daily at 11:57 PM*,
and under **Conditions** tick *Wake the computer to run this task* (make sure
your power plan allows wake timers).

### Linux / Raspberry Pi (systemd)

An always-on Pi is the ideal home for this. Create
`~/.config/systemd/user/datapulse.service`:

```ini
[Unit]
Description=DataPulse
[Service]
WorkingDirectory=%h/datapulse
ExecStart=/usr/bin/node serve.mjs
Restart=always
[Install]
WantedBy=default.target
```

Then: `systemctl --user enable --now datapulse` (and `sudo loginctl enable-linger
$USER` so it runs without you logged in). A Pi doesn't sleep, so day splits are
always clean.

### Simplest option (any OS)

If the scheduler setup feels like too much, just set your machine to **never
sleep while plugged in** (macOS: Battery settings; Windows: Power plan → Sleep =
Never) and leave `npm start` running. Heavier on power, but foolproof.

## Privacy & security

- Your router password is stored locally in `config.json` (readable only by your
  user account) and is used only to log into your own router.
- Usage history lives in `store.json` on your machine.
- The dashboard listens on `localhost` only — it is not exposed to the internet.
- `config.json`, `store.json`, and `debug/` are git-ignored so you never
  accidentally share your password, history, or a session cookie. **Do not
  commit or send these files to anyone.**

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Save/update your router address, username, and password |
| `npm start` | Build the UI and run the dashboard + auto-sync |
| `npm run sync` | Run a single sync now (useful for testing) |
| `npm run dev` | Front-end dev server with hot reload |

## Troubleshooting

- **`fetch failed`** — the app can't reach the router. Check the address in
  `config.json`. If your router recently updated firmware, it may have switched
  between `http://`, `https://`, and the `:80` port; re-run `npm run setup` and
  try the alternatives.
- **`Could not get login token … is another admin session open?`** — the router
  allows only one admin session at a time. Log out of the router's web page in
  your browser and try again.
- **`Login failed`** — wrong admin password. Re-run `npm run setup`.
- **`Could not locate WAN byte counters`** — your router model exposes its stats
  differently. This likely needs a code tweak for your model.
