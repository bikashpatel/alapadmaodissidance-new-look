/*
 * YouTube channel feed: reads the public RSS feed of the channel (no API key needed)
 * and turns it into a tidy list of videos for the website's video grid.
 */

const FEED_URL = id => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`;
const UA = "Mozilla/5.0 (compatible; AlapadmaSite/1.0; +https://alapadmaodissidance.com)";

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// "#OdissiDance" → "Odissi Dance"
function humaniseTag(tag) {
  return tag.replace(/^#/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
}

// Titles on the channel often carry hashtags; show a clean, readable title on the website.
const TAG = /#[\p{L}\p{N}_]+/gu;
export function cleanTitle(raw) {
  const title = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const tidy = s => s.replace(/(^|\s)#(?=\s|$)/g, " ").replace(/\s+/g, " ").replace(/^[\s|·,.:;-]+|[\s|·,.:;-]+$/g, "").trim();
  let clean;
  // "#dance (garba dance)" → "garba dance"
  const withoutTags = tidy(title.replace(TAG, ""));
  if (/^\([^()]+\)$/.test(withoutTags)) clean = withoutTags.slice(1, -1).trim();
  else {
    clean = title
      .replace(/(?:#[\p{L}\p{N}_]+[\s,]*){2,}/gu, " ")      // tag clouds: "#a #b #c"
      .replace(/(?:\s#[\p{L}\p{N}_]+)+\s*$/u, "")             // trailing tags
      .replace(/^#[\p{L}\p{N}_]+$/u, "")                         // a title that is only one tag
      .replace(/#([\p{L}\p{N}_]+)/gu, "$1");                     // inline tags keep their word
    clean = tidy(clean);
  }
  if (!clean) {
    const first = (title.match(TAG) || []).map(humaniseTag).find(t => t && !/^shorts?$/i.test(t));
    clean = first || "Alapadma video";
  }
  clean = clean.replace(/\s*\|\|?\s*/g, " · ").replace(/(\S)\(/g, "$1 (").replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function parseFeed(xml) {
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const pick = (e, re) => { const m = re.exec(e); return m ? m[1] : ""; };
  return entries.map(e => {
    const id = pick(e, /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/);
    const raw = pick(e, /<title>([\s\S]*?)<\/title>/);
    const link = pick(e, /<link rel="alternate" href="([^"]+)"/);
    return {
      id,
      title: cleanTitle(raw),
      fullTitle: decodeEntities(raw).trim(),
      published: pick(e, /<published>([^<]+)<\/published>/),
      views: Number(pick(e, /<media:statistics views="(\d+)"/)) || 0,
      short: /\/shorts\//.test(link),
    };
  }).filter(v => v.id);
}

async function get(url, timeoutMs = 8000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en", Cookie: "CONSENT=YES+1; SOCS=CAI" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`YouTube responded ${res.status}`);
  return res.text();
}

export async function fetchChannelVideos(channelId) {
  return parseFeed(await get(FEED_URL(channelId)));
}

// Accepts https://www.youtube.com/@handle, /channel/UC…, youtube.com/c/… and returns the UC… id.
export async function resolveChannelId(channelUrl) {
  const direct = /\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(channelUrl || "");
  if (direct) return direct[1];
  if (!channelUrl) return "";
  const html = await get(channelUrl);
  const m = /"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(html) ||
            /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/.exec(html) ||
            /"channelId":"(UC[A-Za-z0-9_-]{22})"/.exec(html);
  if (!m) throw new Error("Could not find the YouTube channel id");
  return m[1];
}

// Strip tracking parameters (e.g. ?si=…) and normalise to https://www.youtube.com/…
export function normaliseChannelUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return url;
    return `https://www.youtube.com${u.pathname.replace(/\/+$/, "")}`;
  } catch (_) {
    return url;
  }
}

