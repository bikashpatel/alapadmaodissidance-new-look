/* The Guru page: the milestones line runs exactly from the first node to the
   last one, and (unless reduced motion is preferred) fills in as the visitor
   scrolls, lighting each node as it is reached. Without JS the whole story is
   shown lit, with softly faded line ends. */
(function () {
  "use strict";

  var story = document.querySelector("[data-story]");
  if (!story) return;

  var items = Array.prototype.slice.call(story.querySelectorAll(".story__item"));
  var nodes = items.map(function (item) { return item.querySelector(".story__node"); });
  if (!nodes.length || nodes.indexOf(null) > -1) return;

  var animate = "requestAnimationFrame" in window &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var lineTop = 0, lineHeight = 0, ticking = false;

  /* layout position of a node's centre inside the story (ignores reveal transforms) */
  function centre(i) {
    return items[i].offsetTop + nodes[i].offsetTop + nodes[i].offsetHeight / 2;
  }

  function measure() {
    var first = centre(0);
    var last = centre(nodes.length - 1);
    lineTop = first;
    lineHeight = Math.max(0, last - first);
    story.style.setProperty("--line-top", first + "px");
    story.style.setProperty("--line-bottom", Math.max(0, story.offsetHeight - last) + "px");
    story.classList.add("has-ends");
  }

  function paint() {
    ticking = false;
    var anchor = window.innerHeight * 0.62;
    var top = story.getBoundingClientRect().top + lineTop;
    var progress = lineHeight > 0 ? (anchor - top) / lineHeight : 1;
    story.style.setProperty("--progress", Math.max(0, Math.min(1, progress)).toFixed(4));
    items.forEach(function (item, i) {
      item.classList.toggle("is-lit", top + (centre(i) - lineTop) <= anchor);
    });
  }

  function request() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(paint); }
  }

  measure();
  if (animate) {
    story.classList.add("story--live");
    paint();
    window.addEventListener("scroll", request, { passive: true });
  }
  window.addEventListener("resize", function () {
    measure();
    if (animate) request();
  });
  /* fonts and lazy images can shift the layout after load */
  window.addEventListener("load", function () { measure(); if (animate) request(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measure(); if (animate) request(); });
  }
})();
