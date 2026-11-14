import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const systemStats = [
  { label: "Phase", value: "0", status: "ready" },
  { label: "Engine", value: "11/11", status: "healthy" },
  { label: "Rooms", value: "4", status: "guarded" },
  { label: "Audit", value: "256", status: "current" },
];

const timeline = [
  { time: "08:00", event: "Baseline checkpoint created", tag: "ready" },
  { time: "08:17", event: "Time Engine replay validated", tag: "verified" },
  { time: "08:42", event: "Secret-room consent gate reviewed", tag: "guarded" },
  { time: "09:10", event: "Workspace build reconciliation started", tag: "active" },
];

const principles = [
  { title: "Private by default", detail: "No access without explicit authorization and verified provenance." },
  { title: "Reversible operations", detail: "State changes preserve originals and support safe recovery." },
  { title: "Evidence first", detail: "Build and safety checks must pass before product integration proceeds." },
];

const controls = [
  { name: "Freeze replay", state: "Enabled", tone: "standby" },
  { name: "Gate room consent", state: "Fail-closed", tone: "guarded" },
  { name: "Run engine audit", state: "Queued", tone: "active" },
  { name: "Sync branch state", state: "Ready", tone: "verified" },
];

function App() {
  const [selected, setSelected] = useState("Time Engine");

  const activeCard = useMemo(() => {
    const map = {
      "Time Engine": { label: "Deterministic replay", value: "Stable", summary: "Tick cadence and snapshots are being hardened for exact replay safety." },
      "Secret Rooms": { label: "Consent boundary", value: "Fail-closed", summary: "Access grants require verified ownership, target checks, and revocation support." },
      "Workspace": { label: "Build health", value: "Reconciled", summary: "App foundation is being aligned with a local dependency strategy and a clean build path." },
    };

    return map[selected] ?? map["Time Engine"];
  }, [selected]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">LL</div>
          <div>
            <p className="eyebrow">Portfolio / control</p>
            <h1>Lost Legacies Live</h1>
          </div>
        </div>

        <nav className="nav" aria-label="Primary navigation">
          {Object.keys({
            "Time Engine": true,
            "Secret Rooms": true,
            Workspace: true,
            "Safety Gate": true,
          }).map((item) => (
            <button
              key={item}
              type="button"
              className={selected === item ? "nav-item active" : "nav-item"}
              onClick={() => setSelected(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="mini-panel">
          <span className="panel-label">Current mode</span>
          <strong>Integration rehearsal</strong>
          <p>Guarded updates only. No production deployment or broad external expansion.</p>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Mission status</p>
            <h2>Operational overview</h2>
          </div>
          <button type="button" className="primary-btn">Run review</button>
        </header>

        <div className="stats-grid">
          {systemStats.map((stat) => (
            <article key={stat.label} className="card stat-card">
              <span className="stat-label">{stat.label}</span>
              <strong>{stat.value}</strong>
              <span className={`status-pill ${stat.status}`}>{stat.status}</span>
            </article>
          ))}
        </div>

        <div className="content-grid">
          <article className="card spotlight">
            <div className="card-head">
              <span className="panel-label">Focus</span>
              <span className="tag tag-badge">{activeCard.label}</span>
            </div>
            <h3>{activeCard.value}</h3>
            <p>{activeCard.summary}</p>
          </article>

          <article className="card">
            <div className="card-head">
              <span className="panel-label">Control actions</span>
            </div>
            <div className="stack">
              {controls.map((control) => (
                <div key={control.name} className="control-row">
                  <span>{control.name}</span>
                  <span className={`tag ${control.tone}`}>{control.state}</span>
                </div>
              ))}
            </div>
          </article>
        </div>

        <div className="bottom-grid">
          <article className="card">
            <div className="card-head">
              <span className="panel-label">Safety principles</span>
            </div>
            <ul className="principles-list">
              {principles.map((principle) => (
                <li key={principle.title}>
                  <strong>{principle.title}</strong>
                  <span>{principle.detail}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <div className="card-head">
              <span className="panel-label">Timeline</span>
            </div>
            <ul className="timeline-list">
              {timeline.map((item) => (
                <li key={`${item.time}-${item.event}`}>
                  <span className="time-stamp">{item.time}</span>
                  <div>
                    <strong>{item.event}</strong>
                    <span className={`tag ${item.tag}`}>{item.tag}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
