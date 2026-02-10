# 🌐 Domain Watchlist Monitor

A two-part tool to monitor domains and get Gmail alerts when their status changes.

## Parts

| Part | File | What it does |
|------|------|-------------|
| **Dashboard** | `domain-watchlist-dashboard.jsx` | React UI — add domains, view status, trigger checks |
| **Backend** | `domain_watchlist_backend.py` | Flask API — real WHOIS lookups + Gmail email alerts |

## Quick Start

### 1. Python Backend Setup

```bash
# Install dependencies
pip install flask flask-cors python-whois

# Set your Gmail credentials (use an App Password!)
export GMAIL_ADDRESS="you@gmail.com"
export GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx"

# Start the API server
python domain_watchlist_backend.py
```

> **Gmail App Password:** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) to generate one. You need 2FA enabled on your Google account.

### 2. Dashboard

The `.jsx` file is a Claude artifact — it renders directly in the chat. You can also drop it into any React project.

In the dashboard, toggle **Settings → Live API** to connect to your running backend.

### 3. Automatic Scheduled Checks (Optional)

Run the backend in cron mode to check all your domains on a schedule and email you if anything changes:

```bash
# One-off check
python domain_watchlist_backend.py --cron

# Add to crontab for every 6 hours:
crontab -e
0 */6 * * * cd /path/to/project && python domain_watchlist_backend.py --cron
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/check/<domain>` | Check a single domain |
| `POST` | `/check-batch` | Check multiple domains (`{"domains": [...]}`) |
| `GET` | `/watchlist` | View saved watchlist |
| `POST` | `/watchlist` | Add domains to watchlist |
| `DELETE` | `/watchlist/<domain>` | Remove a domain |
| `POST` | `/send-test-email` | Send a test alert email |
