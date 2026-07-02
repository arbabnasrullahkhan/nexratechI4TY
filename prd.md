# MASTER PRD — NEXRA TECH PK ECOSYSTEM (v2, Consolidated)

**Status:** Final consolidated spec — replaces all three prior draft PRDs
**Key architecture changes in this version:**
- ❌ Supabase / PostgreSQL **removed entirely** — 100% Firebase (Firestore + Auth)
- ❌ Shared `global.css` and `global-engine.js` **removed**
- ✅ Every page is **self-contained**: its own HTML + its own `<style>` block + its own `<script>` block, in one file (or one file + a co-located `.css`/`.js` pair, never shared across pages)
- ✅ Hosting: **GitHub** (source/version control) → **Vercel** (frontend deploy)
- ✅ Admin Panel: separate deployment (subdomain or InfinityFree), still 100% Firebase

---

## 1. Executive Summary & Tech Stack

| Layer | Technology |
|---|---|
| Architecture | Client-side SPA, Vanilla JS, dynamic fetch-based routing |
| Database (only one now) | Firebase Firestore (NoSQL, real-time) |
| Auth | Firebase Authentication |
| Hosting (frontend) | Vercel — auto-deploy from GitHub `main` branch |
| Source control | GitHub (public or private repo) |
| Admin Panel hosting | Separate subdomain / InfinityFree, isolated from main site |
| Media | Zero-cost hybrid: Base64 (micro) + free image API (macro) — no Firebase Storage, no S3, no Cloudinary |
| AI | OpenRouter (multi-model fallback chain) |

Supabase, PostgreSQL, and any relational layer are **fully removed**. All data that was previously planned for `orders`, `order_items`, `products`, `blogs`, `freebies`, and `reseller_profits` SQL tables now lives in Firestore collections/sub-collections (see Section 6).

---

## 2. Global Branding & Centralized Assets

