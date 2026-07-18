import { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  isDriveConnected,
  connectDrive,
  disconnectDrive,
  backupExpensesToDrive,
  restoreFromDrive,
  getLastBackupTime,
} from "./drive.js";

const STORAGE_KEY = "msite-construction-expenses-v1";
const LOCAL_MODIFIED_KEY = "msite-local-modified";
const INK = "#1D1B16";
const CONCRETE = "#EAE8E3";
const YELLOW = "#F5B700";
const GREY = "#8B8578";

const BASE_CATS = [
  "Mestri", "Electrical & Plumbing", "Hardware items", "JCB & Tractor", "Paya & Digging",
  "Iron bars", "Cement", "Sand & Blocks", "Water tanker", "Wood work",
  "Misc & Tips",
];

const inr = (n) =>
  "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const monthLabel = (ym) => {
  const [y, m] = ym.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names[parseInt(m, 10) - 1] + " '" + y.slice(2);
};

const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

const fmtDateTime = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
};

function migrateCategories(list) {
  if (!Array.isArray(list)) return { migrated: [], changed: false };
  let changed = false;
  const migrated = list.map(item => {
    if (item && typeof item === "object" && typeof item.category === "string") {
      let currentCat = item.category;
      const catNorm = currentCat.trim().toLowerCase();
      
      // 1. Map voice transcription and variations like Mestri Velu, Mestri velu, MestriVelu, Mestrivelu, Miss Srivelu, Miss Sri Velu, etc.
      if (
        catNorm === "mestri velu" ||
        catNorm === "mestrivelu" ||
        catNorm === "miss srivelu" ||
        catNorm === "miss sri velu" ||
        catNorm.includes("velu") ||
        catNorm.includes("srivelu")
      ) {
        currentCat = "Mestri";
        changed = true;
      }
      // Also map "Miss Sri" or "Miss sri" voice transcription to "Mestri"
      else if (catNorm === "miss sri" || catNorm === "miss-sri") {
        currentCat = "Mestri";
        changed = true;
      }
      // 2. Segregate "Electrical & Plumbing" into "Electrical & Plumbing" (Chandru) and "Hardware items" (rest)
      else if (
        catNorm === "electrical & plumbing" ||
        catNorm === "electrical and plumbing" ||
        catNorm === "electrical" ||
        catNorm === "plumbing"
      ) {
        const notesText = (item.notes || "").toLowerCase();
        const paidToText = (item.paidTo || "").toLowerCase();
        const isChandru = notesText.includes("chandru") || paidToText.includes("chandru");
        
        if (isChandru) {
          if (currentCat !== "Electrical & Plumbing") {
            currentCat = "Electrical & Plumbing";
            changed = true;
          }
        } else {
          if (currentCat !== "Hardware items") {
            currentCat = "Hardware items";
            changed = true;
          }
        }
      }
      // 3. Merge "Sand & Jelly" and "Hollow blocks" into "Sand & Blocks"
      else if (
        catNorm === "sand & jelly" ||
        catNorm === "sand and jelly" ||
        catNorm === "hollow blocks" ||
        catNorm === "hollow block" ||
        catNorm === "sand & concrete blocks" ||
        catNorm === "sand and concrete blocks" ||
        catNorm === "send and concrete blocks" ||
        catNorm === "send & concrete blocks" ||
        catNorm === "sand & blocks" ||
        catNorm === "sand and blocks" ||
        catNorm === "send and blocks" ||
        catNorm === "send & blocks"
      ) {
        if (currentCat !== "Sand & Blocks") {
          currentCat = "Sand & Blocks";
          changed = true;
        }
      }
      
      if (item.category !== currentCat) {
        return { ...item, category: currentCat };
      }
    }
    return item;
  });
  return { migrated, changed };
}

function loadStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? JSON.parse(v) : [];
  } catch (e) {
    return [];
  }
}

