/* Alapadma Odissi Dance Academy — site behaviour */
(function () {
  "use strict";

  var SITE = window.SITE || {};
  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DEFAULT_MSG = "Namaskar! I would like to know more about Odissi classes at Alapadma Odissi Dance Academy.";

  root.classList.add("js");
  window.__alapadmaReady = true;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function digits(v) { return String(v || "").replace(/[^\d]/g, ""); }
  function waLink(text) { return "https://wa.me/" + digits(SITE.whatsapp) + "?text=" + encodeURIComponent(text || DEFAULT_MSG); }

  /* ---------- header state ---------- */
  var header = $("[data-header]");
  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 24);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- mobile navigation ---------- */
  var toggle = $("[data-nav-toggle]");
  var drawer = $("[data-mobile-nav]");
  function setNav(open) {
    if (!toggle || !drawer) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    drawer.classList.toggle("is-open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    if (open) drawer.removeAttribute("inert"); else drawer.setAttribute("inert", "");
    doc.body.classList.toggle("is-locked", open);
    doc.body.classList.toggle("nav-open", open);
  }
  if (toggle && drawer) {
    drawer.removeAttribute("hidden");
    setNav(false);
    toggle.addEventListener("click", function () { setNav(toggle.getAttribute("aria-expanded") !== "true"); });
    $$("a", drawer).forEach(function (a) { a.addEventListener("click", function () { setNav(false); }); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") setNav(false); });
    window.addEventListener("resize", function () { if (window.innerWidth > 1140) setNav(false); });
  }

  /* ---------- reveal on scroll ---------- */
  var reveals = $$(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          el.classList.add("is-visible");
          io.unobserve(el);
          setTimeout(function () { el.classList.add("is-done"); }, 1500);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- animated counters: <span data-count="30" data-suffix="+"> ---------- */
  var counters = $$("[data-count]");
  function runCounter(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var suffix = el.getAttribute("data-suffix") || "";
    if (reduceMotion || isNaN(target)) { el.textContent = target + suffix; return; }
    var start = null, dur = 1600;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (counters.length && "IntersectionObserver" in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { runCounter(entry.target); co.unobserve(entry.target); }
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { co.observe(el); });
  } else {
    counters.forEach(runCounter);
  }

  /* ---------- filter chips ----------
     <div class="chips" data-filter-for="#timeline">
       <button class="chip" data-filter="all" aria-pressed="true">All</button>
       <button class="chip" data-filter="india">India</button>
     </div>
     items inside #timeline carry data-category="india 2015" */
  $$("[data-filter-for]").forEach(function (group) {
    var target = $(group.getAttribute("data-filter-for"));
    if (!target) return;
    var buttons = $$("[data-filter]", group);
    var items = $$("[data-category]", target);
    buttons.forEach(function (btn) {
      var key = btn.getAttribute("data-filter");
      var count = btn.querySelector(".count");
      if (count) {
        count.textContent = key === "all" ? items.length : items.filter(function (it) {
          return (" " + it.getAttribute("data-category") + " ").indexOf(" " + key + " ") > -1;
        }).length;
      }
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); b.classList.toggle("is-active", b === btn); });
        items.forEach(function (it) {
          var show = key === "all" || (" " + it.getAttribute("data-category") + " ").indexOf(" " + key + " ") > -1;
          it.classList.toggle("is-hidden", !show);
          if (show) it.classList.add("is-visible");
        });
        target.dispatchEvent(new CustomEvent("filterchange", { detail: { filter: key } }));
      });
    });
  });

  /* ---------- lightbox: <a href="large.jpg" data-lightbox="gallery" data-caption="..."> ---------- */
  var lb = null;
  doc.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-lightbox]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (!lb) buildLightbox();
    openLightbox(a);
  });
  var openLightbox;
  function buildLightbox() {
    lb = doc.createElement("div");
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Image viewer");
    lb.innerHTML =
      '<figure class="lightbox__figure"><img class="lightbox__img" alt=""><figcaption class="lightbox__caption"></figcaption></figure>' +
      '<button class="lightbox__btn lightbox__close" type="button" aria-label="Close"><svg class="icon" aria-hidden="true"><use href="assets/img/icons.svg#close"></use></svg></button>' +
      '<button class="lightbox__btn lightbox__prev" type="button" aria-label="Previous image"><svg class="icon" aria-hidden="true"><use href="assets/img/icons.svg#arrow-left"></use></svg></button>' +
      '<button class="lightbox__btn lightbox__next" type="button" aria-label="Next image"><svg class="icon" aria-hidden="true"><use href="assets/img/icons.svg#arrow-right"></use></svg></button>';
    doc.body.appendChild(lb);
    var lbImg = $(".lightbox__img", lb), lbCap = $(".lightbox__caption", lb);
    var group = [], idx = 0, lastFocus = null;
    function show(i) {
      idx = (i + group.length) % group.length;
      var a = group[idx];
      var cap = a.getAttribute("data-caption") || (a.querySelector("figcaption") || {}).textContent || "";
      var thumb = a.querySelector("img");
      lbImg.src = a.getAttribute("href");
      lbImg.alt = thumb ? thumb.alt : cap;
      lbCap.textContent = cap.trim();
      var multi = group.length > 1;
      $(".lightbox__prev", lb).hidden = !multi;
      $(".lightbox__next", lb).hidden = !multi;
    }
    function open(a) {
      var name = a.getAttribute("data-lightbox");
      group = $$("a[data-lightbox]").filter(function (l) { return l.getAttribute("data-lightbox") === name && l.offsetParent !== null; });
      if (!group.length) group = [a];
      lastFocus = a;
      show(group.indexOf(a));
      lb.classList.add("is-open");
      doc.body.classList.add("is-locked");
      setInert(true);
      $(".lightbox__close", lb).focus();
    }
    function setInert(on) {
      $$("body > *").forEach(function (el) {
        if (el === lb) return;
        if (on) el.setAttribute("inert", ""); else el.removeAttribute("inert");
      });
    }
    function close() {
      lb.classList.remove("is-open");
      doc.body.classList.remove("is-locked");
      setInert(false);
      if (lastFocus) lastFocus.focus();
    }
    openLightbox = open;
    $(".lightbox__close", lb).addEventListener("click", close);
    $(".lightbox__prev", lb).addEventListener("click", function () { show(idx - 1); });
    $(".lightbox__next", lb).addEventListener("click", function () { show(idx + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    doc.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        var btns = $$(".lightbox__btn", lb).filter(function (b) { return !b.hidden; });
        var i = btns.indexOf(doc.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      }
      if (e.key === "ArrowLeft") show(idx - 1);
      if (e.key === "ArrowRight") show(idx + 1);
    });
  }

  /* ---------- site config → links and text ---------- */
  var linkBuilders = {
    whatsapp: function () { return SITE.whatsapp ? waLink() : ""; },
    phone: function () { return SITE.phone ? "tel:" + SITE.phone.replace(/[^\d+]/g, "") : ""; },
    email: function () { return SITE.email ? "mailto:" + SITE.email : ""; },
    youtube: function () { return SITE.youtubeChannel || ""; },
    subscribe: function () { return SITE.youtubeChannel ? SITE.youtubeChannel + "?sub_confirmation=1" : ""; },
    map: function () {
      if (SITE.mapLink) return SITE.mapLink;
      var q = SITE.mapQuery || SITE.address;
      return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
    },
    directions: function () {
      var q = SITE.mapQuery || SITE.address;
      return q ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q) : "";
    },
    instagram: function () { return SITE.instagram || ""; },
    facebook: function () { return SITE.facebook || ""; }
  };
  $$("[data-site-link]").forEach(function (el) {
    var key = el.getAttribute("data-site-link");
    var href = linkBuilders[key] ? linkBuilders[key]() : "";
    if (href) {
      el.setAttribute("href", href);
      if (/^https?:/.test(href)) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    }
  });
  $$("[data-site-text]").forEach(function (el) {
    var val = SITE[el.getAttribute("data-site-text")];
    if (val) el.textContent = val;
  });
  function hasValue(key) {
    var v = SITE[key];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }
  $$("[data-requires]").forEach(function (el) {
    var keys = el.getAttribute("data-requires").split(/\s+/);
    var ok = keys.some(hasValue);
    if (!ok) el.setAttribute("hidden", ""); else el.removeAttribute("hidden");
  });
  $$("[data-requires-not]").forEach(function (el) {
    if (hasValue(el.getAttribute("data-requires-not"))) el.setAttribute("hidden", "");
  });

  /* ---------- YouTube (privacy-friendly, loads the player on click) ---------- */
  function liteEmbed(id, title) {
    var a = doc.createElement("a");
    a.className = "video-frame";
    a.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
    a.setAttribute("aria-label", "Play video: " + (title || "Alapadma on YouTube"));
    a.innerHTML =
      '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg" alt="" loading="lazy">' +
      '<span class="video-frame__play" aria-hidden="true"><svg class="icon"><use href="assets/img/icons.svg#play"></use></svg></span>';
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var iframe = doc.createElement("iframe");
      iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
      iframe.title = title || "Alapadma Odissi Dance Academy video";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      var holder = doc.createElement("div");
      holder.className = "video-frame";
      holder.appendChild(iframe);
      a.replaceWith(holder);
    });
    return a;
  }
  var videos = (Array.isArray(SITE.youtubeVideos) ? SITE.youtubeVideos : []).map(function (v) {
    return typeof v === "string" ? { id: v } : v;
  }).filter(function (v) { return v && v.id; });
  $$("[data-youtube-featured]").forEach(function (slot) {
    if (videos.length) { slot.innerHTML = ""; slot.appendChild(liteEmbed(videos[0].id, videos[0].title)); }
  });
  $$("[data-yt-handle]").forEach(function (el) {
    var m = /youtube\.com\/(@[\w.-]+)/.exec(SITE.youtubeChannel || "");
    if (m) el.textContent = m[1];
  });
  $$("[data-youtube-featured-title]").forEach(function (el) {
    if (videos.length && videos[0].title) { el.textContent = videos[0].title; el.hidden = false; }
  });
  $$("[data-youtube-grid]").forEach(function (grid) {
    if (videos.length > 1) {
      grid.innerHTML = "";
      videos.slice(1).forEach(function (v) { grid.appendChild(liteEmbed(v.id, v.title)); });
      grid.removeAttribute("hidden");
    }
  });

  /* ---------- latest videos from the YouTube channel ---------- */
  function fmtMonth(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }
  function fmtViews(n) {
    if (!n) return "";
    return (n >= 1000 ? (Math.round(n / 100) / 10) + "K" : String(n)) + (n === 1 ? " view" : " views");
  }
  function videoCard(v) {
    var a = doc.createElement("a");
    a.className = "yt-card" + (v.short ? " yt-card--short" : "");
    a.href = "https://www.youtube.com/" + (v.short ? "shorts/" : "watch?v=") + v.id;
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("data-video", v.id);
    if (v.short) a.setAttribute("data-video-short", "");
    a.setAttribute("aria-label", "Play video: " + v.title);
    var thumb = doc.createElement("span");
    thumb.className = "yt-card__thumb";
    var img = doc.createElement("img");
    img.src = "https://i.ytimg.com/vi/" + v.id + "/hqdefault.jpg";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    thumb.appendChild(img);
    var play = doc.createElement("span");
    play.className = "yt-card__play";
    play.setAttribute("aria-hidden", "true");
    play.innerHTML = '<svg class="icon"><use href="assets/img/icons.svg#play"></use></svg>';
    thumb.appendChild(play);
    if (v.short) {
      var badge = doc.createElement("span");
      badge.className = "yt-card__badge";
      badge.textContent = "Short";
      thumb.appendChild(badge);
    }
    var body = doc.createElement("span");
    body.className = "yt-card__body";
    var t = doc.createElement("span");
    t.className = "yt-card__title";
    t.textContent = v.title;
    var meta = doc.createElement("span");
    meta.className = "yt-card__meta";
    meta.textContent = [fmtMonth(v.published), fmtViews(v.views)].filter(Boolean).join(" · ");
    body.appendChild(t);
    body.appendChild(meta);
    a.appendChild(thumb);
    a.appendChild(body);
    return a;
  }
  var ytGrids = $$("[data-yt-latest], [data-yt-shorts]");
  if (ytGrids.length && window.fetch && SITE.youtubeChannel) {
    fetch(SITE.youtubeEndpoint || "assets/data/youtube.json", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.videos)) return;
        if (!SITE.youtubeEndpoint && data.channelId !== SITE.youtubeChannelId) return; // static snapshot of another channel
        var featured = videos.map(function (v) { return v.id; });
        var list = data.videos.filter(function (v) {
          return v && /^[A-Za-z0-9_-]{11}$/.test(v.id) && featured.indexOf(v.id) === -1;
        });
        ytGrids.forEach(function (grid) {
          var shorts = grid.hasAttribute("data-yt-shorts");
          var limit = parseInt(grid.getAttribute("data-limit"), 10) || (shorts ? 8 : 6);
          var items = list.filter(function (v) { return !!v.short === shorts; }).slice(0, limit);
          if (!items.length) return;
          while (grid.firstChild) grid.removeChild(grid.firstChild);
          items.forEach(function (v) { grid.appendChild(videoCard(v)); });
          var block = grid.closest("[data-yt-block]");
          if (block) block.hidden = false;
        });
      })
      .catch(function () { /* the featured video and channel links still work */ });
  }

  /* ---------- video player pop-up ---------- */
  var vmodal = null, vmodalLast = null;
  function closeVideo() {
    if (!vmodal || !vmodal.classList.contains("is-open")) return;
    var frame = vmodal.querySelector(".video-modal__frame");
    while (frame.firstChild) frame.removeChild(frame.firstChild); // stops playback
    vmodal.classList.remove("is-open");
    doc.body.classList.remove("is-locked");
    $$("body > *").forEach(function (el) { if (el !== vmodal) el.removeAttribute("inert"); });
    if (vmodalLast) vmodalLast.focus();
  }
  function openVideo(id, isShort, title, trigger) {
    if (!vmodal) {
      vmodal = doc.createElement("div");
      vmodal.className = "video-modal";
      vmodal.setAttribute("role", "dialog");
      vmodal.setAttribute("aria-modal", "true");
      vmodal.innerHTML = '<div class="video-modal__box"><div class="video-modal__frame"></div>' +
        '<a class="video-modal__yt" target="_blank" rel="noopener"><svg class="icon" aria-hidden="true"><use href="assets/img/icons.svg#youtube"></use></svg> Watch on YouTube</a></div>' +
        '<button class="lightbox__btn video-modal__close" type="button" aria-label="Close video"><svg class="icon" aria-hidden="true"><use href="assets/img/icons.svg#close"></use></svg></button>';
      doc.body.appendChild(vmodal);
      vmodal.querySelector(".video-modal__close").addEventListener("click", closeVideo);
      vmodal.addEventListener("click", function (e) { if (e.target === vmodal) closeVideo(); });
      doc.addEventListener("keydown", function (e) { if (e.key === "Escape") closeVideo(); });
    }
    vmodalLast = trigger || null;
    vmodal.setAttribute("aria-label", title || "Video");
    var frame = vmodal.querySelector(".video-modal__frame");
    frame.classList.toggle("is-short", !!isShort);
    var iframe = doc.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0&modestbranding=1";
    iframe.title = title || "Alapadma Odissi Dance Academy video";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    frame.appendChild(iframe);
    // some videos (e.g. with licensed music) can only be played on YouTube itself
    vmodal.querySelector(".video-modal__yt").href = "https://www.youtube.com/" + (isShort ? "shorts/" : "watch?v=") + encodeURIComponent(id);
    vmodal.classList.add("is-open");
    doc.body.classList.add("is-locked");
    $$("body > *").forEach(function (el) { if (el !== vmodal) el.setAttribute("inert", ""); });
    vmodal.querySelector(".video-modal__close").focus();
  }
  doc.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-video]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var id = a.getAttribute("data-video");
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    e.preventDefault();
    var label = a.querySelector(".yt-card__title");
    openVideo(id, a.hasAttribute("data-video-short"), label ? label.textContent : "", a);
  });

  /* ---------- Google Map ---------- */
  $$("[data-map-embed]").forEach(function (box) {
    var q = SITE.mapQuery || SITE.address;
    if (!q) return;
    var iframe = doc.createElement("iframe");
    iframe.src = "https://www.google.com/maps?q=" + encodeURIComponent(q) + "&z=16&output=embed";
    iframe.title = "Map showing " + q;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.allowFullscreen = true;
    box.appendChild(iframe);
    box.classList.add("is-ready");
  });

  /* ---------- enquiry form ---------- */
  function labelFor(form, el) {
    if (el.getAttribute("data-label")) return el.getAttribute("data-label");
    if (el.type === "radio") {
      var fs = el.closest("fieldset");
      var lg = fs && fs.querySelector("legend");
      if (lg) return lg.textContent.replace(/[*?]/g, "").trim();
    }
    var lab = el.id && form.querySelector('label[for="' + el.id + '"]');
    return lab ? lab.textContent.replace(/[*?]/g, "").trim() : el.name;
  }
  function buildMessage(form) {
    var lines = ["Namaskar! New class enquiry for " + (SITE.name || "Alapadma") + ":", ""];
    var seen = {};
    $$("input, select, textarea", form).forEach(function (el) {
      if (!el.name || el.type === "hidden" || el.classList.contains("hp-field") || el.closest(".hp-field")) return;
      if ((el.type === "radio" || el.type === "checkbox") && !el.checked) return;
      var val = (el.value || "").trim();
      if (!val || seen[el.name + val]) return;
      seen[el.name + val] = true;
      lines.push(labelFor(form, el) + ": " + val);
    });
    return lines.join("\n");
  }
  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function enquiryData(form) {
    var data = { page: window.location.pathname };
    $$("input, select, textarea", form).forEach(function (el) {
      if (!el.name || el.closest(".hp-field")) return;
      if ((el.type === "radio" || el.type === "checkbox") && !el.checked) return;
      data[el.name] = (el.value || "").trim();
    });
    var hp = form.querySelector(".hp-field input");
    if (hp) data.website = hp.value;
    return data;
  }
  // Web3Forms email alert. Sent as FormData so the browser makes a simple request with no
  // CORS preflight (Web3Forms' bot protection rejects preflight requests).
  function web3formsData(form, subject, message) {
    var fd = new FormData();
    fd.append("access_key", SITE.web3formsKey);
    fd.append("subject", subject);
    fd.append("from_name", SITE.name || "Alapadma website");
    var nameEl = form.querySelector('[name="name"]');
    var emailEl = form.querySelector('[name="email"]');
    var phoneEl = form.querySelector('[name="phone"]');
    if (nameEl && nameEl.value) fd.append("name", nameEl.value.trim());
    if (emailEl && emailEl.value) fd.append("email", emailEl.value.trim()); // becomes the reply-to address
    if (phoneEl && phoneEl.value) fd.append("phone", phoneEl.value.trim());
    fd.append("message", message);
    return fd;
  }
  function sendWeb3forms(fd) {
    return fetch("https://api.web3forms.com/submit", { method: "POST", body: fd, headers: { Accept: "application/json" } });
  }
  function recordEnquiry(form) {
    return fetch(SITE.enquiryEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(enquiryData(form))
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (res) {
        if (!r.ok) throw new Error(res.error || "failed");
        return res;
      });
    });
  }
  function setStatus(form, type, html) {
    var box = $(".form__status", form);
    if (!box) return;
    box.className = "form__status is-" + type;
    box.innerHTML = html;
    box.setAttribute("role", type === "error" ? "alert" : "status");
  }

  $$("form[data-enquiry]").forEach(function (form) {
    // pre-select a programme from ?programme=... (links on the Classes page)
    var params = new URLSearchParams(window.location.search);
    var pre = params.get("programme");
    var sel = form.querySelector('select[name="programme"]');
    if (pre && sel) {
      $$("option", sel).forEach(function (o) { if (o.value === pre || o.getAttribute("data-key") === pre) sel.value = o.value; });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var hp = form.querySelector(".hp-field input, input.hp-field");
      if (hp && hp.value) return;

      var via = (e.submitter && e.submitter.getAttribute("data-send")) || "";
      var message = buildMessage(form);
      var nameEl = form.querySelector('[name="name"]');
      var subject = "Odissi class enquiry" + (nameEl && nameEl.value ? ": " + nameEl.value.trim() : "");

      // WhatsApp chosen explicitly: open it straight away (popup blockers need this to be synchronous),
      // and keep a copy in the admin inbox in the background
      if (via === "whatsapp" && SITE.whatsapp) {
        window.open(waLink(message), "_blank", "noopener");
        if (SITE.enquiryEndpoint) recordEnquiry(form).catch(function () {});
        setStatus(form, "success", "<strong>WhatsApp is opening</strong> with your enquiry pre-filled. Just press send.");
        return;
      }

      if (SITE.enquiryEndpoint && window.fetch) {
        var sendBtn = e.submitter;
        if (sendBtn) { sendBtn.disabled = true; sendBtn.setAttribute("aria-busy", "true"); }
        var notify = SITE.web3formsKey ? web3formsData(form, subject, message) : null;
        recordEnquiry(form).then(function () {
          if (notify) sendWeb3forms(notify).catch(function () {});
          form.reset();
          setStatus(form, "success", "<strong>Thank you.</strong> Your enquiry has reached us and we will get back to you shortly.");
        }).catch(function (err) {
          var alt = SITE.whatsapp ? " You can also reach us on WhatsApp." : SITE.email ? " You can also email us at <a href=\"mailto:" + esc(SITE.email) + "\">" + esc(SITE.email) + "</a>." : "";
          var msg = err && err.message && err.message !== "failed" && err.message !== "Failed to fetch" ? esc(err.message) + "." : "Sorry, the enquiry could not be sent.";
          setStatus(form, "error", msg.replace(/\.\.$/, ".") + alt);
        }).then(function () { if (sendBtn) { sendBtn.disabled = false; sendBtn.removeAttribute("aria-busy"); } });
        return;
      }

      if (!via && SITE.web3formsKey) {
        var btn = e.submitter;
        if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
        sendWeb3forms(web3formsData(form, subject, message)).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.success) {
            form.reset();
            setStatus(form, "success", "<strong>Thank you.</strong> Your enquiry has reached us and we will get back to you shortly.");
          } else { throw new Error("failed"); }
        }).catch(function () {
          setStatus(form, "error", "Sorry, the message could not be sent. Please try WhatsApp or email instead.");
        }).then(function () { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } });
        return;
      }

      if ((via === "whatsapp" || !via) && SITE.whatsapp) {
        window.open(waLink(message), "_blank", "noopener");
        setStatus(form, "success", "<strong>WhatsApp is opening</strong> with your enquiry pre-filled. Just press send.");
        return;
      }
      if (SITE.email) {
        window.location.href = "mailto:" + SITE.email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(message);
        setStatus(form, "success", "<strong>Your email app is opening</strong> with the enquiry pre-filled. If nothing happens, write to us at <a href=\"mailto:" + esc(SITE.email) + "\">" + esc(SITE.email) + "</a>.");
        return;
      }
      setStatus(form, "error", "Online enquiries are being set up. Please check back soon.");
    });
  });

  /* ---------- announcement bar (set from the admin panel) ---------- */
  var ann = SITE.announcement;
  if (ann && ann.text) {
    var annKey = "alp-ann-" + ann.text.length + "-" + ann.text.slice(0, 24);
    var dismissed = false;
    try { dismissed = window.sessionStorage.getItem(annKey) === "1"; } catch (_) { /* storage unavailable */ }
    if (!dismissed) {
      var bar = doc.createElement("div");
      bar.className = "announce";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Announcement");
      var text = doc.createElement("p");
      text.className = "announce__text";
      text.appendChild(doc.createTextNode(ann.text));
      if (ann.linkUrl) {
        var link = doc.createElement("a");
        link.className = "announce__link";
        link.href = ann.linkUrl;
        link.textContent = ann.linkText || "Learn more";
        text.appendChild(doc.createTextNode(" "));
        text.appendChild(link);
      }
      var closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "announce__close";
      closeBtn.setAttribute("aria-label", "Dismiss announcement");
      closeBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="assets/img/icons.svg#close"></use></svg>';
      bar.appendChild(text);
      bar.appendChild(closeBtn);
      doc.body.insertBefore(bar, doc.body.firstChild);
      var syncBar = function () { root.style.setProperty("--announce-h", bar.offsetHeight + "px"); };
      doc.body.classList.add("has-announce");
      syncBar();
      window.addEventListener("resize", syncBar);
      closeBtn.addEventListener("click", function () {
        bar.remove();
        doc.body.classList.remove("has-announce");
        window.removeEventListener("resize", syncBar);
        try { window.sessionStorage.setItem(annKey, "1"); } catch (_) { /* ignore */ }
      });
    }
  }

  /* ---------- misc ---------- */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
