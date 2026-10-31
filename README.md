# Alapadma Odissi Dance Academy: website

The website for **Alapadma Odissi Dance Academy**: [alapadmaodissidance.com](https://alapadmaodissidance.com).

*Tradition · Training · Transformation*

It runs entirely on **Cloudflare**:

- **Cloudflare Workers** serve the website, the admin panel and the API.
- **Cloudflare D1** (a database) stores enquiries, settings, gallery photos and the admin password.

There is no server to rent or maintain, and the free plan covers normal traffic.

## Pages

| Page | File | URL |
|---|---|---|
| Home | `public/index.html` | `/` |
| The Guru (Purnima Piyali's story, lineage, repertoire) | `public/guru.html` | `/guru` |
| Performance Journey (maps, timeline 2003–2023) | `public/journey.html` | `/journey` |
| The Art of Odissi | `public/odissi.html` | `/odissi` |
| Classes & Programmes | `public/classes.html` | `/classes` |
| Gallery & Videos (photos, YouTube grid) | `public/gallery.html` | `/gallery` |
| Contact & Enquiry form, studio map | `public/contact.html` | `/contact` |

## Admin panel

The admin panel lives at a **private address** that you choose, set as the secret `ADMIN_PATH`. It is hidden from visitors:

- The website has no links to it, and it isn't listed in `robots.txt` or the sitemap.
- It sends `noindex` headers, so search engines skip it.
- Every page and API call behind it requires a sign-in.
- Guessable addresses such as `/admin` just show "page not found".

| Section | What you can do |
|---|---|
| **Dashboard** | See new enquiries at a glance; quick links to common tasks. |
| **Enquiries** | Every enquiry-form submission is saved here. Filter by status (new, contacted, enrolled, closed), add private notes, call, WhatsApp or email the family with one tap, or export to CSV/Excel. |
| **Gallery** | Upload photos by dragging them in (they're resized automatically), add captions, reorder or delete them. New photos appear at the top of the Gallery page. |
| **Settings** | Phone, WhatsApp, email, studio address, Google Map, class timings, YouTube channel and featured videos, Instagram, Facebook, the **announcement bar**, and the Web3Forms email-alert key. Changes go live immediately. |
| **Account** | Change the admin password, sign out. |

**Enquiry alerts.** Each enquiry is saved in the admin panel. If a Web3Forms key is set in Settings, it is also emailed to the Gmail account registered with Web3Forms.

**YouTube.** The latest videos and Shorts from the channel appear automatically on the Home and Gallery pages. They're refreshed every hour by a scheduled job, and no API key is needed.

## Updating the website

| What changes | How |
|---|---|
| Phone, WhatsApp, address, timings, announcement, photos, YouTube videos | **Admin panel.** Live instantly, no deployment needed. |
| Page text, design, new pages, code | Edit the files and **push to GitHub `main`**. Cloudflare deploys automatically (see below). |

## First-time setup on Cloudflare

You need Node.js 20+ and the Cloudflare account that holds the `alapadmaodissidance.com` domain.

```bash
npm install
npx wrangler login                       # opens the browser once to authorise this computer

npx wrangler d1 create alapadma          # copy the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply alapadma --remote

npx wrangler secret put ADMIN_PATH       # e.g. /studio-desk-7381   (keep it private)
npx wrangler secret put ADMIN_PASSWORD   # first-time password, at least 10 characters

npx wrangler deploy                      # publishes the Worker and connects the domain
```

`wrangler.jsonc` attaches `alapadmaodissidance.com` and `www.alapadmaodissidance.com` as custom domains. If either name already has DNS records, for example from an old site, delete those records in the Cloudflare dashboard first.

Then open `https://alapadmaodissidance.com/<ADMIN_PATH>/`, sign in, change the password under **Account**, and fill in **Settings**. That includes the Web3Forms key, which is deliberately not stored in the code.

### Automatic deploys from GitHub

In the Cloudflare dashboard, go to **Workers & Pages**, then **alapadma-odissi-dance**, then **Settings → Builds**, and click **Connect**. Choose this GitHub repository and the `main` branch, and keep the deploy command `npx wrangler deploy`. From then on, every push to `main` is built and published automatically. Secrets and admin data are kept between deploys.

If a change adds a new file in `migrations/`, apply it once with `npm run db:migrate`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars            # local ADMIN_PATH / ADMIN_PASSWORD
npm run db:migrate:local
npm run dev                               # http://localhost:8787 (local D1 database)
```

## Project structure

```
public/                    the website (served as static files by Cloudflare)
  *.html                   pages (index, guru, journey, odissi, classes, gallery, contact, 404)
  assets/css, assets/js    design system, page styles, behaviour
  assets/js/site-config.js default settings (strict JSON; the Worker serves the saved settings here)
  assets/data/youtube.json fallback copy of the channel's videos
  assets/img/              photos, logo, icons, maps
  _headers                 security and cache headers for static files
worker/
  index.js                 routing, API, admin API, uploads, live settings, hourly job
  lib/auth.js              passwords (PBKDF2), sessions, rate limits
  lib/youtube.js           YouTube channel feed
  admin/                   admin panel (bundled into the Worker, never public)
migrations/                D1 database schema
wrangler.jsonc             Cloudflare configuration
```

## Security

- **Passwords:** PBKDF2-SHA256, 60,000 iterations by default. The free plan's limit on computing time per request rules out more; on the $5/month Workers plan, set the `PBKDF2_ITERATIONS` variable to `100000`.
- **Sessions:** HttpOnly, Secure, SameSite=Strict cookies, limited to the admin path. Only a hash of each session token is stored. Sessions end after 2 hours idle or 12 hours in total, and changing the password signs every session out.
- **Login limits:** 8 attempts per 15 minutes per IP address, plus an overall limit. Enquiry limits are similar. Cloudflare supplies the visitor's real IP address.
- **Browser protections:** a strict Content Security Policy (the one inline script is allowed only by its hash), HSTS, and same-origin checks on every change made through the API.
- **Uploads:** photos must be genuine JPG, PNG or WebP files.
- **CSV export:** spreadsheet formulas are neutralised.

---

Designed, developed & maintained by [ELARXSYS.COM](https://elarxsys.com).
