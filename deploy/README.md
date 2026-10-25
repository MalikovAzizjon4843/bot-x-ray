# Deploying Bot X-Ray to the server (paper only)

Everything runs as the user `xray` (no sudo), listens on `127.0.0.1:3797` only, and is reached through an SSH
tunnel. No public port, no nginx, nothing else on the box is touched. Replace `YOU@SERVER` with your own login.

## 0. Look first (read-only)

```bash
ssh YOU@SERVER 'ss -tlnp; free -h; df -h; nproc; systemctl list-units --type=service --state=running --no-pager; ls /etc/nginx/sites-enabled 2>/dev/null; timedatectl'
```

Check that port 3797 is free and there's room on disk: the raw feed log is capped at 10 GB
(`BOTXRAY_RAWLOG_MAX_GB` in `deploy/bot-x-ray.service`; about 0.5 GB an hour, oldest hours deleted first).
The service is limited to 768 MB of memory and one CPU core, at a lower priority (`Nice=10`, `IOWeight=50`).

## 1. Install

```bash
scp deploy/setup.sh YOU@SERVER:/tmp/bot-x-ray-setup.sh
```

```bash
ssh -t YOU@SERVER 'sudo bash /tmp/bot-x-ray-setup.sh'
```

It creates `xray`, installs nvm + Node 24 for that user, clones the `mm-v2` branch to `/home/xray/bot-x-ray` and
installs + enables `bot-x-ray.service`. Running it again is safe (it updates the code and the unit).

## 2. Start and check

```bash
ssh -t YOU@SERVER 'sudo systemctl start bot-x-ray && systemctl status bot-x-ray --no-pager'
```

```bash
ssh YOU@SERVER 'curl -s http://127.0.0.1:3797/api/mm/feed-health | head -c 400'
```

Logs:

```bash
ssh -t YOU@SERVER 'journalctl -u bot-x-ray -f'
```

## 3. Open the UI through a tunnel

```bash
ssh -N -L 3797:127.0.0.1:3797 YOU@SERVER
```

Leave that running, then open http://localhost:3797/#/mm on your computer (stop any local Bot X-Ray first, or
use another local port: `-L 4797:127.0.0.1:3797` and http://localhost:4797/#/mm). In the **Variants** tab press
**Start all**. Variants keep running across restarts until you press **Stop all**. They're defined in
`/home/xray/bot-x-ray/data/variants.json` (restart the service after editing).

## 4. Update

```bash
ssh -t YOU@SERVER 'sudo bash /tmp/bot-x-ray-setup.sh --start'
```

(or copy the newest `deploy/setup.sh` first). Engines save their state on shutdown and carry on after the restart.

## 5. Stop / remove

```bash
ssh -t YOU@SERVER 'sudo systemctl stop bot-x-ray'
```

```bash
ssh -t YOU@SERVER 'sudo systemctl disable --now bot-x-ray && sudo rm /etc/systemd/system/bot-x-ray.service && sudo systemctl daemon-reload'
```

Data (cycles, raw feed log) stays in `/home/xray/bot-x-ray/data/` until you delete it.

## Notes

- Paper only: no keys, no orders, no account. Nothing here can trade.
- Polymarket blocks trading from some countries; reading the public feed works from anywhere. Note the server's
  country for later, before anything live.
