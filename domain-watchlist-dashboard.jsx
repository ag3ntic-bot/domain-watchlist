import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "domain-watchlist-v1";

// Mock data for demo purposes (replace with real API calls to your Python backend)
const MOCK_STATUSES = ["registered", "available", "expiring_soon", "pending_delete", "redemption_period"];
const MOCK_REGISTRARS = ["GoDaddy", "Namecheap", "Cloudflare", "Google Domains", "Porkbun", "Dynadot"];

function generateMockWhois(domain) {
  const status = MOCK_STATUSES[Math.floor(Math.random() * MOCK_STATUSES.length)];
  const daysUntilExpiry = Math.floor(Math.random() * 365) + 1;
  const expiryDate = new Date(Date.now() + daysUntilExpiry * 86400000).toISOString().split("T")[0];
  return {
    status,
    registrar: status === "available" ? null : MOCK_REGISTRARS[Math.floor(Math.random() * MOCK_REGISTRARS.length)],
    expiryDate: status === "available" ? null : expiryDate,
    daysUntilExpiry: status === "available" ? null : daysUntilExpiry,
    nameServers: status === "available" ? [] : ["ns1.example.com", "ns2.example.com"],
    lastChecked: new Date().toISOString(),
  };
}

const STATUS_CONFIG = {
  registered: { label: "Registered", color: "#64748b", bg: "#f1f5f9", icon: "🔒" },
  available: { label: "Available!", color: "#16a34a", bg: "#f0fdf4", icon: "✨" },
  expiring_soon: { label: "Expiring Soon", color: "#ea580c", bg: "#fff7ed", icon: "⏰" },
  pending_delete: { label: "Pending Delete", color: "#dc2626", bg: "#fef2f2", icon: "🗑️" },
  redemption_period: { label: "Redemption", color: "#9333ea", bg: "#faf5ff", icon: "♻️" },
  unchecked: { label: "Not Checked", color: "#94a3b8", bg: "#f8fafc", icon: "❓" },
};

const API_BASE = "http://localhost:5000";

