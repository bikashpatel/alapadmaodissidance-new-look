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
  var lbLinks = $$("a[data-lightbox]");
  if (lbLinks.length) {
    var lb = doc.createElement("div");
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
      group = lbLinks.filter(function (l) { return l.getAttribute("data-lightbox") === name && l.offsetParent !== null; });
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
    lbLinks.forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); open(a); });
    });
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
  $$("[data-youtube-grid]").forEach(function (grid) {
    if (videos.length > 1) {
      grid.innerHTML = "";
      videos.slice(1).forEach(function (v) { grid.appendChild(liteEmbed(v.id, v.title)); });
      grid.removeAttribute("hidden");
    }
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

      if (!via && SITE.web3formsKey) {
        var data = { access_key: SITE.web3formsKey, subject: subject, from_name: SITE.name, message: message };
        $$("input, select, textarea", form).forEach(function (el) {
          if (el.name && (el.type !== "radio" || el.checked) && !el.closest(".hp-field")) data[el.name] = el.value;
        });
        var btn = e.submitter;
        if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
        fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(data)
        }).then(function (r) { return r.json(); }).then(function (res) {
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
        setStatus(form, "success", "<strong>Your email app is opening</strong> with the enquiry pre-filled. If nothing happens, write to us at <a href=\"mailto:" + SITE.email + "\">" + SITE.email + "</a>.");
        return;
      }
      setStatus(form, "error", "Online enquiries are being set up. Please check back soon.");
    });
  });

  /* ---------- misc ---------- */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
