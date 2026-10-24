/* Gallery & Videos page: featured-banner state and the share button */
(function () {
  "use strict";

  var SITE = window.SITE || {};

  /* ---------- featured banner ----------
     main.js replaces [data-youtube-featured] with an embed when SITE.youtubeVideos is set,
     and points the banner at SITE.youtubeChannel when that is set. With neither, the banner
     would be a "play" button that only links back to this section, so show it as a still. */
  var videos = Array.isArray(SITE.youtubeVideos) ? SITE.youtubeVideos.filter(Boolean) : [];
  var banner = document.querySelector("[data-youtube-featured] .video-frame--banner");
  if (banner && !SITE.youtubeChannel && !videos.length) {
    banner.removeAttribute("href");
    banner.removeAttribute("aria-label");
    banner.classList.add("is-soon");
  }
  /* videos configured without a channel URL: the "launching soon" pills would contradict the player */
  if (videos.length && !SITE.youtubeChannel) {
    document.querySelectorAll('[data-requires-not="youtubeChannel"]').forEach(function (el) { el.hidden = true; });
  }

  /* ---------- photos added from the admin panel (newest first) ---------- */
  var grid = document.querySelector(".gallery");
  if (grid && SITE.galleryEndpoint && window.fetch) {
    fetch(SITE.galleryEndpoint, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        if (!Array.isArray(items) || !items.length) return;
        var frag = document.createDocumentFragment();
        items.forEach(function (it) {
          if (!it || typeof it.src !== "string" || !/^\/uploads\/[a-f0-9]+\.(jpg|png|webp)$/.test(it.src)) return;
          var a = document.createElement("a");
          a.className = "gallery__item gallery__item--new";
          a.href = it.src;
          a.setAttribute("data-lightbox", "gallery");
          a.setAttribute("data-caption", it.caption || it.alt || "");
          var fig = document.createElement("figure");
          var img = document.createElement("img");
          img.src = it.src;
          img.alt = it.alt || "";
          img.loading = "lazy";
          img.decoding = "async";
          if (it.width && it.height) { img.width = it.width; img.height = it.height; }
          fig.appendChild(img);
          if (it.caption) {
            var cap = document.createElement("figcaption");
            cap.textContent = it.caption;
            fig.appendChild(cap);
          }
          a.appendChild(fig);
          frag.appendChild(a);
        });
        grid.insertBefore(frag, grid.firstChild);
      })
      .catch(function () { /* keep the built-in photos */ });
  }

  /* ---------- share: native share sheet, or copy the link ---------- */
  var btn = document.querySelector("[data-share]");
  if (!btn) return;
  var status = document.querySelector("[data-share-status]");
  var label = btn.querySelector("[data-share-label]");
  var canonical = document.querySelector('link[rel="canonical"]');
  var url = canonical ? canonical.href : window.location.href;
  var title = document.title;
  var text = "Moments in motion: Odissi photographs and videos from Alapadma Odissi Dance Academy.";

  var canShare = typeof navigator.share === "function";
  var canCopy = !!(navigator.clipboard && window.isSecureContext);
  if (!canShare && !canCopy) return; // the WhatsApp and email links still work

  function say(msg) { if (status) status.textContent = msg; }

  if (!canShare && label) label.textContent = "Copy Link";
  btn.hidden = false;

  btn.addEventListener("click", function () {
    if (canShare) {
      navigator.share({ title: title, text: text, url: url }).catch(function () { /* dismissed */ });
      return;
    }
    navigator.clipboard.writeText(url).then(function () {
      say("Link copied. Paste it anywhere to share the gallery.");
    }, function () {
      say("Copy this link to share: " + url);
    });
  });
})();