export default function DomainWatchlist() {
  const [domains, setDomains] = useState([]);
  const [newDomain, setNewDomain] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingDomain, setCheckingDomain] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("added");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    apiUrl: API_BASE,
    email: "",
    useMockData: true,
  });
  const [notification, setNotification] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Load from persistent storage
  useEffect(() => {
    async function load() {
      try {
        const result = await window.storage.get("domains");
        if (result?.value) setDomains(JSON.parse(result.value));
      } catch {
        // No stored data yet
      }
      try {
        const result = await window.storage.get("settings");
        if (result?.value) setSettings(JSON.parse(result.value));
      } catch {}
    }
    load();
  }, []);

  // Save domains
  useEffect(() => {
    if (domains.length > 0) {
      window.storage.set("domains", JSON.stringify(domains)).catch(() => {});
    }
  }, [domains]);

  // Save settings
  useEffect(() => {
    window.storage.set("settings", JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  const showNotif = (msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const addDomain = (name) => {
    const cleaned = name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!cleaned || !cleaned.includes(".")) return false;
    if (domains.find((d) => d.name === cleaned)) {
      showNotif(`${cleaned} is already in your watchlist`, "warn");
      return false;
    }
    const domain = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: cleaned,
      status: "unchecked",
      registrar: null,
      expiryDate: null,
      daysUntilExpiry: null,
      lastChecked: null,
      previousStatus: null,
      addedAt: new Date().toISOString(),
      notes: "",
      starred: false,
    };
    setDomains((prev) => [domain, ...prev]);
    showNotif(`Added ${cleaned}`, "success");
    return true;
  };

  const handleAddDomain = () => {
    if (addDomain(newDomain)) setNewDomain("");
  };

  const handleBulkAdd = () => {
    const lines = bulkInput.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
    let added = 0;
    lines.forEach((l) => { if (addDomain(l)) added++; });
    showNotif(`Added ${added} domain${added !== 1 ? "s" : ""}`, "success");
    setBulkInput("");
    setShowBulkAdd(false);
  };

  const removeDomain = (id) => {
    setDomains((prev) => prev.filter((d) => d.id !== id));
    showNotif("Domain removed");
  };

  const toggleStar = (id) => {
    setDomains((prev) => prev.map((d) => (d.id === id ? { ...d, starred: !d.starred } : d)));
  };

  const checkDomain = async (id) => {
    setCheckingDomain(id);
    const domain = domains.find((d) => d.id === id);
    if (!domain) return;

    try {
      let data;
      if (settings.useMockData) {
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
        data = generateMockWhois(domain.name);
      } else {
        const res = await fetch(`${settings.apiUrl}/check/${domain.name}`);
        data = await res.json();
      }

      setDomains((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                previousStatus: d.status !== "unchecked" ? d.status : null,
                status: data.status,
                registrar: data.registrar,
                expiryDate: data.expiryDate,
                daysUntilExpiry: data.daysUntilExpiry,
                lastChecked: data.lastChecked,
              }
            : d
        )
      );

      if (data.status === "available") {
        showNotif(`🎉 ${domain.name} is AVAILABLE!`, "success");
      }
    } catch (e) {
      showNotif(`Failed to check ${domain.name}: ${e.message}`, "error");
    }
    setCheckingDomain(null);
  };

  const checkAll = async () => {
    setChecking(true);
    for (const domain of domains) {
      await checkDomain(domain.id);
    }
    setChecking(false);
    showNotif("All domains checked", "success");
  };

  const filteredDomains = domains
    .filter((d) => {
      if (filter === "all") return true;
      if (filter === "starred") return d.starred;
      if (filter === "changed") return d.previousStatus && d.previousStatus !== d.status;
      return d.status === filter;
    })
    .filter((d) => !searchQuery || d.name.includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "status") return (a.status || "").localeCompare(b.status || "");
      if (sortBy === "expiry") return (a.daysUntilExpiry || 9999) - (b.daysUntilExpiry || 9999);
      return new Date(b.addedAt) - new Date(a.addedAt);
    });

  const stats = {
    total: domains.length,
    available: domains.filter((d) => d.status === "available").length,
    expiring: domains.filter((d) => d.status === "expiring_soon").length,
    pending: domains.filter((d) => d.status === "pending_delete").length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", color: "#e2e8f0", fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}>
      {/* Notification */}
      {notification && (
        <div
          style={{
            position: "fixed", top: 20, right: 20, zIndex: 999,
            padding: "12px 20px", borderRadius: 8,
            background: notification.type === "success" ? "#16a34a" : notification.type === "error" ? "#dc2626" : notification.type === "warn" ? "#ea580c" : "#3b82f6",
            color: "#fff", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            animation: "slideIn 0.3s ease",
          }}
        >
          {notification.msg}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes fadeUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0e17; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        input:focus, textarea:focus { outline: none; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌐</div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.02em" }}>Domain Watchlist</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>WHOIS Monitor & Alerts</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #1e293b", background: showSettings ? "#1e293b" : "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer", transition: "all 0.2s" }}
          >
            ⚙️ Settings
          </button>
          <button
            onClick={checkAll}
            disabled={checking || domains.length === 0}
            style={{
              padding: "8px 16px", borderRadius: 6, border: "none",
              background: checking ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              color: "#fff", fontSize: 12, fontWeight: 600, cursor: checking ? "not-allowed" : "pointer",
              opacity: domains.length === 0 ? 0.4 : 1, transition: "all 0.2s",
            }}
          >
            {checking ? "⏳ Checking..." : "🔍 Check All"}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{ borderBottom: "1px solid #1e293b", padding: "20px 32px", background: "#0d1220", animation: "fadeUp 0.2s ease" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, maxWidth: 800 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Backend API URL</label>
              <input
                value={settings.apiUrl}
                onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                placeholder="http://localhost:5000"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "#0a0e17", color: "#e2e8f0", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Alert Email</label>
              <input
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                placeholder="you@gmail.com"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "#0a0e17", color: "#e2e8f0", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Data Source</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => setSettings({ ...settings, useMockData: true })}
                  style={{
                    padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    border: settings.useMockData ? "1px solid #3b82f6" : "1px solid #1e293b",
                    background: settings.useMockData ? "#1e3a5f" : "transparent",
                    color: settings.useMockData ? "#60a5fa" : "#64748b",
                  }}
                >
                  Demo Mode
                </button>
                <button
                  onClick={() => setSettings({ ...settings, useMockData: false })}
                  style={{
                    padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    border: !settings.useMockData ? "1px solid #16a34a" : "1px solid #1e293b",
                    background: !settings.useMockData ? "#14532d" : "transparent",
                    color: !settings.useMockData ? "#4ade80" : "#64748b",
                  }}
                >
                  Live API
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total Watched", value: stats.total, color: "#3b82f6", icon: "📋" },
            { label: "Available", value: stats.available, color: "#16a34a", icon: "✨" },
            { label: "Expiring Soon", value: stats.expiring, color: "#ea580c", icon: "⏰" },
            { label: "Pending Delete", value: stats.pending, color: "#dc2626", icon: "🗑️" },
          ].map((s) => (
            <div key={s.label} style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid #1e293b", background: "#0d1220" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Add Domain */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
              placeholder="Enter domain name (e.g. example.com)"
              style={{
                flex: 1, padding: "12px 16px", borderRadius: 8, border: "1px solid #1e293b",
                background: "#0d1220", color: "#e2e8f0", fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <button
              onClick={handleAddDomain}
              style={{ padding: "12px 20px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              + Add
            </button>
            <button
              onClick={() => setShowBulkAdd(!showBulkAdd)}
              style={{ padding: "12px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              📋 Bulk
            </button>
          </div>

          {showBulkAdd && (
            <div style={{ marginTop: 12, animation: "fadeUp 0.2s ease" }}>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={"Paste multiple domains, one per line:\nexample.com\ncoolstartup.io\nmybrand.dev"}
                rows={5}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 8, border: "1px solid #1e293b",
                  background: "#0d1220", color: "#e2e8f0", fontSize: 12, resize: "vertical",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
              <button onClick={handleBulkAdd} style={{ marginTop: 8, padding: "8px 16px", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Add All
              </button>
            </div>
          )}
        </div>

        {/* Filters & Search */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { key: "all", label: "All" },
              { key: "available", label: "Available" },
              { key: "expiring_soon", label: "Expiring" },
              { key: "pending_delete", label: "Pending" },
              { key: "starred", label: "⭐ Starred" },
              { key: "changed", label: "🔄 Changed" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
                  border: filter === f.key ? "1px solid #3b82f6" : "1px solid transparent",
                  background: filter === f.key ? "#1e3a5f" : "transparent",
                  color: filter === f.key ? "#60a5fa" : "#64748b",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔎 Search..."
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "#0d1220", color: "#e2e8f0", fontSize: 11, width: 160 }}
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #1e293b", background: "#0d1220", color: "#94a3b8", fontSize: 11 }}
            >
              <option value="added">Sort: Recent</option>
              <option value="name">Sort: Name</option>
              <option value="status">Sort: Status</option>
              <option value="expiry">Sort: Expiry</option>
            </select>
          </div>
        </div>

        {/* Domain List */}
        {filteredDomains.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🌐</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {domains.length === 0 ? "Add domains above to start monitoring" : "No domains match your filter"}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredDomains.map((d, i) => {
              const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.unchecked;
              const isChecking = checkingDomain === d.id;
              const statusChanged = d.previousStatus && d.previousStatus !== d.status;
              return (
                <div
                  key={d.id}
                  style={{
                    padding: "14px 20px", borderRadius: 10,
                    border: statusChanged ? "1px solid #f59e0b" : d.status === "available" ? "1px solid #16a34a33" : "1px solid #1e293b",
                    background: d.status === "available" ? "#0a1a0f" : "#0d1220",
                    display: "flex", alignItems: "center", gap: 16,
                    animation: `fadeUp 0.2s ease ${i * 0.03}s both`,
                    transition: "all 0.2s",
                  }}
                >
                  {/* Star */}
                  <button onClick={() => toggleStar(d.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, opacity: d.starred ? 1 : 0.3, transition: "opacity 0.2s" }}>
                    {d.starred ? "⭐" : "☆"}
                  </button>

                  {/* Domain Name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d.name}
                    </div>
                    {d.registrar && (
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>via {d.registrar}</div>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div style={{
                    padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: sc.bg, color: sc.color, whiteSpace: "nowrap",
                    border: `1px solid ${sc.color}22`,
                    animation: d.status === "available" ? "pulse 2s infinite" : "none",
                  }}>
                    {sc.icon} {sc.label}
                  </div>

                  {/* Status Change Indicator */}
                  {statusChanged && (
                    <div style={{ fontSize: 10, color: "#f59e0b", whiteSpace: "nowrap" }}>
                      🔄 was: {STATUS_CONFIG[d.previousStatus]?.label}
                    </div>
                  )}

                  {/* Expiry */}
                  <div style={{ width: 100, textAlign: "right" }}>
                    {d.expiryDate ? (
                      <>
                        <div style={{ fontSize: 11, color: d.daysUntilExpiry < 30 ? "#ea580c" : "#64748b" }}>
                          {d.daysUntilExpiry}d left
                        </div>
                        <div style={{ fontSize: 9, color: "#475569" }}>{d.expiryDate}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 10, color: "#334155" }}>—</div>
                    )}
                  </div>

                  {/* Last Checked */}
                  <div style={{ width: 80, textAlign: "right" }}>
                    {d.lastChecked ? (
                      <div style={{ fontSize: 9, color: "#475569" }}>
                        {new Date(d.lastChecked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    ) : (
                      <div style={{ fontSize: 9, color: "#334155" }}>never</div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => checkDomain(d.id)}
                      disabled={isChecking}
                      style={{
                        padding: "6px 10px", borderRadius: 6, border: "1px solid #1e293b",
                        background: "transparent", color: isChecking ? "#334155" : "#94a3b8",
                        fontSize: 11, cursor: isChecking ? "not-allowed" : "pointer",
                      }}
                    >
                      {isChecking ? <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> : "Check"}
                    </button>
                    <button
                      onClick={() => removeDomain(d.id)}
                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: "#475569", fontSize: 11, cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 10, color: "#334155" }}>
            {settings.useMockData ? "🟡 Demo Mode — connect the Python backend for real WHOIS lookups" : "🟢 Live Mode — connected to " + settings.apiUrl}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                const csv = domains.map((d) => `${d.name},${d.status},${d.expiryDate || ""},${d.registrar || ""}`).join("\n");
                navigator.clipboard.writeText("domain,status,expiry,registrar\n" + csv);
                showNotif("Exported to clipboard as CSV", "success");
              }}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "transparent", color: "#64748b", fontSize: 10, cursor: "pointer" }}
            >
              📤 Export CSV
            </button>
            <button
              onClick={async () => {
                try { await window.storage.delete("domains"); } catch {}
                setDomains([]);
                showNotif("Watchlist cleared");
              }}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "transparent", color: "#64748b", fontSize: 10, cursor: "pointer" }}
            >
              🗑️ Clear All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
