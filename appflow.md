Priority order, no cosmetic work — new UI comes later:
Intelligence — get Instagram + X search working like Reddit already does
Automation — engagement actions (comments/likes/upvotes), AI-assisted
Antidetect Browser — session handling, fingerprinting, proxy stability
Work in that order or in parallel if faster. New fields/buttons go in plain using existing components, no new styling. Give an honest read on whether Instagram/X search is a quick fix or a bigger job, since those platforms fight scraping.

Full structure:

Dashboard — Row 1: Earnings card, Total Earnings + breakdown tiles (Subscriptions, Tips, Posts, Messages, Referrals, Streams), Net/Gross toggle, time range tabs (Yesterday/Today/This Week/This Month). Row 2: Employees Online (left) + Scheduler shortcut (right), both click to Team page. Row 3: Live activity feed. No Reddit-specific terms anywhere.

Models — one section, two views, not two separate pages. List view: rows only — avatar, name, tag, status dot, Start button. Start goes to Browser. Click row switches to the detail view. Detail view: header (avatar upload, name, tag, status, account counts, Start), account settings (Primary Manager, Team, Main Email, Model Proxy), 6 equal linked account sections (Reddit, RedGifs, X, Instagram, TikTok, OnlyFans), Proxies section. No Brand Voice, no Activity tab.

Link/Edit Account modal — Essentials always visible (username, password, status, proxy), Advanced collapsed (email/password, device fingerprint, browser mode, notes). One modal for Add and Edit. Needs field variants per platform.

Browser — one isolated instance per model, one tab per linked account inside it. Tabs are small, one per account, icon + name only, top of the window — clicking a tab switches the whole window to that account and updates the side panel to match. Side panel scoped to active tab: Intelligence, Automation, Inbox, Scheduler, Scripts.

Automation — engagement only (comments/likes/upvotes), not messaging. AI dropdown: Cupid AI or Claude. Also has "runs" — saved presets for how much engagement to use, built and named on the full page. Mini version in Browser only picks from saved runs, doesn't create new ones. Standalone page + Browser side panel.

Inbox (renamed from Account Manager Pro) — messaging only. Layered nav: pick model, then platform tab, then inbox. Standalone + Browser side panel.

Intelligence — keyword search across Reddit/X/Instagram, returns top content links with engagement stats + copy action. Standalone + Browser side panel.

Scheduler — posts only, separate from Team's shift scheduler. Standalone: calendar, all models, filterable. Browser side panel: same, scoped to active model.

Scripts (new) — "Sets" are named content bundles per model (e.g. "Bikini Undressing Set"), made of ordered "Steps" — each Step is one photo/video plus its message text. Chatters open a Set from Inbox and send Steps in order during a chat, keeping content consistent across chatters. Sets belong to one model, same as linked accounts — chatters only see Sets for models they're assigned to. Needs: upload media per step, reorder steps, name/edit a Set, assign employee access (likely from Team page). Standalone page (build/manage Sets) + Browser side panel (simple click-through viewer). Flagged, unresolved: Manager currently has no model-facing access, but this feature was described with Managers building and assigning Set content — needs your confirmation before permissions get built.

Team — filterable table (Employee/Model/Status filters, batch actions, add employee). Columns: employee, assigned models (click to set), role, status, actions. Team Scheduler: shift schedule/shift history tabs, filters, week view, create shift modal (multi-shift, date/time/timezone, creators multi-select, employees multi-select, repeat options). Chatters/VAs see only their own shift. Admin settings tab (Owner/Admin only, same page — this replaces the old standalone Configuration page): Roles & Permissions, global Proxies, CloakManager settings, AI provider connections, general workspace settings.

Roles & Permissions — base roles Owner/Admin/Manager/Chatter/VA, must support custom roles built from these with individual permission toggles.

Permission table:
Dashboard: Owner/Admin/Manager yes, Chatter/VA no
Team full view + scheduling employees + invite + remove: Owner/Admin/Manager yes, Chatter/VA own schedule only
Inbox: Owner/Admin yes, Chatter assigned models only, Manager/VA no
Browser/Automation/Scheduler/Intelligence: Owner/Admin/VA yes, Manager/Chatter no
Scripts: Owner/Admin yes, Chatter view/use assigned only, Manager/VA pending confirmation (see flag above)
Admin settings (Roles, Proxies, CloakManager, AI Connections, General): Owner/Admin only
Chatter/VA/custom roles only see models they're explicitly assigned to, assigned from the Team table.

Sidebar — Analytics becomes a dropdown (Model reports, Employee reports, Fan/Subscriber reports, Message dashboard). Account Manager Pro renamed to Inbox. Documentation removed. Configuration removed as standalone — folded into Team. Scripts added as a new item.
