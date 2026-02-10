"""
Domain Watchlist Monitor - Python Backend
==========================================
Flask API for real WHOIS lookups + Gmail email alerts.

SETUP:
  1. pip install flask flask-cors python-whois
  2. Set your Gmail credentials below (use an App Password, NOT your real password)
     → Go to https://myaccount.google.com/apppasswords to generate one
  3. Run: python domain_watchlist_backend.py
  4. The dashboard connects to http://localhost:5000

SCHEDULED CHECKS (optional):
  Run with --cron flag to do a one-off check of all watched domains and email alerts.
  Add to crontab for automatic monitoring:
    crontab -e
    # Check every 6 hours:
    0 */6 * * * cd /path/to/this && python domain_watchlist_backend.py --cron
"""

import json
import os
import sys
import time
import smtplib
import argparse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone

# ─── CONFIGURATION ───────────────────────────────────────────────────────────

GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS", "you@gmail.com")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "xxxx xxxx xxxx xxxx")
ALERT_RECIPIENT = os.environ.get("ALERT_RECIPIENT", GMAIL_ADDRESS)  # defaults to self

DATA_FILE = "watchlist_state.json"
PORT = 5000

# ─── TLD PRICING & REGISTRAR DATA ──────────────────────────────────────────
# Approximate first-year registration prices (USD) for common TLDs.
# Prices are estimates and may vary by registrar and promotions.

TLD_PRICING = {
    ".com":      {"low": 8.99,  "high": 12.99},
    ".net":      {"low": 9.99,  "high": 14.99},
    ".org":      {"low": 9.99,  "high": 12.99},
    ".io":       {"low": 29.99, "high": 49.99},
    ".dev":      {"low": 10.99, "high": 16.99},
    ".app":      {"low": 11.99, "high": 17.99},
    ".co":       {"low": 9.99,  "high": 29.99},
    ".ai":       {"low": 49.99, "high": 89.99},
    ".me":       {"low": 6.99,  "high": 19.99},
    ".info":     {"low": 3.99,  "high": 14.99},
    ".xyz":      {"low": 1.99,  "high": 12.99},
    ".tech":     {"low": 4.99,  "high": 49.99},
    ".online":   {"low": 1.99,  "high": 34.99},
    ".store":    {"low": 1.99,  "high": 49.99},
    ".site":     {"low": 1.99,  "high": 29.99},
    ".cloud":    {"low": 6.99,  "high": 19.99},
    ".us":       {"low": 6.99,  "high": 12.99},
    ".uk":       {"low": 5.99,  "high": 9.99},
    ".ca":       {"low": 8.99,  "high": 14.99},
    ".de":       {"low": 5.99,  "high": 12.99},
    ".in":       {"low": 5.99,  "high": 12.99},
    ".biz":      {"low": 9.99,  "high": 16.99},
    ".tv":       {"low": 29.99, "high": 39.99},
    ".cc":       {"low": 9.99,  "high": 19.99},
    ".so":       {"low": 19.99, "high": 39.99},
    ".gg":       {"low": 39.99, "high": 79.99},
}

REGISTRARS = [
    {
        "name": "Namecheap",
        "url": "https://www.namecheap.com/domains/registration/results/?domain={domain}",
        "icon": "namecheap",
    },
    {
        "name": "Cloudflare",
        "url": "https://www.cloudflare.com/products/registrar/",
        "icon": "cloudflare",
        "note": "At-cost pricing",
    },
    {
        "name": "Porkbun",
        "url": "https://porkbun.com/checkout/search?q={domain}",
        "icon": "porkbun",
    },
    {
        "name": "GoDaddy",
        "url": "https://www.godaddy.com/domainsearch/find?domainToCheck={domain}",
        "icon": "godaddy",
    },
    {
        "name": "Google Domains",
        "url": "https://domains.google.com/registrar/search?searchTerm={domain}",
        "icon": "google",
    },
]


def get_domain_tld(domain_name):
    """Extract the TLD from a domain name (e.g., 'example.co.uk' -> '.co.uk')."""
    parts = domain_name.rsplit(".", 1)
    if len(parts) == 2:
        return "." + parts[1]
    return None


def get_pricing_info(domain_name):
    """Return pricing estimates and registrar purchase links for a domain."""
    tld = get_domain_tld(domain_name)
    pricing = TLD_PRICING.get(tld) if tld else None

    purchase_links = []
    for reg in REGISTRARS:
        purchase_links.append({
            "name": reg["name"],
            "url": reg["url"].format(domain=domain_name),
            "note": reg.get("note"),
        })

    return {
        "tld": tld,
        "estimatedPrice": pricing,
        "currency": "USD",
        "purchaseLinks": purchase_links,
        "note": "Prices are approximate first-year registration costs and may vary.",
    }

# ─── STATE MANAGEMENT ────────────────────────────────────────────────────────

def load_state():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    return {"domains": {}, "last_run": None}


def save_state(state):
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ─── WHOIS LOOKUP ────────────────────────────────────────────────────────────