Branding is still **data-driven**, not hardcoded — but it is now fetched from a single Firestore document (`settings/branding`) instead of any shared JS file, since `firebaseconfig.js`-as-shared-import still applies only to the Firebase SDK init (this is configuration, not app logic, so it's exempt from the "no shared files" rule — see Section 5 note).

**Alpha Edition (Purple/Premium):**
- Logo / Favicon: `logo_purple.png`
- Text Title: `text_title_p.png`
- Watermark: `watermark_purple.png`
- Theme Color: `#a855f7`

**Beta Edition (Orange/Energetic) — DEFAULT:**
- Logo / Favicon: `logo_orange.png`
- Text Title: `text_title_o.png`
- Watermark: `watermark_orange.png`
- Theme Color: `#FF4A17`

Theme switching still works by toggling `data-theme` on `<html>` and re-reading `settings/branding` — each page's own inline `<script>` block subscribes to this document independently.

---

## 3. The Zero-Cost Automated Media Architecture (Firebase-Only)

No Firebase Storage, no Supabase Storage, no Cloudinary/S3, no manual GitHub uploads.

- **Micro Assets** (icons, avatars, badges, <40KB): compressed client-side via Canvas → WebP → Base64 → stored directly inside the Firestore document. Instant render, zero DNS lookup.
- **Macro Assets** (banners, product photos): compressed client-side, then pushed via background REST call to a free unlimited image host (ImgBB API or Telegraph API). The returned direct URL is the only thing saved to Firestore.
- **Result:** Firestore stores only text/URLs, the project stays on the free Spark plan indefinitely, and the Admin still gets a native drag-and-drop upload experience.

---

## 4. Role-Based Access Control (RBAC)

| Role | Capability |
|---|---|
| Super Admin (UID-locked) | Full override, DB wipe, admin creation, route changes |
| Admin | Manage products, users, tickets, content — no root API key access |
| Moderator | Approve/reject comments, reviews, reseller submissions |
| Reseller (Agency) | B2B dashboard, wholesale pricing, branded storefront link |
| VIP Member (Diamond/Gold/Silver) | Auto-discounts, private broadcast feed, `ads_enabled:false` |
| Verified User | Standard auth user with vault + wallet |
| Guest | Browse/search/freebies only; must auth to checkout |

---

## 5. File & Folder Architecture (Self-Contained Page Model)

**This is the core structural change.** There is no `/components/` directory of reusable fetched HTML fragments, no `global.css`, no `global-engine.js`. Instead:

> **Rule:** Every route is one self-contained unit. A page's markup, its styling, and its page-specific logic live together (either as one `.html` file with inline `<style>`/`<script>`, or as a tight trio `page.html` + `page.css` + `page.js` sitting in the same folder and referenced only by that page). No file is imported by more than one page.

This trades strict DRY-ness for **zero shared-state bugs, no fetch-and-inject race conditions, and no "I edited the global file and broke five other pages" risk** — each page can be edited, tested, and deployed in total isolation.

**The one exception:** `firebaseconfig.js` remains a single shared file, because it is not app/UI logic — it is the Firebase SDK initialization (apiKey, projectId, etc.) and must be identical everywhere by definition. Anything beyond SDK init (toasts, modals, formatting helpers, theme logic) is duplicated locally inside each page's own script block.

```
📂 ROOT
  index.html                 (Master SPA shell + own inline CSS/JS, deep-link engine, splash screen)
  firebaseconfig.js          (ONLY shared file: Firebase SDK init — not UI logic)

📂 /discovery/
  home.html                  (own CSS + own JS inline: hero, stats, trending, freebies, testimonials)
  search-results.html        (own CSS + own JS: grid, filters, voice search)
  coming-soon.html           (own CSS + own JS: countdown logic)

📂 /shop/
  shop.html                  (own CSS + JS: marketplace, filters, swimlanes)
  product-detail.html        (own CSS + JS: gallery, AI chatbot trigger, dynamic watermark canvas)
  checkout.html              (own CSS + JS: 3-step flow, Base64 proof upload, promo codes)
  checkout-success.html      (own CSS + JS: confirmation, pixel fires, vault redirect)
  bundle-builder.html        (own CSS + JS: drag-and-drop bundling)

📂 /freebies/
  free-vault.html
  freebie-detail.html
  giveaway-live.html

📂 /academy/
  blog.html
  blog-detail.html

📂 /user/
  auth-gate.html
  profile-dashboard.html
  user-vault.html
  user-wallet.html
  wishlist.html

📂 /reseller/
  landing.html
  reseller-auth.html
  reseller-dashboard.html
  store-builder.html
  submissions.html

📂 /vip/
  vip-tiers.html
  vip-dashboard.html

📂 /support/
  support-hub.html
  support-chat.html

📂 /system/
  about.html
  policies.html
  error-404.html

📂 /admin/   (deployed separately — see Section 12)
  index.html
  dashboard.html
  route-manager.html
  product-manager.html
  user-manager.html
  order-manager.html
  media-manager.html
  theme-manager.html
  festival-manager.html
  announcement-manager.html
  ad-manager.html
  database-viewer.html
```

**Header / footer / nav / cart-drawer:** previously planned as fetched `/components/*.html` fragments — now each top-level page includes its own copy of this markup inline, styled with its own scoped CSS class prefixes (e.g. `.home-header`, `.shop-header`) to avoid collisions. A lightweight build-time copy step (a simple Node/bash script run before each `git push`, not a shared runtime file) can keep these in sync across pages without creating a runtime dependency.

---

## 6. Firestore-Only Data Architecture (No SQL)

Since there is no relational layer anymore, data is stored as **denormalized documents and sub-collections** to minimize reads (and therefore cost).

**Root Collections:**
- `products/` — title, price, old_price, type (saas/digital/physical), category, image_url, description, rating, sold_count, trending(bool), keywords[] (for search), created_at
- `users/` — name, email, role, tier, created_at
- `orders/` — total_amount, status, payment_method, proof_url, shipping_address, created_at, **plus duplicated `user_name`/`user_email`** (intentional denormalization so order reads never need a second lookup into `users/`)
- `settings/` — single docs: `global`, `branding`, `routes`, `ads`, `announcements`, `ai_config`
- `stats/` — `live` doc: real-time visitor/sales counters via `FieldValue.increment(1)`
- `notifications/` — global real-time alerts
- `vip_broadcasts/` — VIP-only feed messages
- `chat_tickets/` — real-time support chat
- `blogs/`, `freebies/` — content collections (replacing the old Supabase tables)
- `reseller_profits/` — commission/margin tracking (replacing the old SQL table)

**Sub-Collections:**
- `users/{uid}/vault` — purchased license keys, readable only by that uid
- `users/{uid}/unlocked`, `/cart`, `/wishlist`
- `products/{pid}/reviews`
- `orders/{oid}/items` — replaces the old `order_items` SQL table; each item: product_id, price_at_purchase, assigned_license_key

**Search without SQL `LIKE`:** product titles are tokenized into a `keywords[]` array at save time (e.g. `capcut pro` → `['cap','capcut','pro','capcut pro']`) and queried with `array-contains`.

**Composite Indexes:** configured in the Firebase console for combined filters (price + category + date, etc.).

---

## 7. Global Route Management

Routing stays centralized through a single in-memory registry loaded from `settings/routes` at boot (this lookup table is data, not shared UI logic — it's fine to be one Firestore-driven object):

```
onclick="Nexra.navTo('shop')"
```

Flow: intercept click → look up `'shop'` in the route registry → resolve to `/shop/shop.html` → show top progress loader → `fetch()` the page → inject into `<main id="spa-main">` → execute the page's own inline `<script>` → update URL to `?view=shop` for deep-linking/SEO.

Because each fetched page carries its own `<style>`/`<script>`, there's no need to separately inject component CSS/JS — it travels with the page.

---

## 8. Third-Party APIs & External Integrations

**Triple-AI Engine (OpenRouter, configured via `settings/ai_config` in Firestore — editable live from Admin, no code redeploy needed):**
- Primary: `google/gemini-flash-latest`
- Fallback 1: `cohere/north-mini-code:free`
- Fallback 2: `google/gemma-4-31b-it:free`
- On 401/429, the catch block rotates key/model automatically and retries silently.

**Payments:**
- JazzCash / EasyPaisa: manual Base64 proof upload now; hooks left open for future sandbox REST integration.
- Binance Pay (Crypto): dynamic QR via `api.qrserver.com` pointed at a TRC-20 wallet address.

**Email/SMS (future-proofing):** Firestore write triggers are designed to later connect to SendGrid/Resend and Twilio/InfoBip via Firebase Cloud Functions for automated invoice delivery.

---

## 9. Deep-Link & Query Parameter Dictionary

| Param | Purpose |
|---|---|
| `?view=[page]` | Master routing parameter |
| `?id=[docId]` | Fetch a specific Firestore document |
| `?ref=[username]` | Affiliate tracking → saved to sessionStorage → Nexra Coins on purchase |
| `?utm_source=[platform]` | Ad-campaign attribution |
| `?promo=[code]` | Auto-applies influencer discount at checkout |
| `?theme=[dark/light]` | Forces a theme for promotional/share links |

---

## 10. Monetization, Ads & Virtual Economy

**Nexra Coins:** 1 Coin = 1 PKR (configurable). Earned via sharing, purchases, daily login. Usable as a checkout discount.

**Adsterra slots:**
- Slot 1 — Header banner (Home, Shop)
- Slot 2 — Native popunder, once per session, triggered on "Download Freebie"
- Slot 3 — Social bar, floating on blog articles

VIP users get `ads_enabled:false` from their Firestore role flag, hiding all slots.

---

## 11. PWA & Offline Capability

- `manifest.json` dynamically reflects the active brand edition (Alpha/Beta icon).
- `sw.js` caches fonts/CSS/JS on first visit; serves a custom offline screen (not the browser dino game) when there's no connection.
- IndexedDB caches the product list locally for browsing on 2G/offline.

---

## 12. Security, Anti-Scraping & Deployment

**Firestore Rules (the only security layer now — no separate SQL RLS to maintain):**
- Admin bypass: `request.auth.uid == 'YOUR_ADMIN_UID'`
- User isolation: a user can read/write only `users/{uid}` where `uid == request.auth.uid`
- Public read-only on `products`/`categories`; writes restricted to Admin role

**Other security:**
- CSP headers whitelisting only Adsterra, Firebase, and OpenRouter (Supabase entry removed)
- Right-click/inspect-element guard on product images
- Watermarking via invisible `<canvas>` — only the watermarked Base64 output is ever in the DOM
- Firebase project rules locked to `nexratech.pk` + `localhost`

**Deployment pipeline:**
- **GitHub** — single source of truth repo; `main` branch triggers deploys.
- **Vercel** — connected to GitHub; every push to `main` auto-builds and deploys the public frontend globally (~30s).
- **Admin Panel** — deployed as a **separate** project/subdomain (e.g. its own Vercel project or InfinityFree), entirely isolated from the public site so regular users can't discover or load the admin login.
- **Environment variables** (OpenRouter keys, any sensitive config) live in Vercel project settings — never hardcoded in HTML/JS shipped to the browser where avoidable; Firebase web config (which is inherently public-facing) is the one exception, protected instead by Firestore Rules + domain restriction.

---

## 13. SEO & Tracking

- Dynamic `sitemap.xml` generated via a Vercel serverless function reading the live Firestore `products` collection.
- Meta Pixel + TikTok Pixel: "Purchase" event fires on `checkout-success.html`, "Add to Cart" fires from the cart drawer logic (now inline in whichever page owns the cart UI).
- Canonical URL injection in `<head>` to prevent duplicate-content penalties between `?view=product&id=1` and `?view=shop&id=1`.

---

## 14. Coding Standards (Updated for Self-Contained Pages)

1. **No shared UI/logic files.** Each page owns its CSS and JS inline or in a co-located, single-use pair. The only shared file in the entire project is `firebaseconfig.js` (SDK init only).
2. **Protection:** every page's script block wraps Firestore calls in try/catch; on failure, render a local EmptyState block (defined inline in that page, not imported).
3. **CSS:** each page defines its own CSS custom properties (`--brand-main`, `--bg-surface`) scoped to that page's root container; dark mode still toggles via `data-theme="dark"` on `<html>`, read independently by each page's own script.
4. **Performance:** `loading="lazy"` on all images; `nx-loaded` class transition from skeleton to crisp image, implemented per-page.
5. **Sync discipline:** since header/footer/nav markup is duplicated across pages by design, any visual change to the global header is applied via a small repo-local script (run once before commit) that copies the canonical header block into every page file — this is a development-time tool, not a runtime dependency, so it's forgetful.

---

### Brand Assets

**Alpha Edition (Purple/Premium Focus):**
- Logo: https://uploads.onecompiler.io/42yatf6fu/1782533644984/logo_purple.png
- Favicon: https://uploads.onecompiler.io/42yatf6fu/1782533644984/logo_purple.png
- Text Title: https://uploads.onecompiler.io/42yatf6fu/1782533719856/text_title_p.png
- Watermark: https://uploads.onecompiler.io/42yatf6fu/1782533795284/watermark_purple.png
- Theme Color: `#a855f7`

**Beta Edition (Orange/Energetic Focus) - DEFAULT:**
- Logo: https://uploads.onecompiler.io/42yatf6fu/1782533768745/logo_orange%20y.png
- Favicon: https://uploads.onecompiler.io/42yatf6fu/1782533768745/logo_orange%20y.png
- Text Title: https://uploads.onecompiler.io/42yatf6fu/1782533702320/text_title%20o.png
- Watermark: https://uploads.onecompiler.io/42yatf6fu/1782533728574/watermark_orange.png
- Theme Color: `#FF4A17`
