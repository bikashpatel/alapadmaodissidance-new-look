/* Journey page: map tabs, interactive pins, timeline year grouping */
(function () {
  "use strict";

  var doc = document;
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  /* ---------- map tabs (World / India) ---------- */
  var tabList = doc.querySelector("[data-map-tabs]");
  if (tabList) {
    var tabs = $$('[role="tab"]', tabList);
    var section = tabList.closest("section");
    var select = function (tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = doc.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabList.hidden = false;
    if (section) section.classList.add("has-tabs");
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === "Home") next = tabs[0];
        if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    select(tabs[0]);
  }

  /* ---------- interactive maps ---------- */
  function cityKeys(el) { return (el.getAttribute("data-city") || "").split(/\s+/).filter(Boolean); }

  function wire(panel, figure, svg) {
    var canvas = figure.querySelector(".jr-map__canvas");
    var pins = $$(".wm-pin, .im-pin", svg);
    var marks = $$("[data-city]", svg);
    var buttons = $$(".jr-place", panel);
    var tip = doc.createElement("div");
    tip.className = "jr-tip";
    tip.setAttribute("aria-hidden", "true");
    canvas.appendChild(tip);
    var sticky = null;

    // move each pin's <title> into data so it can drive our tooltip (avoids a double native tooltip)
    pins.forEach(function (pin) {
      var t = pin.querySelector("title");
      if (t) { pin.setAttribute("data-tip", t.textContent.trim()); t.remove(); }
    });

    // after a pointer leaves: return to the pinned place, else the keyboard-focused place, else nothing
    function rest() {
      var focused = buttons.indexOf(doc.activeElement) > -1 ? doc.activeElement : null;
      if (sticky) activate(sticky);
      else if (focused) activate(cityKeys(focused));
      else clear();
    }

    function clear() {
      figure.classList.remove("has-active");
      marks.forEach(function (m) { m.classList.remove("is-active"); });
      buttons.forEach(function (b) { b.classList.remove("is-active"); b.setAttribute("aria-pressed", "false"); });
      tip.classList.remove("is-shown");
    }

    function activate(keys, anchorPin) {
      clear();
      if (!keys.length) return;
      figure.classList.add("has-active");
      var first = null;
      marks.forEach(function (m) {
        if (keys.indexOf(m.getAttribute("data-city")) > -1) {
          m.classList.add("is-active");
          // prefer the magnified lens pin when one exists, otherwise the first pin
          if (m.matches(".wm-pin, .im-pin") && (!first || m.matches(".im-pin--lens"))) first = m;
        }
      });
      buttons.forEach(function (b) {
        var on = cityKeys(b).some(function (k) { return keys.indexOf(k) > -1; });
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      var pin = anchorPin || first;
      if (pin && pin.getAttribute("data-tip")) {
        var c = canvas.getBoundingClientRect();
        var p = pin.getBoundingClientRect();
        tip.textContent = pin.getAttribute("data-tip");
        tip.style.left = (p.left + p.width / 2 - c.left) + "px";
        tip.style.top = (p.top - c.top) + "px";
        tip.classList.add("is-shown");
      }
    }

    pins.forEach(function (pin) {
      pin.addEventListener("mouseenter", function () { activate([pin.getAttribute("data-city")], pin); });
      pin.addEventListener("mouseleave", rest);
      pin.addEventListener("click", function () {
        var key = [pin.getAttribute("data-city")];
        sticky = sticky && sticky[0] === key[0] ? null : key;
        if (sticky) activate(sticky, pin); else clear();
      });
    });

    buttons.forEach(function (btn) {
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("mouseenter", function () { activate(cityKeys(btn)); });
      btn.addEventListener("mouseleave", rest);
      btn.addEventListener("focus", function () { activate(cityKeys(btn)); });
      btn.addEventListener("blur", function () { if (sticky) activate(sticky); else clear(); });
      btn.addEventListener("click", function () {
        var keys = cityKeys(btn);
        sticky = sticky && sticky.join() === keys.join() ? null : keys;
        if (sticky) activate(sticky); else clear();
      });
    });

    window.addEventListener("resize", rest);
  }

  $$("img[data-inline-map]").forEach(function (img) {
    var panel = img.closest(".jr-panel");
    var figure = img.closest(".jr-map");
    if (!panel || !figure || !window.fetch || !window.DOMParser) return;
    fetch(img.getAttribute("src"))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (text) {
        var parsed = new DOMParser().parseFromString(text, "image/svg+xml");
        var svg = parsed.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== "svg") return;
        svg = doc.importNode(svg, true);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.removeAttribute("aria-labelledby");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", img.getAttribute("alt") || "");
        svg.setAttribute("focusable", "false");
        img.replaceWith(svg);
        wire(panel, figure, svg);
      })
      .catch(function () { /* keep the static <img> map */ });
  });

  /* ---------- timeline: hide years with no matching events, announce results ---------- */
  var timeline = doc.getElementById("timeline");
  var status = doc.querySelector("[data-filter-status]");
  if (timeline) {
    timeline.addEventListener("filterchange", function (e) {
      var shown = 0;
      $$(".jr-year", timeline).forEach(function (year) {
        var visible = $$(".jr-event", year).filter(function (ev) { return !ev.classList.contains("is-hidden"); }).length;
        shown += visible;
        year.classList.toggle("is-hidden", visible === 0);
        if (visible) year.classList.add("is-visible");
      });
      if (status) {
        var label = { all: "all regions", india: "India", intl: "international stages" }[e.detail && e.detail.filter] || "the selected filter";
        status.textContent = "Showing " + shown + (shown === 1 ? " performance" : " performances") + " for " + label + ".";
      }
    });
  }
})();
