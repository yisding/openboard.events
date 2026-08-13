/* Openboard embed loader: replaces its own <script> tag with an auto-resizing
   iframe. Usage:
   <script src="https://<host>/embed.js" data-event="<slug>" data-type="sessions|agenda|itinerary|speakers|gallery" async></script> */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var eventSlug = script.getAttribute("data-event");
  var type = script.getAttribute("data-type") || "sessions";
  // Retain optional params for backwards compatibility with hand-authored
  // snippets. Canonical admin-generated snippets do not need them because
  // appearance and content settings come from the saved embed config.
  var params = script.getAttribute("data-params") || "";
  if (!eventSlug) return;
  var iframe = document.createElement("iframe");
  iframe.src = origin + "/embed/" + encodeURIComponent(eventSlug) + "/" + encodeURIComponent(type) + (params ? "?" + params : "");
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.height = "760px";
  iframe.loading = "lazy";
  iframe.title = "Openboard " + type + " embed";
  script.parentNode.insertBefore(iframe, script);
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (data && data.type === "openboard:embed-height" && typeof data.height === "number") {
      iframe.style.height = Math.max(200, Math.min(data.height, 6000)) + "px";
    }
  });
})();
