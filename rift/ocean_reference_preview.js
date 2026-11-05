// Reference-guided animated breaking-wave loop for Rift Islands.
// A 4-second, 24 FPS shorebreak video ships as a real MP4 in ./media/.
// The previous tiny embedded preview remains available as an offline fallback.
// The playable FFT ocean remains the physically navigable water simulation.
let overlay = null;
let video = null;
let videoBlobUrl = null;

async function loadLoopUrl() {
  // Prefer the smoother 24 FPS crashing-surf asset. A real file lets mobile
  // browsers stream/decode efficiently instead of constructing a base64 Blob.
  const hdUrl = new URL("./media/rift_breaking_waves_loop.mp4", import.meta.url).href;
  try {
    const response = await fetch(hdUrl, { method: "HEAD", cache: "no-store" });
    if (response.ok && (response.headers.get("content-type") || "").includes("video")) {
      return hdUrl;
    }
  } catch (_) {}

  if (videoBlobUrl) return videoBlobUrl;
  const { oceanReferenceLoopDataUrl } = await import("./ocean_reference_loop_data.js");
  const encoded = oceanReferenceLoopDataUrl.slice(oceanReferenceLoopDataUrl.indexOf(",") + 1);
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  videoBlobUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
  return videoBlobUrl;
}

export async function openOceanReferencePreview(viewport) {
  if (!viewport) return;
  if (!overlay?.isConnected) {
    overlay = document.createElement("div");
    overlay.id = "rift-ocean-reference-preview";
    overlay.style.cssText = [
      "position:absolute", "inset:0", "z-index:999996", "display:flex",
      "align-items:center", "justify-content:center", "padding:16px",
      "background:rgba(2,10,20,.9)", "box-sizing:border-box",
      "touch-action:manipulation",
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = "width:min(92vw,600px);max-height:94%;overflow:auto;background:#092338;color:#e8f8ff;border:1px solid #4fc8d6;border-radius:16px;box-shadow:0 25px 70px rgba(0,0,0,.65);padding:14px;box-sizing:border-box;font:13px/1.5 system-ui,sans-serif;";

    const top = document.createElement("div");
    top.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;";
    const title = document.createElement("strong");
    title.textContent = "BREAKING WAVES · 24 FPS";
    title.style.cssText = "letter-spacing:.1em;color:#a4f4e9;font-size:12px;";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "CLOSE ×";
    close.style.cssText = "background:#16455a;color:#fff;border:1px solid #6ad6df;border-radius:9px;padding:8px 12px;font:12px system-ui;cursor:pointer;";
    top.append(title, close);

    video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.controls = true;
    video.style.cssText = "display:block;width:100%;height:auto;max-height:65vh;border-radius:10px;background:#0d4563;object-fit:contain;";

    const note = document.createElement("p");
    note.style.cssText = "margin:9px 0 0;color:#b9dce5;font-size:12px;";
    note.textContent = "Smooth four-second looping shorebreak video. The playable world uses the real-time 3D FFT ocean and procedural breakers, so swimming, reflections and underwater views remain interactive.";

    function hide() {
      video.pause();
      overlay.style.display = "none";
    }
    close.addEventListener("click", hide);
    overlay.addEventListener("click", e => { if (e.target === overlay) hide(); });
    panel.append(top, video, note);
    overlay.append(panel);
    viewport.append(overlay);
  }

  overlay.style.display = "flex";
  if (!video.src) {
    try {
      video.src = await loadLoopUrl();
    } catch (e) {
      console.error("[rift-ocean-reference] Failed to load cinematic video", e);
      return;
    }
  }
  try {
    await video.play();
  } catch (e) {
    // iOS can require an additional tap; native controls remain visible.
    console.info("[rift-ocean-reference] Tap play in the video controls", e);
  }
}
