/* Alapadma website admin — vanilla JS, no innerHTML for any user-supplied data */
(function () {
  "use strict";

  var API = "api"; // relative to the (secret) admin path
  var STATUSES = ["new", "contacted", "enrolled", "closed"];
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var state = { enquiries: [], filter: "all", search: "", open: null, settings: null, summary: null };

  /* ---------- tiny DOM builder (text is always set as text) ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: { Accept: "application/json" } };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== "/login") {
          showLogin("Your session has ended. Please sign in again.");
          throw new Error("Please sign in");
        }
        if (!res.ok) throw new Error(data.error || "Something went wrong (" + res.status + ")");
        return data;
      });
    });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg, isError) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " toast--error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 6000 : 3000);
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " h ago";
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + " d ago";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  function fullDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function statusBadge(s) { return h("span", { class: "status status--" + s, text: s }); }

  /* ---------- auth ---------- */
  function showLogin(message) {
    $("#app").hidden = true;
    $("#login").hidden = false;
    var err = $("#login-error");
    err.hidden = !message;
    err.textContent = message || "";
    setTimeout(function () { $("#login-password").focus(); }, 50);
  }
  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    route();
  }

  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("#login-password");
    var btn = e.target.querySelector("button");
    if (!pw.value) { showLogin("Please enter the password."); return; }
    btn.disabled = true;
    api("/login", { method: "POST", body: { password: pw.value } }).then(function () {
      pw.value = "";
      showApp();
    }).catch(function (err) {
      showLogin(err.message);
    }).then(function () { btn.disabled = false; });
  });

  function logout() {
    api("/logout", { method: "POST", body: {} }).catch(function () {}).then(function () { showLogin("You have signed out."); });
  }
  $("#logout").addEventListener("click", logout);

  /* ---------- routing ---------- */
  var VIEWS = { dashboard: "Dashboard", enquiries: "Enquiries", gallery: "Gallery", settings: "Settings", account: "Account" };
  function route() {
    var name = (location.hash.replace(/^#\/?/, "") || "dashboard").split("/")[0];
    if (!VIEWS[name]) name = "dashboard";
    document.querySelectorAll(".sidebar__nav a").forEach(function (a) {
      if (a.getAttribute("data-view") === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("#view-title").textContent = VIEWS[name];
    document.title = VIEWS[name] + " | Alapadma admin";
    clear($("#view-actions"));
    var view = clear($("#view"));
    view.appendChild(h("p", { class: "empty", text: "Loading…" }));
    ({ dashboard: viewDashboard, enquiries: viewEnquiries, gallery: viewGallery, settings: viewSettings, account: viewAccount })[name](view);
  }
  window.addEventListener("hashchange", function () { if (!$("#app").hidden) route(); });

  function updateNewBadge(n) {
    var b = $("#nav-new");
    b.hidden = !n;
    b.textContent = n > 99 ? "99+" : String(n);
  }

  /* ==========================================================================
     Dashboard
     ========================================================================== */
  function viewDashboard(view) {
    api("/summary").then(function (s) {
      state.summary = s;
      updateNewBadge(s.enquiries.new);
      clear(view);
      view.appendChild(h("div", { class: "stats" },
        h("a", { class: "stat" + (s.enquiries.new ? " stat--alert" : ""), href: "#/enquiries" }, h("strong", { text: s.enquiries.new }), h("span", { text: "New enquiries" })),
        h("a", { class: "stat", href: "#/enquiries" }, h("strong", { text: s.enquiries.total }), h("span", { text: "All enquiries" })),
        h("a", { class: "stat", href: "#/enquiries" }, h("strong", { text: s.enquiries.enrolled }), h("span", { text: "Enrolled" })),
        h("a", { class: "stat", href: "#/gallery" }, h("strong", { text: s.galleryCount }), h("span", { text: "Photos uploaded" }))
      ));

      var recent = h("div", { class: "list" });
      if (!s.recent.length) recent.appendChild(h("p", { class: "empty", text: "No enquiries yet. They will appear here as soon as someone fills in the form on the website." }));
      s.recent.forEach(function (e) {
        recent.appendChild(h("a", { class: "enq enq--link", href: "#/enquiries", onclick: function () { state.open = e.id; state.filter = "all"; } },
          h("div", { class: "enq__head" },
            h("span", { class: "enq__name", text: e.name }), statusBadge(e.status),
            h("span", { class: "enq__meta" }, h("span", { text: e.programme || "Programme not chosen" }), h("span", { text: fmtDate(e.createdAt) })))));
      });

      var ann = s.announcement || {};
      if (s.enquiries.total >= s.enquiryCapacity * 0.8) {
        view.appendChild(h("p", { class: "form-error", text: "The enquiry inbox holds " + s.enquiries.total + " of " + s.enquiryCapacity +
          " enquiries. Export them (Enquiries → Export CSV) and delete old closed ones, otherwise new enquiries will be refused when it is full." }));
      }
      view.appendChild(h("div", { class: "grid-2" },
        h("section", { class: "panel" }, h("h2", { class: "panel__title", text: "Latest enquiries" }), h("p", { class: "panel__sub", text: "Reply quickly: families often enquire at several academies." }), recent),
        h("section", { class: "panel" },
          h("h2", { class: "panel__title", text: "Quick actions" }),
          h("p", { class: "panel__sub", text: "Common updates to the website." }),
          h("div", { class: "list" },
            h("a", { class: "btn btn--outline", href: "#/gallery" }, "Upload new photos"),
            h("a", { class: "btn btn--outline", href: "#/settings" }, ann.enabled ? "Edit the announcement (currently on)" : "Post an announcement"),
            h("a", { class: "btn btn--outline", href: "#/settings" }, "Update phone, WhatsApp & address"),
            h("a", { class: "btn btn--outline", href: "#/settings" }, "Add YouTube videos"),
            h("a", { class: "btn btn--outline", href: "/", target: "_blank", rel: "noopener" }, "View the website ↗")
          ))
      ));
    }).catch(function (err) { clear(view).appendChild(h("p", { class: "form-error", text: err.message })); });
  }

  /* ==========================================================================
     Enquiries
     ========================================================================== */
  function viewEnquiries(view) {
    $("#view-actions").appendChild(h("a", { class: "btn btn--outline btn--sm", href: API + "/enquiries.csv", download: "" }, "Export CSV"));
    api("/enquiries").then(function (list) {
      state.enquiries = list;
      updateNewBadge(list.filter(function (e) { return e.status === "new"; }).length);
      renderEnquiries(view);
    }).catch(function (err) { clear(view).appendChild(h("p", { class: "form-error", text: err.message })); });
  }

  function renderEnquiries(view) {
    clear(view);
    var counts = { all: state.enquiries.length };
    STATUSES.forEach(function (s) { counts[s] = state.enquiries.filter(function (e) { return e.status === s; }).length; });

    var chips = h("div", { class: "chips", role: "group", "aria-label": "Filter by status" });
    ["all"].concat(STATUSES).forEach(function (s) {
      chips.appendChild(h("button", {
        class: "chip", type: "button", "aria-pressed": String(state.filter === s),
        onclick: function () { state.filter = s; renderEnquiries(view); }
      }, (s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)) + " (" + counts[s] + ")"));
    });
    var search = h("input", { type: "search", placeholder: "Search name, phone, city…", value: state.search, "aria-label": "Search enquiries" });
    search.addEventListener("input", function () { state.search = search.value; renderList(); });
    view.appendChild(h("div", { class: "toolbar" }, chips, search));

    var listEl = h("div", { class: "list" });
    view.appendChild(listEl);

    function renderList() {
      clear(listEl);
      var q = state.search.trim().toLowerCase();
      var items = state.enquiries.filter(function (e) {
        if (state.filter !== "all" && e.status !== state.filter) return false;
        if (!q) return true;
        return [e.name, e.phone, e.email, e.city, e.programme, e.message, e.notes].join(" ").toLowerCase().indexOf(q) > -1;
      });
      if (!items.length) {
        listEl.appendChild(h("p", { class: "empty", text: state.enquiries.length ? "No enquiries match." : "No enquiries yet. When someone fills in the enquiry form on the website it will appear here." }));
        return;
      }
      items.forEach(function (e) { listEl.appendChild(enquiryCard(e, view)); });
    }
    renderList();
  }

  function waNumber(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.length === 10 && /^[6-9]/.test(d) && String(phone).trim().charAt(0) !== "+") d = "91" + d; // Indian mobile without country code
    return d;
  }

  function enquiryCard(e, view) {
    var open = state.open === e.id;
    var card = h("article", { class: "enq" });
    var head = h("button", { class: "enq__head", type: "button", "aria-expanded": String(open),
      onclick: function () { state.open = open ? null : e.id; renderEnquiries(view); } },
      h("span", { class: "enq__name", text: e.name }),
      statusBadge(e.status),
      h("span", { class: "enq__meta" },
        h("span", { text: e.programme || "Programme not chosen" }),
        e.learner ? h("span", { text: e.learner }) : null,
        e.mode ? h("span", { text: e.mode }) : null,
        e.city ? h("span", { text: e.city }) : null,
        h("span", { text: fmtDate(e.createdAt), title: fullDate(e.createdAt) })));
    card.appendChild(head);
    if (!open) return card;

    var fields = [["Phone / WhatsApp", e.phone], ["Email", e.email], ["Who is learning", e.learner], ["Programme", e.programme],
      ["Mode", e.mode], ["City & country", e.city], ["Preferred time", e.time], ["Received", fullDate(e.createdAt)], ["Sent from page", e.page]];
    var dl = h("dl", { class: "enq__fields" });
    fields.forEach(function (f) { if (f[1]) dl.appendChild(h("div", null, h("dt", { text: f[0] }), h("dd", { text: f[1] }))); });

    var greeting = "Namaskar " + e.name + ", thank you for your enquiry with Alapadma Odissi Dance Academy.";
    var contact = h("div", { class: "btn-row" },
      e.phone ? h("a", { class: "btn btn--outline btn--sm", href: "tel:" + String(e.phone).replace(/[^\d+]/g, "") }, "Call") : null,
      e.phone ? h("a", { class: "btn btn--whatsapp btn--sm", href: "https://wa.me/" + waNumber(e.phone) + "?text=" + encodeURIComponent(greeting), target: "_blank", rel: "noopener" }, "WhatsApp") : null,
      e.email ? h("a", { class: "btn btn--outline btn--sm", href: "mailto:" + encodeURIComponent(e.email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent("Your Odissi class enquiry") + "&body=" + encodeURIComponent(greeting + "\n\n") }, "Email") : null);

    var statusSel = h("select", { "aria-label": "Status" });
    STATUSES.forEach(function (s) { statusSel.appendChild(h("option", { value: s, text: s.charAt(0).toUpperCase() + s.slice(1) })); });
    statusSel.value = e.status;
    statusSel.addEventListener("change", function () {
      api("/enquiries/" + e.id, { method: "PATCH", body: { status: statusSel.value } }).then(function (upd) {
        Object.assign(e, upd);
        toast("Status updated");
        renderEnquiries(view);
      }).catch(function (err) { toast(err.message, true); statusSel.value = e.status; });
    });

    var notes = h("textarea", { "aria-label": "Private notes", placeholder: "Private notes (only visible here): call outcome, trial date, batch…", value: e.notes || "" });
    var saveNotes = h("button", { class: "btn btn--primary btn--sm", type: "button", onclick: function () {
      saveNotes.disabled = true;
      api("/enquiries/" + e.id, { method: "PATCH", body: { notes: notes.value } }).then(function (upd) {
        Object.assign(e, upd);
        toast("Notes saved");
      }).catch(function (err) { toast(err.message, true); }).then(function () { saveNotes.disabled = false; });
    } }, "Save notes");

    var del = h("button", { class: "btn btn--danger btn--sm", type: "button", onclick: function () {
      if (!window.confirm("Delete the enquiry from " + e.name + "? This cannot be undone.")) return;
      api("/enquiries/" + e.id, { method: "DELETE" }).then(function () {
        state.enquiries = state.enquiries.filter(function (x) { return x.id !== e.id; });
        toast("Enquiry deleted");
        renderEnquiries(view);
      }).catch(function (err) { toast(err.message, true); });
    } }, "Delete");

    card.appendChild(h("div", { class: "enq__body" },
      dl,
      e.message ? h("p", { class: "enq__message", text: e.message }) : null,
      h("div", { class: "enq__manage" },
        h("label", { class: "field" }, h("span", { class: "field__label", text: "Status" }), statusSel),
        h("label", { class: "field" }, h("span", { class: "field__label", text: "Notes" }), notes)),
      h("div", { class: "btn-row btn-row--between" }, contact, h("div", { class: "btn-row" }, saveNotes, del))
    ));
    return card;
  }

  /* ==========================================================================
     Gallery
     ========================================================================== */
  // Resize in the browser and keep each photo under ~1.5 MB (the database limit is 2 MB per photo)
  function canvasBlob(c, quality) {
    return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", quality); });
  }
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error(file.name + ": please choose a JPG, PNG or WebP photo")); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var attempts = [[1800, 0.86], [1600, 0.8], [1400, 0.75], [1200, 0.7], [1000, 0.65]];
        (function next(i) {
          var max = attempts[i][0], quality = attempts[i][1];
          var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var hgt = Math.max(1, Math.round(img.naturalHeight * scale));
          var c = document.createElement("canvas");
          c.width = w; c.height = hgt;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, hgt);
          ctx.drawImage(img, 0, 0, w, hgt);
          canvasBlob(c, quality).then(function (blob) {
            if (!blob) { reject(new Error(file.name + ": could not process this image")); return; }
            if (blob.size <= 1.5 * 1024 * 1024 || i === attempts.length - 1) resolve({ blob: blob, width: w, height: hgt });
            else next(i + 1);
          });
        })(0);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(file.name + ": could not read this image")); };
      img.src = url;
    });
  }

  function uploadPhoto(img, alt) {
    var fd = new FormData();
    fd.append("image", img.blob, "photo.jpg");
    fd.append("width", String(img.width));
    fd.append("height", String(img.height));
    fd.append("alt", alt || "");
    fd.append("caption", "");
    return fetch(API + "/gallery", { method: "POST", body: fd, credentials: "same-origin" }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showLogin("Your session has ended. Please sign in again."); throw new Error("Please sign in"); }
        if (!res.ok) throw new Error(data.error || "Upload failed (" + res.status + ")");
        return data;
      });
    });
  }

  function viewGallery(view) {
    api("/gallery").then(function (items) { renderGallery(view, items); })
      .catch(function (err) { clear(view).appendChild(h("p", { class: "form-error", text: err.message })); });
  }

  function renderGallery(view, items, keepProgress) {
    clear(view);
    var input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, hidden: true });
    var progress = keepProgress || h("div", { class: "uploads", "aria-live": "polite" });
    var drop = h("div", { class: "dropzone", role: "button", tabindex: "0", "aria-label": "Upload photos" },
      h("strong", { text: "Add photos to the website gallery" }),
      h("span", { text: "Drag photos here, or click to choose. JPG, PNG or WebP. Large photos are resized automatically." }));
    drop.addEventListener("click", function () { input.click(); });
    drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) { upload(Array.prototype.slice.call(e.dataTransfer.files || [])); });
    input.addEventListener("change", function () { upload(Array.prototype.slice.call(input.files || [])); input.value = ""; });

    function upload(files) {
      if (!files.length) return;
      var chain = Promise.resolve();
      files.forEach(function (file) {
        var line = h("div", { text: "Preparing " + file.name + "…" });
        progress.appendChild(line);
        chain = chain.then(function () {
          return prepareImage(file).then(function (img) {
            line.textContent = "Uploading " + file.name + "…";
            var caption = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
            return uploadPhoto(img, caption ? "Odissi photograph: " + caption : "");
          }).then(function () {
            line.textContent = "✓ " + file.name + " added";
          }).catch(function (err) { line.textContent = "✗ " + err.message; line.style.color = "#8a1b2e"; });
        });
      });
      chain.then(function () {
        toast("Upload finished. Add captions below.");
        api("/gallery").then(function (fresh) { renderGallery(view, fresh, progress); });
      });
    }

    view.appendChild(h("section", { class: "panel" },
      h("h2", { class: "panel__title", text: "Upload" }),
      h("p", { class: "panel__sub", text: "New photos appear at the top of the Gallery page on the website, before the built-in photographs." }),
      drop, input));
    view.appendChild(progress);

    if (!items.length) {
      view.appendChild(h("p", { class: "empty", text: "No photos uploaded yet." }));
      return;
    }
    var grid = h("div", { class: "photos" });
    items.forEach(function (it, i) {
      var caption = h("input", { type: "text", value: it.caption || "", maxlength: "200", placeholder: "Caption shown on the website" });
      var alt = h("input", { type: "text", value: it.alt || "", maxlength: "200", placeholder: "Describe the photo (for screen readers)" });
      var save = h("button", { class: "btn btn--primary btn--sm", type: "button", onclick: function () {
        save.disabled = true;
        api("/gallery/" + it.id, { method: "PATCH", body: { caption: caption.value, alt: alt.value } })
          .then(function () { toast("Photo details saved"); })
          .catch(function (err) { toast(err.message, true); })
          .then(function () { save.disabled = false; });
      } }, "Save");
      function move(delta) {
        var ids = items.map(function (x) { return x.id; });
        var j = i + delta;
        if (j < 0 || j >= ids.length) return;
        ids.splice(j, 0, ids.splice(i, 1)[0]);
        api("/gallery/order", { method: "POST", body: { ids: ids } }).then(function (fresh) { renderGallery(view, fresh); })
          .catch(function (err) { toast(err.message, true); });
      }
      var del = h("button", { class: "btn btn--danger btn--sm", type: "button", onclick: function () {
        if (!window.confirm("Remove this photo from the website?")) return;
        api("/gallery/" + it.id, { method: "DELETE" }).then(function () {
          toast("Photo removed");
          viewGallery(view);
        }).catch(function (err) { toast(err.message, true); });
      } }, "Delete");
      grid.appendChild(h("div", { class: "photo" },
        h("img", { src: it.src, alt: "", loading: "lazy" }),
        h("label", { class: "field" }, h("span", { class: "field__label", text: "Caption" }), caption),
        h("label", { class: "field" }, h("span", { class: "field__label", text: "Description" }), alt),
        h("div", { class: "photo__actions" },
          save,
          h("button", { class: "btn btn--outline btn--sm", type: "button", disabled: i === 0, "aria-label": "Move earlier", onclick: function () { move(-1); } }, "←"),
          h("button", { class: "btn btn--outline btn--sm", type: "button", disabled: i === items.length - 1, "aria-label": "Move later", onclick: function () { move(1); } }, "→"),
          del)));
    });
    view.appendChild(h("section", { class: "panel" }, h("h2", { class: "panel__title", text: "Uploaded photos (" + items.length + ")" }), h("p", { class: "panel__sub", text: "Shown on the website in this order." }), grid));
  }

  /* ==========================================================================
     Settings
     ========================================================================== */
  function viewSettings(view) {
    api("/settings").then(function (s) { state.settings = s; renderSettings(view, s); })
      .catch(function (err) { clear(view).appendChild(h("p", { class: "form-error", text: err.message })); });
  }

  function input(name, value, props) {
    return h("input", Object.assign({ type: "text", name: name, value: value || "" }, props || {}));
  }
  function field(label, control, hint, full) {
    return h("label", { class: "field" + (full ? " full" : "") }, h("span", { class: "field__label", text: label }), control, hint ? h("span", { class: "field__hint", text: hint }) : null);
  }

  function renderSettings(view, s) {
    clear(view);
    var form = h("form", { novalidate: true });
    var f = {
      phone: input("phone", s.phone, { type: "tel", placeholder: "+91 98765 43210" }),
      whatsapp: input("whatsapp", s.whatsapp, { inputmode: "numeric", placeholder: "919876543210" }),
      email: input("email", s.email, { type: "email", placeholder: "info@alapadmaodissidance.com" }),
      address: input("address", s.address, { placeholder: "Studio address" }),
      mapQuery: input("mapQuery", s.mapQuery, { placeholder: "e.g. Alapadma Odissi Dance Academy, Bachupally, Hyderabad" }),
      mapLink: input("mapLink", s.mapLink, { type: "url", placeholder: "https://maps.app.goo.gl/… or https://share.google/…" }),
      hours: input("hours", s.hours, { placeholder: "Mon–Sat · 5:00–8:00 pm IST" }),
      youtubeChannel: input("youtubeChannel", s.youtubeChannel, { type: "url", placeholder: "https://www.youtube.com/@your-channel" }),
      instagram: input("instagram", s.instagram, { type: "url", placeholder: "https://www.instagram.com/…" }),
      facebook: input("facebook", s.facebook, { type: "url", placeholder: "https://www.facebook.com/…" }),
      web3formsKey: input("web3formsKey", s.web3formsKey, { placeholder: "Optional" }),
      annEnabled: h("input", { type: "checkbox", checked: s.announcement.enabled }),
      annText: input("annText", s.announcement.text, { maxlength: "200", placeholder: "e.g. Admissions open for the new batch starting 1 December" }),
      annLinkText: input("annLinkText", s.announcement.linkText, { maxlength: "40", placeholder: "Enquire now" }),
      annLinkUrl: input("annLinkUrl", s.announcement.linkUrl, { placeholder: "contact.html#enquire" })
    };

    /* videos editor */
    var videos = (s.youtubeVideos || []).map(function (v) { return { id: v.id || "", title: v.title || "" }; });
    var videosEl = h("div", { class: "videos" });
    function renderVideos() {
      clear(videosEl);
      if (!videos.length) videosEl.appendChild(h("p", { class: "field__hint", text: "No videos yet. The first video becomes the featured video on the home and gallery pages." }));
      videos.forEach(function (v, i) {
        var idIn = h("input", { type: "text", value: v.id, placeholder: "YouTube link or video ID", "aria-label": "Video " + (i + 1) + " link" });
        idIn.addEventListener("input", function () { v.id = idIn.value; });
        var tIn = h("input", { type: "text", value: v.title, maxlength: "120", placeholder: "Title (optional)", "aria-label": "Video " + (i + 1) + " title" });
        tIn.addEventListener("input", function () { v.title = tIn.value; });
        videosEl.appendChild(h("div", { class: "video-row" }, idIn, tIn,
          h("button", { class: "btn btn--danger btn--sm", type: "button", onclick: function () { videos.splice(i, 1); renderVideos(); } }, "Remove")));
      });
      videosEl.appendChild(h("div", null, h("button", { class: "btn btn--outline btn--sm", type: "button", onclick: function () { videos.push({ id: "", title: "" }); renderVideos(); } }, "+ Add a video")));
    }
    renderVideos();

    /* announcement preview */
    var preview = h("div", { class: "preview-announce" });
    function renderPreview() {
      clear(preview);
      preview.appendChild(document.createTextNode(f.annText.value || "Your announcement text"));
      if (f.annLinkUrl.value) preview.appendChild(h("a", { href: "#", onclick: function (e) { e.preventDefault(); }, text: f.annLinkText.value || "Learn more" }));
      preview.style.opacity = f.annEnabled.checked ? "1" : "0.45";
    }
    [f.annText, f.annLinkText, f.annLinkUrl, f.annEnabled].forEach(function (el) { el.addEventListener("input", renderPreview); el.addEventListener("change", renderPreview); });
    renderPreview();

    var errBox = h("p", { class: "form-error", role: "alert", hidden: true });

    form.appendChild(h("div", { class: "view" },
      h("section", { class: "panel" },
        h("h2", { class: "panel__title", text: "Contact details" }),
        h("p", { class: "panel__sub", text: "Shown in the header, footer, contact page and WhatsApp buttons. Leave a field empty to hide it." }),
        h("div", { class: "form-grid" },
          field("Phone", f.phone, "Shown as written."),
          field("WhatsApp number", f.whatsapp, "Digits only, with country code (91 for India). Turns on WhatsApp buttons and WhatsApp enquiries."),
          field("Email", f.email, "Where visitors can write to you."),
          field("Class timings", f.hours, "Shown on the contact page."),
          field("Studio address", f.address, "Shown in the footer, home page and contact page.", true))),
      h("section", { class: "panel" },
        h("h2", { class: "panel__title", text: "Map" }),
        h("p", { class: "panel__sub", text: "The Google Map on the contact page, and the “Get directions” and “Open in Google Maps” buttons." }),
        h("div", { class: "form-grid" },
          field("Place shown on the map", f.mapQuery, "What Google Maps should search for: your Google business name and area works best.", true),
          field("Google Maps link", f.mapLink, "From Google Maps: Share → Copy link.", true),
          h("div", { class: "full" }, h("a", { class: "btn btn--outline btn--sm", href: "#", onclick: function (e) {
            e.preventDefault();
            var q = f.mapQuery.value || f.address.value;
            if (q) window.open("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q), "_blank", "noopener");
          } }, "Check the place on Google Maps ↗")))),
      h("section", { class: "panel" },
        h("h2", { class: "panel__title", text: "Announcement bar" }),
        h("p", { class: "panel__sub", text: "A slim banner across the top of every page: new batches, workshops, performances, holidays." }),
        h("div", { class: "form-grid" },
          h("label", { class: "switch full" }, f.annEnabled, "Show the announcement on the website"),
          field("Announcement text", f.annText, null, true),
          field("Link text", f.annLinkText),
          field("Link", f.annLinkUrl, "A page such as contact.html#enquire or classes.html, or a full https:// address."),
          h("div", { class: "full" }, h("span", { class: "field__label", text: "Preview" }), preview))),
      h("section", { class: "panel" },
        h("h2", { class: "panel__title", text: "YouTube & social media" }),
        h("p", { class: "panel__sub", text: "The latest videos and Shorts from your channel appear on the website automatically (checked every hour). Featured videos below are shown first, the first one as the big video on the home and gallery pages." }),
        h("div", { class: "form-grid" },
          field("YouTube channel", f.youtubeChannel, null, true),
          h("div", { class: "field full" }, h("span", { class: "field__label", text: "Featured videos" }), videosEl),
          field("Instagram", f.instagram),
          field("Facebook", f.facebook))),
      h("section", { class: "panel" },
        h("h2", { class: "panel__title", text: "Email alerts for new enquiries" }),
        h("p", { class: "panel__sub", text: "Enquiries are always saved in this admin panel. To also receive each one by email, create a free access key at web3forms.com and paste it here." }),
        h("div", { class: "form-grid" }, field("Web3Forms access key", f.web3formsKey, null, true))),
      errBox,
      h("div", { class: "savebar" }, h("button", { class: "btn btn--primary", type: "submit" }, "Save changes"))
    ));

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.hidden = true;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      var body = {
        phone: f.phone.value, whatsapp: f.whatsapp.value, email: f.email.value, address: f.address.value, hours: f.hours.value,
        youtubeChannel: f.youtubeChannel.value, instagram: f.instagram.value, facebook: f.facebook.value, web3formsKey: f.web3formsKey.value,
        youtubeVideos: videos.filter(function (v) { return v.id.trim(); }),
        announcement: { enabled: f.annEnabled.checked, text: f.annText.value, linkText: f.annLinkText.value, linkUrl: f.annLinkUrl.value }
      };
      api("/settings", { method: "PUT", body: body }).then(function (saved) {
        state.settings = saved;
        if (saved.warning) toast(saved.warning, true); else toast("Saved. The website is updated.");
        renderSettings(view, saved);
      }).catch(function (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        errBox.scrollIntoView({ block: "center", behavior: "smooth" });
      }).then(function () { btn.disabled = false; });
    });
    view.appendChild(form);
  }

  /* ==========================================================================
     Account
     ========================================================================== */
  function viewAccount(view) {
    clear(view);
    var cur = h("input", { type: "password", autocomplete: "current-password", required: true });
    var next = h("input", { type: "password", autocomplete: "new-password", minlength: "10", required: true });
    var again = h("input", { type: "password", autocomplete: "new-password", required: true });
    var err = h("p", { class: "form-error", role: "alert", hidden: true });
    var form = h("form", { class: "panel", novalidate: true },
      h("h2", { class: "panel__title", text: "Change password" }),
      h("p", { class: "panel__sub", text: "At least 10 characters. Changing it signs out every other device." }),
      h("div", { class: "form-grid" },
        field("Current password", cur, null, true),
        field("New password", next),
        field("Repeat new password", again)),
      h("div", { class: "view mt-1" }, err, h("div", { class: "btn-row" }, h("button", { class: "btn btn--primary", type: "submit" }, "Change password"))));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true;
      if (next.value.length < 10) { err.textContent = "The new password must be at least 10 characters."; err.hidden = false; return; }
      if (next.value !== again.value) { err.textContent = "The new passwords do not match."; err.hidden = false; return; }
      api("/password", { method: "POST", body: { current: cur.value, next: next.value } }).then(function () {
        cur.value = next.value = again.value = "";
        toast("Password changed");
      }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; });
    });
    view.appendChild(form);
    view.appendChild(h("section", { class: "panel" },
      h("h2", { class: "panel__title", text: "Session" }),
      h("p", { class: "panel__sub", text: "You are signed out automatically after 2 hours without activity." }),
      h("div", { class: "btn-row" },
        h("a", { class: "btn btn--outline", href: "/", target: "_blank", rel: "noopener" }, "View website ↗"),
        h("button", { class: "btn btn--danger", type: "button", onclick: logout }, "Sign out"))));
  }

  /* ---------- start ---------- */
  api("/session").then(function (s) { if (s.authenticated) showApp(); else showLogin(); })
    .catch(function () { showLogin("Could not reach the server."); });
})();
