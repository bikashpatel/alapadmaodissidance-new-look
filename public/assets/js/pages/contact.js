/* Alapadma Odissi Dance Academy — contact page helpers
   (main.js handles the enquiry form itself; this only adds small conveniences) */
(function () {
  "use strict";

  var SITE = window.SITE || {};
  var doc = document;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var form = doc.getElementById("enquiry-form");
  var section = doc.getElementById("enquire");
  if (!form) return;

  var programme = form.querySelector('select[name="programme"]');
  var modes = Array.prototype.slice.call(form.querySelectorAll('input[name="mode"]'));

  function pickMode(value) {
    modes.forEach(function (r) { if (r.value === value) r.checked = true; });
  }

  function selectedKey() {
    var opt = programme && programme.options[programme.selectedIndex];
    return opt ? opt.getAttribute("data-key") : "";
  }

  // choosing "Online Classes" also selects the Online mode
  function syncMode() {
    if (selectedKey() === "online") pickMode("Online");
  }
  if (programme) {
    programme.addEventListener("change", syncMode);
    syncMode();
  }

  // scroll the field that was just filled in into view (the section top would leave it below the fold),
  // move keyboard focus to it, and flash it
  function goToForm(highlight, focusEl) {
    var target = highlight || section;
    if (target) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: highlight ? "center" : "start" });
    if (history.replaceState) history.replaceState(null, "", "#enquire");
    if (focusEl) {
      try { focusEl.focus({ preventScroll: true }); } catch (err) { focusEl.focus(); }
    }
    if (highlight) {
      highlight.classList.add("is-picked");
      window.setTimeout(function () { highlight.classList.remove("is-picked"); }, 2200);
    }
  }

  // in-page shortcuts: preselect a programme or mode without reloading the page
  Array.prototype.slice.call(doc.querySelectorAll("[data-pick-programme]")).forEach(function (link) {
    link.addEventListener("click", function (e) {
      var key = link.getAttribute("data-pick-programme");
      var opt = programme && programme.querySelector('option[data-key="' + key + '"]');
      if (!opt) return;
      e.preventDefault();
      programme.value = opt.value;
      syncMode();
      goToForm(programme.closest(".field"), programme);
    });
  });
  Array.prototype.slice.call(doc.querySelectorAll("[data-pick-mode]")).forEach(function (link) {
    link.addEventListener("click", function (e) {
      var value = link.getAttribute("data-pick-mode");
      e.preventDefault();
      pickMode(value);
      // "Online Classes" contradicts a studio enquiry, so clear it and let the learner choose again
      if (value !== "Online" && selectedKey() === "online") programme.value = "";
      var checked = form.querySelector('input[name="mode"]:checked');
      goToForm(checked ? checked.closest(".field") : null, checked);
    });
  });

  // directions link for the studio card (shown only when an address is configured)
  var directions = doc.querySelector("[data-directions]");
  if (directions && SITE.address) {
    directions.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(SITE.address);
    directions.target = "_blank";
    directions.rel = "noopener";
  }

  // after a successful submit, make sure the status message is in view (helps on phones)
  form.addEventListener("submit", function () {
    if (!form.checkValidity()) return;
    window.setTimeout(function () {
      var box = form.querySelector(".form__status");
      if (!box || !box.offsetParent) return;
      var r = box.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      }
    }, 80);
  });
})();