def check_domain(domain_name):
    """
    Perform a WHOIS lookup and return structured status info.
    """
    try:
        import whois
    except ImportError:
        return {
            "status": "error",
            "error": "python-whois not installed. Run: pip install python-whois",
            "lastChecked": datetime.now(timezone.utc).isoformat(),
        }

    try:
        w = whois.whois(domain_name)

        # Determine if domain is registered
        if w.domain_name is None:
            result = {
                "status": "available",
                "registrar": None,
                "expiryDate": None,
                "daysUntilExpiry": None,
                "nameServers": [],
                "lastChecked": datetime.now(timezone.utc).isoformat(),
            }
            result["pricing"] = get_pricing_info(domain_name)
            return result

        # Parse expiry date
        expiry = w.expiration_date
        if isinstance(expiry, list):
            expiry = expiry[0]

        days_until_expiry = None
        expiry_str = None
        status = "registered"

        if expiry:
            if hasattr(expiry, "date"):
                expiry_str = expiry.strftime("%Y-%m-%d")
                delta = expiry - datetime.now()
                days_until_expiry = delta.days

                if days_until_expiry < 0:
                    status = "pending_delete"
                elif days_until_expiry < 30:
                    status = "expiring_soon"
            else:
                expiry_str = str(expiry)

        # Parse WHOIS status codes for more detail
        whois_status = w.status
        if isinstance(whois_status, str):
            whois_status = [whois_status]
        elif whois_status is None:
            whois_status = []

        status_lower = " ".join(whois_status).lower()
        if "pendingdelete" in status_lower:
            status = "pending_delete"
        elif "redemptionperiod" in status_lower:
            status = "redemption_period"

        # Name servers
        ns = w.name_servers
        if isinstance(ns, str):
            ns = [ns]
        elif ns is None:
            ns = []

        return {
            "status": status,
            "registrar": w.registrar,
            "expiryDate": expiry_str,
            "daysUntilExpiry": days_until_expiry,
            "nameServers": [str(n).lower() for n in ns],
            "whoisStatus": whois_status,
            "lastChecked": datetime.now(timezone.utc).isoformat(),
        }

    except (whois.exceptions.PywhoisError, whois.exceptions.WhoisDomainNotFoundError, whois.WhoisError):
        # Domain not found = available
        result = {
            "status": "available",
            "registrar": None,
            "expiryDate": None,
            "daysUntilExpiry": None,
            "nameServers": [],
            "lastChecked": datetime.now(timezone.utc).isoformat(),
        }
        result["pricing"] = get_pricing_info(domain_name)
        return result
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "lastChecked": datetime.now(timezone.utc).isoformat(),
        }


# ─── EMAIL ALERTS ────────────────────────────────────────────────────────────

