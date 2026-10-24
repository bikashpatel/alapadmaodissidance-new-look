# Alapadma Odissi Dance Academy: website

The website for **Alapadma Odissi Dance Academy**: [alapadmaodissidance.com](https://alapadmaodissidance.com).

*Tradition · Training · Transformation*

It's a static site (HTML, CSS and vanilla JavaScript) with no build step. It is served by nginx in a small, non-root Docker container. It also works on any static host, such as Cloudflare Pages.

## Pages

| Page | File | Clean URL |
|---|---|---|
| Home | `index.html` | `/` |
| The Guru (Purnima's story, lineage, repertoire) | `guru.html` | `/guru` |
| Performance Journey (world and India maps, timeline) | `journey.html` | `/journey` |
| The Art of Odissi | `odissi.html` | `/odissi` |
| Classes & Programmes (learning path, FAQ) | `classes.html` | `/classes` |
| Gallery & Videos (photos, YouTube) | `gallery.html` | `/gallery` |
| Contact & Enquiry form | `contact.html` | `/contact` |

## Updating contact details, WhatsApp and YouTube

All contact settings live in **one file**: [`assets/js/site-config.js`](assets/js/site-config.js).

```js
phone: "+91 98765 43210",            // shown on the site
whatsapp: "919876543210",            // digits only; turns on WhatsApp buttons and WhatsApp enquiries
email: "info@alapadmaodissidance.com",
address: "Bhubaneswar, Odisha, India",
hours: "Mon–Sat · 5:00–8:00 pm IST",
youtubeChannel: "https://www.youtube.com/@your-channel",
youtubeVideos: ["VIDEO_ID_1", "VIDEO_ID_2"],   // first one is featured
instagram: "", facebook: "",
web3formsKey: ""                     // optional, see below
```

Any link that depends on an empty value stays hidden until you fill the value in.

### How enquiries reach you

The enquiry forms on the Home and Contact pages try these channels in order:

1. **Email inbox, directly.** If `web3formsKey` is set, the form posts to [Web3Forms](https://web3forms.com) (a free key) and the enquiry lands in your inbox.
2. **WhatsApp.** If `whatsapp` is set, the form opens WhatsApp with the enquiry pre-filled.
3. **Email app.** Otherwise the form opens the visitor's email app, addressed to `email`.

**Tip:** Cloudflare Email Routing can create `info@alapadmaodissidance.com` and forward it to your Gmail for free. In the dashboard, go to the domain, then **Email**, then **Email Routing**.

## Run locally

```bash
# Option 1: Docker (production-like)
docker compose up --build
# open http://localhost:8080

# Option 2: any static server
python3 -m http.server 8000
# open http://localhost:8000
```

## Docker

```bash
docker build -t alapadma-odissi-dance .
docker run -d -p 8080:8080 --read-only --tmpfs /tmp --name alapadma alapadma-odissi-dance
```

What the image does:

- **Server:** `nginxinc/nginx-unprivileged:1.27-alpine`, running as a non-root user (uid 101) on port **8080**.
- **Clean URLs:** `/guru` serves `guru.html`, and `/guru.html` redirects (301) to `/guru`.
- **Compression:** gzip is on.
- **Caching:** assets are cached for one week; HTML is always revalidated.
- **Security headers:** CSP, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy.
- **Health check:** `GET /healthz`.
- **Read-only friendly:** only `/tmp` needs to be writable, as set in `docker-compose.yml`.

### Deploying the container

Run the image on any container host, such as a VPS with Docker, Google Cloud Run, Fly.io, Render or Railway. Then point the Cloudflare DNS record for `alapadmaodissidance.com` at it, with the proxy (orange cloud) turned on. Cloudflare then provides HTTPS and CDN caching.

If you'd rather not run a container, the same files deploy as-is to **Cloudflare Pages**. Connect this repository, leave the build command empty, set the output directory to `/`, then add the custom domain. The `_headers` file supplies the same security and caching headers there.

## Project structure

```
index.html, guru.html, journey.html, odissi.html, classes.html, gallery.html, contact.html, 404.html
assets/
  css/style.css          design system (colours, type, components)
  css/pages/*.css        page-specific styles
  js/site-config.js      contact settings (edit me)
  js/main.js             navigation, animations, filters, lightbox, YouTube, enquiry form
  js/pages/*.js          page-specific scripts
  img/                   photos (.webp + .jpg), logo, icons.svg sprite, maps, patterns
nginx/                   nginx config used by the Docker image
Dockerfile, docker-compose.yml
_headers                 headers for Cloudflare Pages (if used instead of Docker)
robots.txt, sitemap.xml, site.webmanifest
```

## Photos

The Guru's photos are currently taken from the printed brochure, so they're low resolution. To improve the gallery and profile, replace them with high-resolution images under the same names in `assets/img/` (`purnima-*.jpg` and `.webp`), or add new `gallery__item` entries to `gallery.html`.
