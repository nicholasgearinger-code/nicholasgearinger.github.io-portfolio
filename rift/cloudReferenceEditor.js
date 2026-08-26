import { REFERENCE_CLOUD_ARCHETYPES } from "./cloudArchetypes_reference_v3.js";

const canvas = document.querySelector("#preview");
const ctx = canvas.getContext("2d");
const archetypeSelect = document.querySelector("#archetype");
const lobeSelect = document.querySelector("#lobe");
const fields = document.querySelector("#fields");
const refInput = document.querySelector("#reference");
const refOpacity = document.querySelector("#referenceOpacity");
const thresholdInput = document.querySelector("#threshold");
const exportBox = document.querySelector("#export");

const originals = structuredClone(REFERENCE_CLOUD_ARCHETYPES);
let working = structuredClone(REFERENCE_CLOUD_ARCHETYPES);
let referenceImage = null;
const editable = ["x", "y", "z", "rx", "ry", "rz", "density", "power"];

for (const key of Object.keys(working)) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key;
  archetypeSelect.append(option);
}

for (const key of editable) {
  const wrap = document.createElement("label");
  wrap.textContent = key;
  const input = document.createElement("input");
  input.type = "number";
  input.step = key === "density" || key === "power" ? "0.01" : "0.005";
  input.dataset.key = key;
  input.addEventListener("input", () => {
    const lobe = currentLobe();
    if (!lobe) return;
    lobe[key] = Number(input.value);
    updateExport();
    draw();
  });
  wrap.append(input);
  fields.append(wrap);
}

function currentArchetype() {
  return working[archetypeSelect.value];
}

function currentLobe() {
  return currentArchetype()?.lobes?.[Number(lobeSelect.value)];
}

function rebuildLobes() {
  lobeSelect.innerHTML = "";
  currentArchetype().lobes.forEach((_, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `lobe ${i}`;
    lobeSelect.append(o);
  });
  lobeSelect.value = "0";
  syncFields();
}

function syncFields() {
  const lobe = currentLobe();
  for (const input of fields.querySelectorAll("input")) {
    input.value = lobe?.[input.dataset.key] ?? 0;
  }
  updateExport();
  draw();
}

function updateExport() {
  exportBox.value = JSON.stringify(currentArchetype(), null, 2);
}

function densityAt(archetype, x, y) {
  let d = 0;
  for (const l of archetype.lobes) {
    const dx = (x - l.x) / Math.max(1e-5, l.rx);
    const dy = (y - l.y) / Math.max(1e-5, l.ry);
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) continue;
    const c = Math.pow(1 - d2, l.power ?? 1.65) * (l.density ?? 1);
    const clamped = Math.max(0, Math.min(1, c));
    d = 1 - (1 - d) * (1 - clamped);
  }
  const floor = archetype.baseFloor ?? 0.04;
  const soft = archetype.baseSoftness ?? 0.04;
  const t = Math.max(0, Math.min(1, (y - floor) / soft));
  return d * t * t * (3 - 2 * t);
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#315c91");
  grad.addColorStop(1, "#9ac8e5");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (referenceImage) {
    ctx.globalAlpha = Number(refOpacity.value);
    const scale = Math.max(w / referenceImage.width, h / referenceImage.height);
    const dw = referenceImage.width * scale;
    const dh = referenceImage.height * scale;
    ctx.drawImage(referenceImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  }

  const archetype = currentArchetype();
  const threshold = Number(thresholdInput.value);
  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    const y = 1 - py / (h - 1);
    for (let px = 0; px < w; px++) {
      const x = px / (w - 1);
      const d = densityAt(archetype, x, y);
      if (d < threshold) continue;
      const a = Math.max(0, Math.min(1, (d - threshold) / (1 - threshold)));
      const i = (px + py * w) * 4;
      const shade = Math.round(175 + 80 * a);
      img.data[i] = shade;
      img.data[i + 1] = Math.min(255, shade + Math.round(8 * a));
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(205 * a);
    }
  }
  ctx.putImageData(img, 0, 0);

  const selected = currentLobe();
  if (selected) {
    ctx.strokeStyle = "#67ffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      selected.x * w,
      (1 - selected.y) * h,
      selected.rx * w,
      selected.ry * h,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
}

archetypeSelect.addEventListener("change", rebuildLobes);
lobeSelect.addEventListener("change", syncFields);
refOpacity.addEventListener("input", draw);
thresholdInput.addEventListener("input", draw);
refInput.addEventListener("change", () => {
  const file = refInput.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    referenceImage = img;
    draw();
  };
  img.src = URL.createObjectURL(file);
});

document.querySelector("#add").addEventListener("click", () => {
  currentArchetype().lobes.push({
    x: 0.5,
    y: 0.25,
    z: 0.5,
    rx: 0.08,
    ry: 0.08,
    rz: 0.08,
    density: 0.8,
    power: 1.65,
  });
  rebuildLobes();
  lobeSelect.value = String(currentArchetype().lobes.length - 1);
  syncFields();
});

document.querySelector("#remove").addEventListener("click", () => {
  const a = currentArchetype();
  if (a.lobes.length <= 1) return;
  a.lobes.splice(Number(lobeSelect.value), 1);
  rebuildLobes();
});

document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(exportBox.value);
});

document.querySelector("#reset").addEventListener("click", () => {
  working[archetypeSelect.value] = structuredClone(originals[archetypeSelect.value]);
  rebuildLobes();
});

archetypeSelect.value = Object.keys(working)[0];
rebuildLobes();
