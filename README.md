# Hussle With Aditya — Super Admin

Internal admin tool: membership price management, lead management and testimonial (video) management.

Plain HTML, CSS, and vanilla JS (ES modules) — no build step, matching the
rest of the project's stack. Entirely separate from `public-frontend/`; it
is never linked from or shipped with the public site.

## Running locally

```
cd super-admin
python3 -m http.server 5600
```

Then visit `http://localhost:5600/login.html`.

Make sure the backend (`server/`) is running and that `5600` (or whichever
port you use) is listed in the server's `CORS_ALLOWED_ORIGINS`.

If you serve this on a different port/origin, update `API_BASE_URL` in
`js/api.js` to match your server's address.

## Pages

| Page | Purpose |
|---|---|
| `login.html` | Admin sign-in |
| `dashboard.html` | Overview — real lead counts only; no fabricated metrics |
| `analytics.html` | Business Analytics (Phase 5) — date-filterable KPIs, revenue/lead trends, payment-status and conversion breakdowns, recent activity, CSV export. See `../server/docs/analytics.md` for exact metric definitions. |
| `settings.html` | View/update the membership price and offer status |
| `leads.html` | Paginated, searchable, filterable lead list |
| `lead-detail.html` | Full lead detail, status transitions, internal notes |
| `testimonials.html` | Manage Bunny.net-hosted video testimonials: add, edit, preview, publish/unpublish, reorder, delete |

## Testimonials (Phase 4)

1. Upload the video in your Bunny.net Stream library (Bunny dashboard) and copy its **video ID** (GUID).
2. In **Testimonials → + Add testimonial**, enter a title and the video ID (display name, description and order are optional). The server checks the ID against your configured library before saving.
3. New testimonials are **unpublished** unless you tick "Publish now". Use **Publish / Unpublish** at any time; the public site updates without a redeploy (the public list may be cached for up to 30 s).
4. Use **↑ / ↓** to change the order shown on the public site. **Edit** can also set an exact order number.
5. **Preview** shows the stored details and loads the Bunny player on demand.
6. **Delete** removes the testimonial from this app and the public site only. **The video stays in Bunny.net** — delete it there separately if you want it gone.

A banner appears if the server has no Bunny.net credentials configured. See `../server/README.md` for setup and troubleshooting.

## How auth works here

- Sessions are cookie-based (`hwa_admin_sid`, HttpOnly, set by the server on
  login). The browser sends it automatically; the frontend never reads or
  stores it directly.
- A second, readable cookie (`hwa_csrf`) is set on login. `js/api.js` reads
  it and attaches it as the `X-CSRF-Token` header on every non-GET request,
  per the server's double-submit-cookie CSRF protection.
- `js/authGuard.js` calls `GET /api/admin/auth/me` on every protected page
  and redirects to `login.html` if the session isn't valid. This is purely
  a UX convenience — the server independently re-checks and enforces
  authorization on every single admin API request regardless of what the
  frontend shows or hides.

## Design

Brand theme per the Phase 2 brief: primary purple `#4B0082`, white surfaces,
lavender accents, soft gradients, fully responsive (the sidebar collapses to
a horizontal bar under ~820px). Shared styling lives in `css/variables.css`
and `css/base.css`.
