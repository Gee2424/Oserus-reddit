import React from 'react';

export default function InboxPage() {
  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Messages</div>
          <h1>Inbox</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Read and reply to Reddit DMs and modmail for any connected account.
          </div>
        </div>
      </div>

      <div className="card bordered-glow" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 6 }}>Inbox needs Reddit API access</h3>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          The inbox feature uses Reddit's official API to read and send messages safely (no
          browser scraping, no ban risk). Each Reddit account needs to be connected once via a
          single-click <strong>Connect to Reddit</strong> button on the account card — Reddit
          shows its standard "Allow Oserus Management" consent screen, you click Allow, and the
          token is saved encrypted for that account.
          <br /><br />
          The connect button + the inbox feed will arrive in the next release. Until then this
          page is a placeholder.
        </div>
      </div>

      <div className="empty-state" style={{ padding: 50 }}>
        No connected accounts yet. Once OAuth lands, you'll see one inbox per Reddit account here.
      </div>
    </div>
  );
}