def send_email_alert(subject, body_html):
    """Send an email alert via Gmail SMTP."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = GMAIL_ADDRESS
        msg["To"] = ALERT_RECIPIENT

        # Plain text fallback
        plain = body_html.replace("<br>", "\n").replace("</p>", "\n")
        import re
        plain = re.sub(r"<[^>]+>", "", plain)

        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, ALERT_RECIPIENT, msg.as_string())

        print(f"  ✉️  Alert email sent to {ALERT_RECIPIENT}")
        return True
    except Exception as e:
        print(f"  ❌ Failed to send email: {e}")
        return False


def build_alert_email(changes):
    """Build a nicely formatted HTML alert email."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    rows = ""
    for c in changes:
        color = "#16a34a" if c["new_status"] == "available" else "#ea580c" if c["new_status"] == "expiring_soon" else "#dc2626" if c["new_status"] == "pending_delete" else "#9333ea"
        rows += f"""
        <tr>
            <td style="padding:10px 16px; font-family:monospace; font-size:14px; font-weight:bold;">{c['domain']}</td>
            <td style="padding:10px 16px; color:#64748b;">{c['old_status']}</td>
            <td style="padding:10px 16px; color:#64748b;">→</td>
            <td style="padding:10px 16px; color:{color}; font-weight:bold;">{c['new_status'].upper()}</td>
        </tr>
        """

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0e17; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding: 24px 32px;">
            <h1 style="margin: 0; font-size: 20px; color: #fff;">🌐 Domain Watchlist Alert</h1>
            <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.7);">{now}</p>
        </div>
        <div style="padding: 24px 32px;">
            <p style="color: #94a3b8; font-size: 14px; margin-top: 0;">
                Status changes detected for <strong>{len(changes)}</strong> domain(s):
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <thead>
                    <tr style="border-bottom: 1px solid #1e293b;">
                        <th style="padding: 8px 16px; text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase;">Domain</th>
                        <th style="padding: 8px 16px; text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase;">Was</th>
                        <th style="padding: 8px 16px;"></th>
                        <th style="padding: 8px 16px; text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase;">Now</th>
                    </tr>
                </thead>
                <tbody>
                    {rows}
                </tbody>
            </table>
            <p style="color: #475569; font-size: 12px; margin-top: 24px;">
                — Domain Watchlist Monitor
            </p>
        </div>
    </div>
    """
    return html


# ─── CRON MODE (Scheduled Check) ─────────────────────────────────────────────

def run_cron_check():
    """Check all domains in saved state and send alerts for changes."""
    print(f"\n🔍 Domain Watchlist — Scheduled Check ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})")
    print("=" * 60)

    state = load_state()
    domains = state.get("domains", {})

    if not domains:
        print("  No domains in watchlist. Add domains via the dashboard first.")
        return

    changes = []

    for domain_name, prev_info in domains.items():
        old_status = prev_info.get("status", "unchecked")
        print(f"  Checking {domain_name}...", end=" ", flush=True)

        result = check_domain(domain_name)
        new_status = result.get("status", "error")

        print(f"{old_status} → {new_status}")

        # Update stored state
        state["domains"][domain_name] = result

        # Track changes
        if old_status != "unchecked" and old_status != new_status and new_status != "error":
            changes.append({
                "domain": domain_name,
                "old_status": old_status,
                "new_status": new_status,
            })

        # Be nice to WHOIS servers
        time.sleep(1)

    save_state(state)

    if changes:
        print(f"\n📬 {len(changes)} status change(s) detected! Sending alert...")
        available = [c for c in changes if c["new_status"] == "available"]
        subject = f"🌐 Domain Alert: {len(changes)} change(s)"
        if available:
            subject = f"✨ Domain Available! {', '.join(c['domain'] for c in available)}"

        html = build_alert_email(changes)
        send_email_alert(subject, html)
    else:
        print(f"\n✅ No status changes detected.")

    print(f"\nDone. Next check will compare against this run's results.\n")


# ─── FLASK API ────────────────────────────────────────────────────────────────

def run_server():
    """Run the Flask API server."""
    try:
        from flask import Flask, jsonify, request
        from flask_cors import CORS
    except ImportError:
        print("❌ Flask not installed. Run:")
        print("   pip install flask flask-cors python-whois")
        sys.exit(1)

    app = Flask(__name__)
    CORS(app)

    @app.route("/")
    def index():
        return jsonify({
            "service": "Domain Watchlist Monitor",
            "version": "1.0",
            "endpoints": {
                "/check/<domain>": "Check a single domain's WHOIS status",
                "/check-batch": "POST: Check multiple domains",
                "/watchlist": "GET/POST: Manage the watchlist",
                "/send-test-email": "POST: Send a test email alert",
            }
        })

    @app.route("/check/<domain>")
    def api_check_domain(domain):
        result = check_domain(domain)

        # Save to state for cron comparison
        state = load_state()
        state.setdefault("domains", {})[domain] = result
        save_state(state)

        return jsonify(result)

    @app.route("/check-batch", methods=["POST"])
    def api_check_batch():
        data = request.get_json()
        domains = data.get("domains", [])
        results = {}
        state = load_state()

        for d in domains:
            results[d] = check_domain(d)
            state.setdefault("domains", {})[d] = results[d]
            time.sleep(0.5)  # Rate limiting

        save_state(state)
        return jsonify(results)

    @app.route("/watchlist", methods=["GET"])
    def api_get_watchlist():
        state = load_state()
        return jsonify(state.get("domains", {}))

    @app.route("/watchlist", methods=["POST"])
    def api_update_watchlist():
        data = request.get_json()
        domains = data.get("domains", [])
        state = load_state()

        for d in domains:
            if d not in state.get("domains", {}):
                state.setdefault("domains", {})[d] = {"status": "unchecked"}

        save_state(state)
        return jsonify({"added": len(domains), "total": len(state["domains"])})

    @app.route("/watchlist/<domain>", methods=["DELETE"])
    def api_remove_domain(domain):
        state = load_state()
        removed = state.get("domains", {}).pop(domain, None)
        save_state(state)
        return jsonify({"removed": domain, "found": removed is not None})

    @app.route("/send-test-email", methods=["POST"])
    def api_test_email():
        changes = [{"domain": "example.com", "old_status": "registered", "new_status": "available"}]
        html = build_alert_email(changes)
        success = send_email_alert("🧪 Test Alert — Domain Watchlist", html)
        return jsonify({"success": success})

    print(f"""
╔══════════════════════════════════════════════════════════╗
║  🌐 Domain Watchlist Monitor — API Server               ║
║  Running on http://localhost:{PORT}                       ║
║                                                          ║
║  Endpoints:                                              ║
║    GET  /check/<domain>     Check single domain          ║
║    POST /check-batch        Check multiple domains       ║
║    GET  /watchlist           View saved watchlist         ║
║    POST /send-test-email     Test email alerts            ║
║                                                          ║
║  Press Ctrl+C to stop                                    ║
╚══════════════════════════════════════════════════════════╝
    """)

    app.run(host="0.0.0.0", port=PORT, debug=False)


# ─── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Domain Watchlist Monitor")
    parser.add_argument("--cron", action="store_true", help="Run a scheduled check (use in crontab)")
    parser.add_argument("--port", type=int, default=PORT, help=f"API server port (default: {PORT})")
    args = parser.parse_args()

    if args.cron:
        run_cron_check()
    else:
        PORT = args.port
        run_server()
