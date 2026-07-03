### Bugs

*BUG-001: Account Launch Failures*

* *Description:* Account launches are failing.
* *Severity:* Critical

*BUG-002: Duplicate Proxies Button in Account Manager Pro*

* *Description:* The *Proxies* button is still showing in Account Manager Pro when it shouldn't.
* *Severity:* Medium

*BUG-003: Duplicate Scheduler Button in Account Manager Pro*

* *Description:* The *Scheduler* button is appearing in the Account Manager Pro header and looks to be a duplicate.
* *Severity:* Low–Medium

*BUG-004: Team Live Status Incorrect*

* *Description:* Team members are showing as *Offline* even when they're actively online.
* *Severity:* High

*BUG-005: Team Live Metrics Not Updating*

* *Description:* Team Live metrics remain at 0 for Posts, Comments, Karma, and Time on Task instead of updating in real time.
* *Severity:* High

*BUG-006: New Tab Homepage Tiles Not Working*

* *Description:* The configurable quick-launch tiles on the Oserus Browser new tab page aren't functioning.
* *Severity:* Medium

*BUG-007: Jailbroken Phone Detection Failing*

* *Description:* Connected Phones isn't detecting jailbroken iOS or rooted Android devices through ADB/libimobiledevice.
* *Severity:* Medium–High

*BUG-008: upvote.biz API & Proxy Routing Issues*

* *Description:* Verify that the upvote.biz integration and proxy routing are fully functional.
* *Details:*

  1. *upvote.biz Integration:* The standard JSON API should work correctly. When a scheduled post goes live, its configured boost should be applied automatically, with Fast, Medium, and Slow drip rates available per post.
  2. *Proxy Routing:* Proxy pool assignments should actually route browser traffic. Every Oserus Browser launch should use the account's assigned HTTP, HTTPS, or SOCKS5 proxy. Automatic health checks every 30 minutes should update the *PROXY ISSUE* indicator.
* *Expected:*

  * Saving an API key validates it and shows a *Configured* status.
  * Scheduled posts trigger the correct upvote.biz request through the assigned proxy.
  * The Rotate button changes the residential IP based on its TTL.
  * Failed proxies are reported on the Dashboard.
* *Severity:* High

### UI/UX Improvements

*FR-001: Improve Model Profile Flow*

* *Request:* Make the model profile experience feel smoother and more intuitive to navigate.
* *Priority:* Medium–High

*FR-003: Improve AI Configuration UX*

* *Request:* Simplify the setup flow for Anthropic, OpenAI, and Grok providers to make configuration quicker and easier.
* *Priority:* Medium

### Feature Requirements

*FR-002: Oserus Browser Integration*

* *Request:* Ensure the custom browser includes all planned operator-grade features.
* *Core Features:* Per-account isolation, anti-detect fingerprinting, rotating residential proxies, Chrome extension support, content sidebar, profile picker, Find/Zoom/DevTools, login autofill, USB phone detection, and quick launch.

*FR-002a: USB Phone Detection – Jailbreak Support*

* *Request:* Ensure Connected Phones properly detects both jailbroken iOS devices and rooted Android devices.

*FR-004: Infrastructure – Boosts & Proxy Pool*

* *Request:* Confirm that shared boost and proxy pools are fully functional and available across all models.
* *Details:*

  1. *upvote.biz:* API key storage, validation on save, configurable drip rate per post, and proper error handling if a boost fails.
  2. *Proxy Pool:* Add, edit, delete, assign, rotate, and health-check proxies. Oserus Browser should always respect the assigned proxy for each account.
  3. *Coming Soon:* Scaffold support for TikTok views, Instagram likes, X engagement, and additional Reddit providers.
* *Priority:* High


also remember to do  any leftover bugs you know exist. not doing things correctlly and /or testing for them by yourself means  more drawn out pay.