function MSiteTracker() {
  const [expenses, setExpenses] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [confirmId, setConfirmId] = useState(null);
  const [driveConnected, setDriveConnected] = useState(isDriveConnected());
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveMessage, setDriveMessage] = useState("");
  const [lastBackup, setLastBackup] = useState(getLastBackupTime());
  const [lastModified, setLastModified] = useState(() => localStorage.getItem(LOCAL_MODIFIED_KEY));
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [hoveredCat, setHoveredCat] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("msite-dark-mode") === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem("msite-dark-mode", isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.add("dark-theme");
    } else {
      document.documentElement.classList.remove("dark-theme");
    }
  }, [isDarkMode]);

  const today = new Date().toISOString().slice(0, 10);
  const [fDate, setFDate] = useState(today);
  const [fAmount, setFAmount] = useState("");
  const [fCat, setFCat] = useState(BASE_CATS[0]);
  const [fNotes, setFNotes] = useState("");
  const [newCatMode, setNewCatMode] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  // Edit Expense States
  const [editingExpense, setEditingExpense] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editCat, setEditCat] = useState("");
  const [editNewCatMode, setEditNewCatMode] = useState(false);
  const [editNewCatName, setEditNewCatName] = useState("");
  const [editError, setEditError] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const adoptExpenses = (next) => {
    setExpenses(next);
    const now = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(LOCAL_MODIFIED_KEY, now);
      setLastModified(now);
    } catch (e) {
      setError("Could not save data in this browser. Changes may not persist.");
    }
  };

  // Decide which side is the source of truth and make both match.
  // Never lets an empty side silently wipe out a non-empty one.
  const syncWithDrive = async (localExpenses) => {
    const res = await restoreFromDrive();
    if (!res.ok && res.notFound) {
      if (localExpenses.length > 0) {
        const up = await backupExpensesToDrive(localExpenses);
        if (up.ok) setLastBackup(up.at);
      }
      return;
    }
    if (!res.ok) {
      setDriveMessage(res.error || "Could not check Drive for the latest data.");
      return;
    }
    const driveRaw = res.expenses || [];
    const { migrated: drive, changed: driveChanged } = migrateCategories(driveRaw);
    if (drive.length === 0 && localExpenses.length === 0) return;
    if (localExpenses.length === 0 && drive.length > 0) {
      adoptExpenses(drive);
      showToast(drive.length + " expenses loaded from Google Drive");
      if (driveChanged) {
        const up = await backupExpensesToDrive(drive);
        if (up.ok) setLastBackup(up.at);
      }
      return;
    }
    if (drive.length === 0 && localExpenses.length > 0) {
      const up = await backupExpensesToDrive(localExpenses);
      if (up.ok) setLastBackup(up.at);
      return;
    }
    const localMod = localStorage.getItem(LOCAL_MODIFIED_KEY);
    const driveNewer = res.savedAt && (!localMod || new Date(res.savedAt) > new Date(localMod));
    if (driveNewer) {
      adoptExpenses(drive);
      showToast(drive.length + " expenses loaded from Google Drive");
      if (driveChanged) {
        const up = await backupExpensesToDrive(drive);
        if (up.ok) setLastBackup(up.at);
      }
    } else {
      const up = await backupExpensesToDrive(localExpenses);
      if (up.ok) setLastBackup(up.at);
    }
  };

  useEffect(() => {
    const stored = loadStored();
    const { migrated, changed } = migrateCategories(stored);
    setExpenses(migrated);
    if (changed) {
      adoptExpenses(migrated);
    }
    if (isDriveConnected()) {
      syncWithDrive(migrated);
    }
  }, []);

  useEffect(() => {
    const handlePopState = (e) => {
      if (e.state && typeof e.state.category === "string") {
        setSelectedCategory(e.state.category);
      } else {
        setSelectedCategory(null);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectCategory = (catName) => {
    setSelectedCategory(catName);
    window.history.pushState({ category: catName }, "");
  };

  const closeCategory = () => {
    setSelectedCategory(null);
    if (window.history.state && window.history.state.category) {
      window.history.back();
    }
  };

  const persist = (next) => {
    adoptExpenses(next);
    if (isDriveConnected()) {
      backupExpensesToDrive(next).then((res) => {
        if (res.ok) {
          setLastBackup(res.at);
          setDriveMessage("");
        } else if (!res.skipped) {
          setDriveMessage(res.error || "Backup to Drive failed. Reconnect below.");
        }
      });
    }
  };

  const handleConnectDrive = () => {
    setDriveBusy(true);
    setDriveMessage("");
    connectDrive()
      .then(async () => {
        setDriveConnected(true);
        showToast("Google Drive connected");
        await syncWithDrive(expenses || []);
        setDriveBusy(false);
      })
      .catch((e) => {
        setDriveBusy(false);
        setDriveMessage(e.message || "Could not connect to Google Drive.");
      });
  };

  const handleDisconnectDrive = () => {
    disconnectDrive();
    setDriveConnected(false);
    setLastBackup(null);
    setDriveMessage("");
    showToast("Google Drive disconnected");
  };

  const addExpense = () => {
    const amt = parseFloat(fAmount);
    let cat = fCat;
    if (newCatMode) {
      if (!newCatName.trim()) {
        setError("Type a name for the new category, or pick an existing one.");
        return;
      }
      cat = newCatName.trim();
    }
    if (!fDate || isNaN(amt) || amt <= 0 || !fNotes.trim()) {
      setError("Enter a date, an amount above zero, and a note describing the expense.");
      return;
    }
    setError("");
    const entry = {
      id: "e-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      date: fDate,
      paidTo: "", // legacy field — older imported entries still carry it
      amount: amt,
      category: cat,
      notes: fNotes.trim(),
    };
    persist([...expenses, entry]);
    setFAmount(""); setFNotes(""); setFDate(today);
    setNewCatMode(false); setNewCatName("");
    showToast("Expense added — " + inr(amt));
    setTab("expenses");
  };

  const deleteExpense = (id) => {
    persist(expenses.filter((e) => e.id !== id));
    setConfirmId(null);
    showToast("Expense deleted");
  };

  const closeBottomSheet = () => {
    setIsClosing(true);
    setTimeout(() => {
      setEditingExpense(null);
      setIsClosing(false);
    }, 230);
  };

  const startEditing = (e) => {
    setIsClosing(false);
    setEditingExpense(e);
    setEditName(e.paidTo || "");
    setEditAmount(e.amount.toString());
    setEditDate(e.date);
    setEditNotes(e.notes || "");
    setEditCat(e.category);
    setEditNewCatMode(false);
    setEditNewCatName("");
    setEditError("");
  };

  const saveEditedExpense = () => {
    const amt = parseFloat(editAmount);
    let cat = editCat;
    if (editNewCatMode) {
      if (!editNewCatName.trim()) {
        setEditError("Type a name for the new category, or pick an existing one.");
        return;
      }
      cat = editNewCatName.trim();
    }
    if (!editDate || isNaN(amt) || amt <= 0 || !editNotes.trim()) {
      setEditError("Enter a date, an amount above zero, and a note describing the expense.");
      return;
    }
    setEditError("");

    const updatedExpenses = expenses.map((e) => {
      if (e.id === editingExpense.id) {
        return {
          ...e,
          paidTo: editName.trim(),
          amount: amt,
          date: editDate,
          notes: editNotes.trim(),
          category: cat,
        };
      }
      return e;
    });

    persist(updatedExpenses);
    closeBottomSheet();
    showToast("Expense updated");
  };

  const total = useMemo(
    () => (expenses || []).reduce((s, e) => s + e.amount, 0),
    [expenses]
  );

  const byCategory = useMemo(() => {
    const m = {};
    (expenses || []).forEach((e) => (m[e.category] = (m[e.category] || 0) + e.amount));
    return Object.keys(m)
      .map((c) => ({ name: c, value: m[c] }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const catExpenses = useMemo(() => {
    if (!selectedCategory) return [];
    return (expenses || [])
      .filter((e) => e.category === selectedCategory)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [expenses, selectedCategory]);

  const catTotal = useMemo(() => {
    return catExpenses.reduce((s, e) => s + e.amount, 0);
  }, [catExpenses]);

  const byMonth = useMemo(() => {
    const m = {};
    (expenses || []).forEach((e) => {
      const ym = e.date.slice(0, 7);
      m[ym] = (m[ym] || 0) + e.amount;
    });
    return Object.keys(m).sort().map((ym) => ({ name: monthLabel(ym), value: m[ym] }));
  }, [expenses]);

  const allCats = useMemo(() => {
    const extra = [...new Set((expenses || []).map((e) => e.category))].filter(
      (c) => !BASE_CATS.includes(c)
    );
    return [...BASE_CATS, ...extra];
  }, [expenses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (expenses || [])
      .filter((e) => filterCat === "All" || e.category === filterCat)
      .filter(
        (e) =>
          !q ||
          e.paidTo.toLowerCase().includes(q) ||
          (e.notes || "").toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [expenses, search, filterCat]);

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);

  if (!expenses) {
    return (
      <div className="device-viewport">
        <style>{FONTS}</style>
        <div className="device-frame">
          <div className="device-screen" style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: "var(--color-text-grey)", letterSpacing: "0.08em" }}>
              LOADING SITE LEDGER…
            </div>
          </div>
        </div>
      </div>
    );
  }

  const empty = expenses.length === 0;

  return (
    <div className="device-viewport">
      <style>{FONTS}</style>

      <div className="device-badge">
        <span className="device-badge-dot" />
        <span>Mobile View · 412 × 824</span>
      </div>

      <div className="device-frame">
        <div className="device-screen" style={S.page}>

      <div style={selectedCategory ? { position: "sticky", top: 0, zIndex: 10 } : S.header}>
        <div style={S.hazard} aria-hidden="true" />
        {!selectedCategory && (
          <div className="headInner" style={S.headInner}>
            <div style={{ padding: "20px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={S.eyebrow}>M-SITE · CONSTRUCTION LEDGER</div>
                <div style={S.totalRow}>
                  <span style={S.totalAmount}>{inr(total)}</span>
                </div>
              </div>
              <button
                id="theme-toggle"
                onClick={() => setIsDarkMode(!isDarkMode)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "6px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  lineHeight: 1,
                  color: "var(--color-text)",
                  transition: "background 0.2s, transform 0.2s",
                  outline: "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-track)"; e.currentTarget.style.transform = "scale(1.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.transform = "scale(1)"; }}
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>
            </div>
            <div style={S.tabs}>
              {[
                ["dashboard", "Dashboard"],
                ["add", "Add expense"],
                ["expenses", "Expenses"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key);
                    if (selectedCategory) {
                      closeCategory();
                    }
                  }}
                  style={{ ...S.tab, ...(tab === key ? S.tabActive : {}) }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={S.content}>
        {error && (
          <div style={S.errorBox}>
            <span>{error}</span>
            <button style={S.errorClose} onClick={() => setError("")}>✕</button>
          </div>
        )}

        {selectedCategory ? (
          <div style={{ marginTop: 18 }}>
            <button
              onClick={closeCategory}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                color: "var(--color-text-grey)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 16,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-grey)"; }}
            >
              ← BACK TO DASHBOARD
            </button>

            <div style={{ ...S.card, marginBottom: 18, borderLeft: "4px solid " + YELLOW }}>
              <div style={S.eyebrow}>CATEGORY DETAILED REPORT</div>
              <div style={{ ...S.totalRow, marginTop: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 700 }}>{selectedCategory}</span>
                <span style={{ ...S.totalAmount, fontSize: 24, marginLeft: "auto" }}>{inr(catTotal)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-grey)", marginTop: 6, fontFamily: "'IBM Plex Mono', monospace" }}>
                {catExpenses.length} entries matching this category
              </div>
            </div>

            <div style={S.sectionLabel}>TRANSACTIONS IN "{selectedCategory.toUpperCase()}"</div>
            {catExpenses.length === 0 ? (
              <div style={{ ...S.card, color: "var(--color-text-grey)", fontSize: 14 }}>
                No expenses found under this category.
              </div>
            ) : (
              catExpenses.map((e) => (
                <div key={e.id} className="expense-row" style={S.row} onClick={() => startEditing(e)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.rowTitle}>{e.paidTo || e.notes}</div>
                    <div style={S.rowMeta}>{fmtDate(e.date)}</div>
                    {e.paidTo && e.notes && <div style={S.rowNotes}>{e.notes}</div>}
                  </div>
                  <div style={{ textAlign: "right", marginLeft: 12, flexShrink: 0 }}>
                    <div style={S.rowAmt}>{inr(e.amount)}</div>
                    {confirmId === e.id ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }} onClick={(ev) => ev.stopPropagation()}>
                        <button style={S.dangerBtn} onClick={(ev) => { ev.stopPropagation(); deleteExpense(e.id); }}>Delete</button>
                        <button style={S.ghostBtn} onClick={(ev) => { ev.stopPropagation(); setConfirmId(null); }}>✕</button>
                      </div>
                    ) : (
                      <button style={S.deleteLink} onClick={(ev) => { ev.stopPropagation(); setConfirmId(e.id); }}>Delete</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            {/* ---------- DASHBOARD ---------- */}
            {tab === "dashboard" && (
              <div>
                {empty ? (
                  <div style={{ ...S.card, textAlign: "center", padding: "36px 20px", marginTop: 18 }}>
                    <div style={{ fontSize: 34, marginBottom: 10 }}>🏗️</div>
                    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>No expenses yet</div>
                    <div style={{ color: "var(--color-text-grey)", fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
                      Add your first expense to get started.
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                      <button style={{ ...S.primaryBtn, width: "auto", marginTop: 0, padding: "12px 20px" }} onClick={() => setTab("add")}>
                        Add expense
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={S.sectionLabel}>SPEND BY CATEGORY (TAP TO VIEW DETAILS)</div>
                    <div style={{ ...S.card, padding: "10px 14px" }}>
                      {byCategory.map((c, i) => (
                        <div
                          key={c.name}
                          onClick={() => selectCategory(c.name)}
                          onMouseEnter={() => setHoveredCat(c.name)}
                          onMouseLeave={() => setHoveredCat(null)}
                          style={{
                            cursor: "pointer",
                            background: hoveredCat === c.name ? "var(--color-input-bg)" : "transparent",
                            border: "1px solid " + (hoveredCat === c.name ? "var(--color-border)" : "transparent"),
                            borderRadius: 6,
                            padding: "10px",
                            margin: i === byCategory.length - 1 ? "0 0 2px" : "0 0 10px",
                            transition: "all 0.15s ease-in-out",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ ...S.catName, textDecoration: hoveredCat === c.name ? "underline" : "none", color: hoveredCat === c.name ? "var(--color-text)" : "inherit" }}>
                              {c.name} →
                            </span>
                            <span style={S.catAmt}>{inr(c.value)}</span>
                          </div>
                          <div style={S.barTrack}>
                            <div
                              style={{
                                ...S.barFill,
                                width: (c.value / byCategory[0].value) * 100 + "%",
                                background: i === 0 ? YELLOW : "var(--color-text)",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={S.sectionLabel}>SPEND BY MONTH</div>
                    <div style={{ ...S.card, paddingBottom: 8 }}>
                      <ResponsiveContainer width="100%" height={210}>
                        <BarChart data={byMonth} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                          <XAxis
                            dataKey="name"
                            tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: isDarkMode ? "#A19C91" : "#8B8578" }}
                            axisLine={{ stroke: isDarkMode ? "#3E3B35" : "#D8D5CD" }}
                            tickLine={false}
                            interval={0}
                            angle={-40}
                            height={40}
                            textAnchor="end"
                          />
                          <YAxis hide />
                          <Tooltip
                            formatter={(v) => [inr(v), "Spent"]}
                            contentStyle={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: 12,
                              border: "1px solid var(--color-text)",
                              borderRadius: 0,
                              background: "var(--color-bg-card)",
                              color: "var(--color-text)",
                            }}
                          />
                          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                            {byMonth.map((_, i) => (
                              <Cell key={i} fill={isDarkMode ? "#F2EFE9" : "#1D1B16"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}

                <div style={S.sectionLabel}>GOOGLE DRIVE BACKUP</div>
                <div style={S.card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ ...S.statusDot, background: driveConnected ? "#1E8E3E" : "#B3261E" }} />
                    <span style={{ fontWeight: 700, fontSize: 15 }}>
                      {driveConnected ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: GREY, lineHeight: 1.5, marginTop: 6 }}>
                    {driveConnected
                      ? (lastBackup
                          ? "Your data was last backed up on " + fmtDateTime(lastBackup) + "."
                          : "Your data will be backed up on your next change.")
                      : "Connect once and every future change is backed up automatically."}
                  </div>
                  {driveMessage && (
                    <div style={{ fontSize: 12.5, color: "#B3261E", lineHeight: 1.5, marginTop: 6 }}>
                      {driveMessage}
                    </div>
                  )}
                  <div style={{ marginTop: 14 }}>
                    {driveConnected ? (
                      <button style={S.ghostBtn} onClick={handleDisconnectDrive}>Disconnect</button>
                    ) : (
                      <button
                        style={{ ...S.primaryBtn, width: "auto", marginTop: 0, padding: "9px 16px", fontSize: 13 }}
                        onClick={handleConnectDrive}
                        disabled={driveBusy}
                      >
                        {driveBusy ? "Connecting…" : "Connect Google Drive"}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* ---------- ADD ---------- */}
            {tab === "add" && (
              <div style={{ ...S.card, marginTop: 18 }}>
                <div className="formGrid">
                  <div>
                    <div style={S.formLabel}>Date</div>
                    <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} style={S.input} />
                  </div>
                  <div>
                    <div style={S.formLabel}>Amount (₹)</div>
                    <input
                      type="number" inputMode="decimal" value={fAmount}
                      onChange={(e) => setFAmount(e.target.value)} placeholder="0" style={S.input}
                    />
                  </div>
                </div>

                <div style={S.formLabel}>Category</div>
                <div style={S.chipWrap}>
                  {allCats.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setFCat(c); setNewCatMode(false); }}
                      style={{ ...S.chip, ...(!newCatMode && fCat === c ? S.chipActive : {}) }}
                    >
                      {c}
                    </button>
                  ))}
                  <button
                    onClick={() => setNewCatMode(true)}
                    style={{ ...S.chip, ...(newCatMode ? S.chipActive : {}), borderStyle: "dashed" }}
                  >
                    + New category
                  </button>
                </div>
                {newCatMode && (
                  <input
                    value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="New category name, e.g. Painting" style={{ ...S.input, marginTop: 8 }}
                  />
                )}

                <div style={S.formLabel}>Notes</div>
                <input
                  value={fNotes} onChange={(e) => setFNotes(e.target.value)}
                  placeholder="e.g. Paid to Mestri via PhonePe, 2nd payment" style={S.input}
                />

                <button style={S.primaryBtn} onClick={addExpense}>Save expense</button>
              </div>
            )}

            {/* ---------- EXPENSES ---------- */}
            {tab === "expenses" && (
              <div style={{ marginTop: 18 }}>
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, notes, or category"
                  style={{ ...S.input, marginBottom: 10 }}
                />
                <div style={{ ...S.chipWrap, marginBottom: 12 }}>
                  {["All", ...allCats].map((c) => (
                    <button
                      key={c} onClick={() => setFilterCat(c)}
                      style={{ ...S.chip, ...(filterCat === c ? S.chipActive : {}) }}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div style={S.listSummary}>{filtered.length} entries · {inr(filteredTotal)}</div>

                {filtered.length === 0 && (
                  <div style={{ ...S.card, color: "var(--color-text-grey)", fontSize: 14 }}>
                    {empty
                      ? "No expenses yet. Add one from the Add Expense tab."
                      : "No expenses match. Clear the search or pick another category."}
                  </div>
                )}

                {filtered.map((e) => (
                  <div key={e.id} className="expense-row" style={S.row} onClick={() => startEditing(e)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={S.rowTitle}>{e.paidTo || e.notes}</div>
                      <div style={S.rowMeta}>{fmtDate(e.date)} · {e.category}</div>
                      {e.paidTo && e.notes && <div style={S.rowNotes}>{e.notes}</div>}
                    </div>
                    <div style={{ textAlign: "right", marginLeft: 12, flexShrink: 0 }}>
                      <div style={S.rowAmt}>{inr(e.amount)}</div>
                      {confirmId === e.id ? (
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }} onClick={(ev) => ev.stopPropagation()}>
                          <button style={S.dangerBtn} onClick={(ev) => { ev.stopPropagation(); deleteExpense(e.id); }}>Delete</button>
                          <button style={S.ghostBtn} onClick={(ev) => { ev.stopPropagation(); setConfirmId(null); }}>✕</button>
                        </div>
                      ) : (
                        <button style={S.deleteLink} onClick={(ev) => { ev.stopPropagation(); setConfirmId(e.id); }}>Delete</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!selectedCategory && (
          <div style={S.footer}>
            <div>Total entries: {expenses.length}</div>
            {lastModified && <div style={{ marginTop: 4 }}>Last updated time: {fmtDateTime(lastModified)}</div>}
          </div>
        )}
      </div>

      {editingExpense && (
        <div style={S.modalOverlay} className={`bottom-sheet-overlay ${isClosing ? "closing" : ""}`} onClick={closeBottomSheet}>
          <div style={S.modalContent} className={`bottom-sheet-content ${isClosing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-handle" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Edit expense details</h3>
              <button
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text)" }}
                onClick={closeBottomSheet}
              >
                ✕
              </button>
            </div>
 
            {editError && (
              <div style={{ ...S.errorBox, margin: "0 0 16px 0" }}>
                <span>{editError}</span>
                <button style={S.errorClose} onClick={() => setEditError("")}>✕</button>
              </div>
            )}
 
            <div style={S.formLabel}>Name / Paid to</div>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Mestri, Hardware items"
              style={S.input}
            />
 
            <div className="formGrid" style={{ marginTop: 12 }}>
              <div>
                <div style={S.formLabel}>Date</div>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  style={S.input}
                />
              </div>
              <div>
                <div style={S.formLabel}>Amount (₹)</div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  placeholder="0"
                  style={S.input}
                />
              </div>
            </div>
 
            <div style={S.formLabel}>Category</div>
            <select
              value={editNewCatMode ? "__new__" : editCat}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setEditNewCatMode(true);
                } else {
                  setEditNewCatMode(false);
                  setEditCat(e.target.value);
                }
              }}
              style={S.input}
            >
              {allCats.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__new__">+ New category</option>
            </select>
 
            {editNewCatMode && (
              <input
                value={editNewCatName}
                onChange={(e) => setEditNewCatName(e.target.value)}
                placeholder="New category name, e.g. Painting"
                style={{ ...S.input, marginTop: 8 }}
              />
            )}
 
            <div style={S.formLabel}>Notes</div>
            <input
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="e.g. Paid via PhonePe"
              style={S.input}
            />
 
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button
                style={{ ...S.ghostBtn, flex: 1, padding: "12px" }}
                onClick={closeBottomSheet}
              >
                Cancel
              </button>
              <button
                style={{ ...S.primaryBtn, flex: 1, marginTop: 0, padding: "12px" }}
                onClick={saveEditedExpense}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={S.toast}>{toast}</div>}
        </div>
      </div>
    </div>
  );
}

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
* { box-sizing: border-box; }
input:focus, button:focus-visible { outline: 2px solid #F5B700; outline-offset: 1px; }
.formGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 480px) { .formGrid { grid-template-columns: 1fr; gap: 0; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

/* Mobile Device Frame Desktop Wrapper */
.device-viewport {
  min-height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #0c0d10;
  background-image: radial-gradient(circle at 50% 30%, #1e2028 0%, #0c0d10 75%);
  padding: 24px 16px;
  color: var(--color-text);
  transition: background 0.3s ease;
}

.device-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: #949086;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: rgba(255, 255, 255, 0.05);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.device-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #22C55E;
  box-shadow: 0 0 8px #22C55E;
}

.device-frame {
  position: relative;
  width: 412px;
  height: 824px;
  max-height: calc(100vh - 80px);
  background-color: var(--color-bg-page);
  border-radius: 20px;
  box-shadow: 
    0 20px 50px -10px rgba(0, 0, 0, 0.65), 
    0 0 0 1px var(--color-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.device-screen {
  flex: 1;
  height: 100%;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  scroll-behavior: smooth;
}

.device-screen::-webkit-scrollbar {
  width: 4px;
}
.device-screen::-webkit-scrollbar-track {
  background: transparent;
}
.device-screen::-webkit-scrollbar-thumb {
  background: var(--color-input-border);
  border-radius: 4px;
}

@media (max-width: 639px) {
  .device-viewport {
    padding: 0;
    background: none;
    min-height: 100vh;
  }
  .device-badge {
    display: none;
  }
  .device-frame {
    width: 100%;
    height: 100vh;
    max-height: none;
    border-radius: 0;
    box-shadow: none;
  }
}

:root {
  --color-bg-page: ${CONCRETE};
  --color-text: ${INK};
  --color-bg-card: #FFFFFF;
  --color-border: #D8D5CD;
  --color-text-grey: ${GREY};
  --color-track: #EFEDE8;
  --color-input-bg: #FBFAF7;
  --color-input-border: #C9C5BB;
  --color-notes: #5C574C;
  --color-tab-border: #EDEBE5;
}

:root.dark-theme {
  --color-bg-page: #121210;
  --color-text: #E5E2DA;
  --color-bg-card: #1F1D19;
  --color-border: #3A3731;
  --color-text-grey: #9A958A;
  --color-track: #2E2C26;
  --color-input-bg: #26241F;
  --color-input-border: #47433B;
  --color-notes: #BBB6AA;
  --color-tab-border: #2B2924;
}

.expense-row {
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.expense-row:hover {
  background-color: var(--color-track) !important;
  border-color: var(--color-input-border) !important;
  transform: translateY(-1px);
}
.expense-row:active {
  transform: translateY(0);
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes slideDown {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes fadeOut {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

.bottom-sheet-overlay {
  animation: fadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.bottom-sheet-overlay.closing {
  animation: fadeOut 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.bottom-sheet-content {
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.bottom-sheet-content.closing {
  animation: slideDown 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.bottom-sheet-handle {
  width: 36px;
  height: 4px;
  background-color: var(--color-input-border);
  border-radius: 2px;
  margin: -6px auto 14px;
  opacity: 0.6;
}
`;

const S = {
  page: { minHeight: "100%", background: "var(--color-bg-page)", color: "var(--color-text)", fontFamily: "'Space Grotesk', system-ui, sans-serif" },
  header: { background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", position: "sticky", top: 0, zIndex: 10 },
  headInner: { maxWidth: "100%", margin: "0 auto" },
  content: { padding: "0 16px 80px", maxWidth: "100%", margin: "0 auto" },
  hazard: { height: 8, background: `repeating-linear-gradient(45deg, ${YELLOW} 0 12px, var(--color-text) 12px 24px)` },
  eyebrow: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.14em", color: "var(--color-text-grey)", marginBottom: 6 },
  totalRow: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  totalAmount: { fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 30, letterSpacing: "-0.01em" },
  totalMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--color-text-grey)" },
  footer: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--color-text-grey)", textAlign: "center", marginTop: 40, marginBottom: 20 },
  tabs: { display: "flex", borderTop: "1px solid var(--color-tab-border)" },
  tab: {
    flex: 1, padding: "12px 4px", background: "none", border: "none",
    borderBottom: "3px solid transparent", fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 500, fontSize: 14, color: "var(--color-text-grey)", cursor: "pointer",
  },
  tabActive: { color: "var(--color-text)", borderBottom: "3px solid " + YELLOW, fontWeight: 700 },
  sectionLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.14em", color: "var(--color-text-grey)", margin: "18px 2px 8px" },
  card: { background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 6, padding: 16 },
  statusDot: { width: 9, height: 9, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  catName: { fontSize: 13.5, fontWeight: 500 },
  catAmt: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600 },
  barTrack: { height: 6, background: "var(--color-track)", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, transition: "width 0.4s ease" },
  formLabel: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.12em",
    color: "var(--color-text-grey)", textTransform: "uppercase", margin: "14px 0 6px",
  },
  input: {
    width: "100%", padding: "11px 12px", fontSize: 15,
    fontFamily: "'Space Grotesk', sans-serif", border: "1px solid var(--color-input-border)",
    borderRadius: 5, background: "var(--color-input-bg)", color: "var(--color-text)",
  },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 7 },
  chip: {
    padding: "7px 11px", fontSize: 12.5, fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 500, border: "1px solid var(--color-input-border)", borderRadius: 999,
    background: "var(--color-input-bg)", color: "var(--color-text)", cursor: "pointer",
  },
  chipActive: { background: "var(--color-text)", color: YELLOW, border: "1px solid var(--color-text)", fontWeight: 700 },
  primaryBtn: {
    width: "100%", marginTop: 20, padding: "13px", fontSize: 15, fontWeight: 700,
    fontFamily: "'Space Grotesk', sans-serif", background: YELLOW, color: INK,
    border: "1px solid var(--color-text)", borderRadius: 6, cursor: "pointer",
  },
  ghostBtn: {
    padding: "9px 14px", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif",
    background: "none", border: "1px solid var(--color-input-border)", borderRadius: 5, color: "var(--color-text)", cursor: "pointer",
  },
  dangerBtn: {
    padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
    background: "#B3261E", color: "#FFF", border: "none", borderRadius: 5, cursor: "pointer",
  },
  deleteLink: {
    marginTop: 4, padding: 0, background: "none", border: "none", fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace", color: "var(--color-text-grey)", cursor: "pointer", textDecoration: "underline",
  },
  listSummary: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--color-text-grey)", margin: "0 2px 10px" },
  row: {
    display: "flex", alignItems: "flex-start", background: "var(--color-bg-card)",
    border: "1px solid var(--color-border)", borderRadius: 6, padding: "12px 14px", marginBottom: 8,
  },
  rowTitle: { fontSize: 14.5, fontWeight: 500, lineHeight: 1.35 },
  rowMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--color-text-grey)", marginTop: 3 },
  rowNotes: { fontSize: 12.5, color: "var(--color-notes)", marginTop: 4, lineHeight: 1.4 },
  errorBox: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
    background: "#FBEAE9", border: "1px solid #B3261E", color: "#7A1712",
    borderRadius: 6, padding: "10px 12px", fontSize: 13.5, margin: "14px 0 0",
  },
  errorClose: { background: "none", border: "none", color: "#7A1712", cursor: "pointer", fontSize: 14, flexShrink: 0 },
  toast: {
    position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
    background: "var(--color-text)", color: YELLOW, fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13, padding: "10px 18px", borderRadius: 6, zIndex: 1100,
    boxShadow: "0 4px 14px rgba(0,0,0,0.25)", maxWidth: "90%", textAlign: "center", width: "max-content",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 1000,
  },
  modalContent: {
    background: "var(--color-bg-card)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTop: "1px solid var(--color-border)",
    borderLeft: "1px solid var(--color-border)",
    borderRight: "1px solid var(--color-border)",
    width: "100%",
    maxWidth: "100%",
    padding: "16px 20px 32px",
    boxShadow: "0 -8px 30px rgba(0, 0, 0, 0.25)",
    maxHeight: "85vh",
    overflowY: "auto",
  },
};


export default MSiteTracker;

if (typeof document !== "undefined") {
  const container = document.getElementById("root");
  if (container && !container.hasChildNodes() && !document.querySelector('script[src*="main.tsx"]')) {
    const root = createRoot(container);
    root.render(<MSiteTracker />);
  }
}
