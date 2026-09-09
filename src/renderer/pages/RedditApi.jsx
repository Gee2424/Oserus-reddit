import React, { useState } from "react";
import InboxPage from "./Inbox.jsx";
import { PLATFORMS as PLATFORM_PILLS } from "../lib/platforms.js";
import PageHeader from "../components/PageHeader.jsx";
// Account Manager Pro — Inbox-first workspace. Scheduling lives in the
// sidebar Scheduler entry now (one scheduler, not two), so the old Posting
// tab is gone. Platform pills filter the inbox view.
export default function RedditApiPage({ navigate }) {
  const [platform, setPlatform] = useState("reddit");
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Account Manager Pro" subtitle="DMs and modmail across every platform. Sessions stay per-account. Scheduling lives in the Scheduler." />
      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}
      >
        {PLATFORM_PILLS.map((p) => {
          const active = platform === p.v;
          return (
            <button
              key={p.v}
              onClick={() => setPlatform(p.v)}
              title={p.label}
              style={{
                background: active ? p.color : "var(--bg-1)",
                color: active ? "#fff" : "var(--text-1)",
                borderWidth: 1, borderStyle: 'solid',
                borderColor: active ? p.color : "var(--border)",
                borderRadius: 'var(--radius-pill)',
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: p.color,
                }}
              />
              {p.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
      </div>
      <InboxPage embedded navigate={navigate} />
    </div>
  );
}
