# Alapadma Odissi Dance Academy: website

The website for **Alapadma Odissi Dance Academy**: [alapadmaodissidance.com](https://alapadmaodissidance.com).

*Tradition · Training · Transformation*

The site is fast static HTML, CSS and vanilla JavaScript, served by a small Node.js server with no third-party dependencies. The same server runs a password-protected **admin panel** for managing the website. Everything ships as one Docker container.

## Pages

| Page | File | URL |
|---|---|---|
| Home | `public/index.html` | `/` |
| The Guru (Purnima's story, lineage, repertoire) | `public/guru.html` | `/guru` |
| Performance Journey (world and India maps, timeline) | `public/journey.html` | `/journey` |
| The Art of Odissi | `public/odissi.html` | `/odissi` |
| Classes & Programmes (learning path, FAQ) | `public/classes.html` | `/classes` |
| Gallery & Videos | `public/gallery.html` | `/gallery` |
| Contact & Enquiry form | `public/contact.html` | `/contact` |

## Admin panel

The admin panel lives at **`/admin/`** by default; set the `ADMIN_PATH` environment variable to move it. It is hidden from visitors:

- The website has no links to it.
- It isn't listed in `robots.txt` or the sitemap.
- It sends `noindex` headers so search engines skip it.
- Every admin page and API call requires a sign-in.

For extra privacy, set `ADMIN_PATH` to something hard to guess, such as `/studio-desk-7381`.

| Section | What you can do |
|---|---|
| **Dashboard** | See new enquiries at a glance; quick links to common tasks. |
| **Enquiries** | Every enquiry-form submission is saved here. Filter by status (new, contacted, enrolled, closed), search, add private notes, call, WhatsApp or email the family with one tap, delete, or export to CSV/Excel. |
| **Gallery** | Upload photos by dragging them in (they're resized automatically), add captions and descriptions, reorder or delete them. New photos appear at the top of the website's Gallery page. |
| **Settings** | Phone, WhatsApp, email, studio address, class timings, YouTube channel and featured videos, Instagram, Facebook, and the **announcement bar** across the top of every page (e.g. "Admissions open for the December batch"). Changes go live immediately. |
| **Account** | Change the admin password and sign out. |

### Admin password

- **First start:** if `ADMIN_PASSWORD` is set, it becomes the password. If not, a random password is generated and printed once in the logs; view them with `docker compose logs web`.
- **Changing it:** after signing in, go to **Account → Change password**.
- **Forgotten it:** run `docker compose exec web node server/set-password.js "a-new-long-password"`, then `docker compose restart web`.

Security features:

- Passwords are hashed with scrypt.
- Session cookies are HttpOnly and SameSite=Strict, and Secure when served over HTTPS.
- Sessions end after 2 hours idle, or 12 hours in total.
- Login and enquiry rate limits apply.
- The admin pages use a strict Content Security Policy.
- Uploads are checked to be genuine JPG, PNG or WebP images.

## Run it

```bash
cp .env.example .env              # set ADMIN_PASSWORD (and optionally ADMIN_PATH)
docker compose up -d --build
# website:      http://localhost:8080
# admin panel:  http://localhost:8080/admin/
```

The data (settings, enquiries, uploaded photos, password hash) lives in the Docker volume `alapadma-data`, so it survives rebuilds and upgrades. To back it up:

```bash
docker run --rm -v alapadma-data:/data -v "$PWD":/backup alpine tar czf /backup/alapadma-data.tgz -C /data .
```

Without Docker (Node.js 20 or newer):

```bash
ADMIN_PASSWORD="choose-a-long-password" node server/server.js     # http://localhost:8080
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port the server listens on |
| `ADMIN_PATH` | `/admin` | URL of the admin panel |
| `ADMIN_PASSWORD` | *(random)* | First-time admin password |
| `TRUST_PROXY` | `0` (`1` in compose) | Trust Cloudflare/proxy client-IP and HTTPS headers. Use `1` only behind a proxy. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where data is stored |
| `HOST_PORT` | `8080` | (compose only) Port published on the host |

## Deploying

1. Run the container on any host with Docker, such as a VPS, Google Cloud Run (with a volume for `/data`), Fly.io, Render or Railway.
2. In Cloudflare DNS, point `alapadmaodissidance.com` at it with the proxy (orange cloud) turned on. Cloudflare provides HTTPS and caching.
3. Keep `TRUST_PROXY=1` so rate limits see real visitor IPs.

**Static-only option:** the `public/` folder also works on its own on Cloudflare Pages (output directory `public`, no build command). The admin panel needs the Node server, so on Pages the settings come from `public/assets/js/site-config.js` instead, and enquiries are sent by email or WhatsApp.

## Project structure

```
public/                    the website (served as-is)
  index.html, guru.html, journey.html, odissi.html, classes.html, gallery.html, contact.html, 404.html
  assets/css/style.css     design system (colours, type, components)
  assets/css/pages/*.css   page-specific styles
  assets/js/main.js        navigation, animations, filters, lightbox, YouTube, enquiry form, announcement bar
  assets/js/site-config.js default settings (the server replaces this with the admin settings)
  assets/js/pages/*.js     page-specific scripts
  assets/img/              photos, logo, icons, maps, patterns
  robots.txt, sitemap.xml, site.webmanifest, _headers (Cloudflare Pages only)
server/
  server.js                web server + admin API
  lib/auth.js, lib/store.js
  set-password.js          reset the admin password
  admin/                   admin panel (HTML/CSS/JS)
Dockerfile, docker-compose.yml, .env.example
```

## Photos

The Guru's photos are currently taken from the printed brochure, so they're low resolution. The easiest way to add better photos is **Admin → Gallery**. To replace the built-in photos, overwrite the files of the same name in `public/assets/img/` (`purnima-*.jpg` and `.webp`).

---

Designed, developed & maintained by [ELARXSYS.COM](https://elarxsys.com).
