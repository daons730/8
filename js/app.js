const { GIFEncoder, quantize, applyPalette } = window;

const FPS = 30;
const MAX_SECONDS = 10;
const MAX_EDGE = 400;
const PALETTE_SIZE = 96;

const PENS = {
  pencil: { alpha: 0.92, cap: "round", blur: 0, composite: "source-over", size: 3 },
  marker: { alpha: 1, cap: "round", blur: 0, composite: "source-over", size: 10 },
  brush: { alpha: 0.82, cap: "round", blur: 3, composite: "source-over", size: 16 },
  highlighter: { alpha: 0.38, cap: "square", blur: 0, composite: "source-over", size: 24 },
  eraser: { alpha: 1, cap: "round", blur: 0, composite: "destination-out", size: 18 },
};

const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

const dropzone = document.getElementById("dropzone");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const imageZone = document.getElementById("imageZone");
const imageAttachBtn = document.getElementById("imageAttachBtn");
const imageFilesInput = document.getElementById("imageFilesInput");
const imageHint = document.getElementById("imageHint");
const editorKicker = document.getElementById("editorKicker");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const durationCard = document.getElementById("durationCard");
const speedCard = document.getElementById("speedCard");
const durationInput = document.getElementById("durationInput");
const durationLabel = document.getElementById("durationLabel");
const applyDurationBtn = document.getElementById("applyDurationBtn");
const formatList = document.getElementById("formatList");
const homeShell = document.getElementById("homeShell");
const home = document.getElementById("home");
const archive = document.getElementById("archive");
const archiveGrid = document.getElementById("archiveGrid");
const archiveEmpty = document.getElementById("archiveEmpty");
const makeTab = document.getElementById("makeTab");
const archiveTab = document.getElementById("archiveTab");
const homeTitle = document.getElementById("homeTitle");
const editor = document.getElementById("editor");
const backBtn = document.getElementById("backBtn");
const sourceName = document.getElementById("sourceName");
const targetName = document.getElementById("targetName");
const statusEl = document.getElementById("status");
const bar = document.getElementById("bar");
const barFill = document.getElementById("barFill");
const percentEl = document.getElementById("percent");
const downloadBtn = document.getElementById("downloadBtn");
const thumbs = document.getElementById("thumbs");
const stage = document.getElementById("stage");
const stageCtx = stage.getContext("2d", { willReadFrequently: true });
const stageEmpty = document.getElementById("stageEmpty");
const frameLabel = document.getElementById("frameLabel");
const deleteFrameBtn = document.getElementById("deleteFrameBtn");
const photoBox = document.getElementById("photoBox");
const previewCanvas = document.getElementById("previewCanvas");
const previewCtx = previewCanvas.getContext("2d");
const speedInput = document.getElementById("speedInput");
const speedLabel = document.getElementById("speedLabel");
const sizeInput = document.getElementById("sizeInput");
const sizeLabel = document.getElementById("sizeLabel");
const colorInput = document.getElementById("colorInput");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const pickedName = document.getElementById("pickedName");
const insertNextBtn = document.getElementById("insertNextBtn");
const overlayBtn = document.getElementById("overlayBtn");
const video = document.getElementById("decoder");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });
const thumbCanvas = document.createElement("canvas");
const thumbCtx = thumbCanvas.getContext("2d");

const probe = document.createElement("video");
function canPlay(item) {
  const mime = item.dataset.codec
    ? `${item.dataset.mime}; codecs="${item.dataset.codec}"`
    : item.dataset.mime;
  return probe.canPlayType(mime) !== "";
}

const supportedItems = [...formatList.querySelectorAll("li")].filter(canPlay);
if (supportedItems.length === 0) {
  formatList.replaceChildren();
  const note = document.createElement("p");
  note.className = "drop-help";
  note.textContent = "이 브라우저에서는 변환 가능한 동영상 형식을 찾지 못했습니다.";
  formatList.replaceWith(note);
} else {
  for (const item of [...formatList.children]) {
    if (!supportedItems.includes(item)) item.remove();
  }
}

const supportedExts = new Set(supportedItems.flatMap((item) => item.dataset.exts.split(",")));
fileInput.accept = supportedItems.map((item) => item.dataset.accept).join(",");

let jobId = 0;
let gifName = "";
let videoUrl = null;
let dragDepth = 0;
let imageDragDepth = 0;
let frames = [];
let baseFrames = [];
let inkFrames = [];
let photoLayers = [];
let frameDelays = [];
let archiveSaved = true;
let currentArchiveId = null;
let leavingHome = false;
let archivePreviewUrls = [];
let undoStack = [];
let redoStack = [];
let selected = -1;
let editorReady = false;
let editMode = "video";
let speed = 1;
let pen = "pencil";
let color = "#111827";
let lineSize = 3;
let pendingImage = null;
let drawing = false;
let lastPoint = null;
let previewTimer = 0;
let previewIndex = 0;
let encoding = false;

attachBtn.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (event) => {
  if (event.target.closest("button, a, input")) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  if (file) startConversion(file);
});

imageAttachBtn.addEventListener("click", () => imageFilesInput.click());
imageZone.addEventListener("click", (event) => {
  if (event.target.closest("button, a, input")) return;
  imageFilesInput.click();
});
imageFilesInput.addEventListener("change", () => {
  const files = imageFilesInput.files ? [...imageFilesInput.files] : [];
  imageFilesInput.value = "";
  if (files.length) startFromImages(files);
});

dropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropzone.classList.add("is-over");
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
dropzone.addEventListener("dragleave", () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dropzone.classList.remove("is-over");
  }
});
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove("is-over");
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) startConversion(file);
});

imageZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  imageDragDepth += 1;
  imageZone.classList.add("is-over");
});
imageZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
imageZone.addEventListener("dragleave", () => {
  imageDragDepth -= 1;
  if (imageDragDepth <= 0) {
    imageDragDepth = 0;
    imageZone.classList.remove("is-over");
  }
});
imageZone.addEventListener("drop", (event) => {
  event.preventDefault();
  imageDragDepth = 0;
  imageZone.classList.remove("is-over");
  const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
  if (files.length) startFromImages(files);
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

backBtn.addEventListener("click", showHome);
downloadBtn.addEventListener("click", () => {
  if (downloadBtn.disabled || encoding) return;
  saveGif();
});

document.querySelectorAll(".pen-btn").forEach((button) => {
  button.addEventListener("click", () => {
    pen = button.dataset.pen;
    document.querySelectorAll(".pen-btn").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    const preset = PENS[pen];
    lineSize = preset.size;
    sizeInput.value = String(lineSize);
    sizeLabel.textContent = `굵기 ${lineSize}`;
    stage.classList.toggle("is-eraser", pen === "eraser");
  });
});

document.querySelectorAll(".swatch").forEach((button) => {
  button.addEventListener("click", () => {
    color = button.dataset.color;
    colorInput.value = toColorInput(color);
    document.querySelectorAll(".swatch").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
  });
});

colorInput.addEventListener("input", () => {
  color = colorInput.value;
  document.querySelectorAll(".swatch").forEach((item) => item.classList.remove("is-active"));
});

sizeInput.addEventListener("input", () => {
  lineSize = Number(sizeInput.value);
  sizeLabel.textContent = `굵기 ${lineSize}`;
});

speedInput.addEventListener("input", () => {
  speed = positionToSpeed(speedInput.value);
  updateSpeedLabel();
  if (editorReady) markDirty();
  restartPreview();
});

durationInput.addEventListener("input", () => {
  if (editMode !== "image" || selected < 0) return;
  frameDelays[selected] = positionToDuration(durationInput.value);
  updateDurationLabel();
  markDirty();
  restartPreview();
});
applyDurationBtn.addEventListener("click", () => {
  if (editMode !== "image" || !editorReady) return;
  const delay = positionToDuration(durationInput.value);
  frameDelays = frames.map(() => delay);
  updateDurationLabel();
  markDirty();
  setStatus(`모든 프레임을 ${(delay / 1000).toFixed(2)}초로 맞췄습니다.`);
  restartPreview();
});
deleteFrameBtn.addEventListener("click", deleteSelectedFrame);
makeTab.addEventListener("click", showMakeTab);
archiveTab.addEventListener("click", () => {
  showArchiveTab();
});
homeTitle.addEventListener("click", () => {
  showHome();
});
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
document.addEventListener("keydown", (event) => {
  if (editor.hidden || !editorReady) return;
  const key = event.key.toLowerCase();
  if (!(event.ctrlKey || event.metaKey)) return;
  if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (key === "y") {
    event.preventDefault();
    redo();
  }
});

imageBtn.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", async () => {
  const file = imageInput.files && imageInput.files[0];
  imageInput.value = "";
  if (!file) return;
  try {
    pendingImage = await loadImage(file);
    pickedName.textContent = file.name;
    syncInsertButtons();
  } catch (error) {
    pendingImage = null;
    pickedName.textContent = error instanceof Error ? error.message : "이미지를 열 수 없습니다.";
    syncInsertButtons();
  }
});
insertNextBtn.addEventListener("click", () => placeImage("next"));
overlayBtn.addEventListener("click", () => placeImage("overlay"));

let photoDrag = null;
photoBox.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-handle]");
  if (!handle || !editorReady || selected < 0 || !photoLayers[selected]) return;
  event.preventDefault();
  event.stopPropagation();
  photoDrag = {
    handle: handle.dataset.handle,
    start: clonePhoto(photoLayers[selected]),
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
  };
  rememberFrame(selected);
  stopPreview();
  try { handle.setPointerCapture(event.pointerId); } catch (_) { /* 합성 포인터는 캡처 없이 따라간다. */ }
});
window.addEventListener("pointermove", (event) => {
  if (!photoDrag || event.pointerId !== photoDrag.pointerId || selected < 0) return;
  const metrics = stageMetrics();
  if (!metrics) return;
  const dx = (event.clientX - photoDrag.x) / metrics.scaleX;
  const dy = (event.clientY - photoDrag.y) / metrics.scaleY;
  photoLayers[selected] = resizedPhoto(photoDrag.start, photoDrag.handle, dx, dy);
  composeFrame(selected);
  stageCtx.clearRect(0, 0, stage.width, stage.height);
  stageCtx.drawImage(frames[selected], 0, 0);
  placePhotoBox();
});
window.addEventListener("pointerup", (event) => {
  if (!photoDrag || event.pointerId !== photoDrag.pointerId) return;
  photoDrag = null;
  if (selected >= 0) updateThumbImage(selected);
  markDirty();
  restartPreview();
  setStatus("사진 테두리를 드래그해 크기를 바꿨습니다.");
});
window.addEventListener("pointercancel", (event) => {
  if (!photoDrag || event.pointerId !== photoDrag.pointerId) return;
  photoDrag = null;
  restartPreview();
});
if (window.ResizeObserver) new ResizeObserver(() => placePhotoBox()).observe(stage);

stage.addEventListener("pointerdown", (event) => {
  if (!editorReady || selected < 0) return;
  rememberStroke();
  drawing = true;
  try { stage.setPointerCapture(event.pointerId); } catch (_) { /* 포인터가 이미 놓인 경우에는 캡처 없이 그린다. */ }
  lastPoint = pointFromEvent(event);
  paint(lastPoint, lastPoint);
});
stage.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  const point = pointFromEvent(event);
  paint(lastPoint, point);
  lastPoint = point;
});
stage.addEventListener("pointerup", endStroke);
stage.addEventListener("pointercancel", endStroke);

function endStroke(event) {
  if (!drawing) return;
  drawing = false;
  try {
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  } catch (_) { /* 캡처가 없으면 선을 마무리만 한다. */ }
  updateThumbImage(selected);
  drawPreviewFrame();
  markDirty();
}

function showEditor() {
  document.body.classList.add("is-editor");
  homeShell.hidden = true;
  editor.hidden = false;
  window.scrollTo(0, 0);
}

function showMakeTab() {
  makeTab.classList.add("is-active");
  archiveTab.classList.remove("is-active");
  makeTab.setAttribute("aria-selected", "true");
  archiveTab.setAttribute("aria-selected", "false");
  home.hidden = false;
  archive.hidden = true;
}

function showArchiveTab() {
  archiveTab.classList.add("is-active");
  makeTab.classList.remove("is-active");
  archiveTab.setAttribute("aria-selected", "true");
  makeTab.setAttribute("aria-selected", "false");
  home.hidden = true;
  archive.hidden = false;
  renderArchive();
}

async function showHome() {
  if (leavingHome) return;
  leavingHome = true;
  try {
    if (!editor.hidden && editorReady && frames.length && !archiveSaved) {
      setStatus("만든 GIF를 보관함에 기록하는 중입니다.");
      try {
        await recordCurrentGif();
      } catch (_) {
        setStatus("보관함 기록은 건너뛰고 첫 화면으로 돌아갑니다.", true);
      }
    }
    jobId += 1;
    document.body.classList.remove("is-editor");
    editor.hidden = true;
    homeShell.hidden = false;
    showMakeTab();
    stopPreview();
    frames = [];
    baseFrames = [];
    inkFrames = [];
    photoLayers = [];
    frameDelays = [];
    undoStack = [];
    redoStack = [];
    selected = -1;
    editorReady = false;
    editMode = "video";
    archiveSaved = true;
    currentArchiveId = null;
    pendingImage = null;
    pickedName.textContent = "아직 고른 이미지가 없습니다.";
    photoBox.hidden = true;
    stage.hidden = true;
    stageEmpty.hidden = false;
    thumbs.replaceChildren();
    syncInsertButtons();
    window.scrollTo(0, 0);
  } finally {
    leavingHome = false;
  }
}

function extensionOf(name) {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

function toGifName(name) {
  const base = name.replace(/\.[^./\\]+$/, "").trim();
  return `${base || "output"}.gif`;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", isError);
}

function setProgress(value) {
  const clamped = Math.max(0, Math.min(100, value));
  const shown = Math.round(clamped);
  barFill.style.width = `${clamped}%`;
  bar.setAttribute("aria-valuenow", String(shown));
  percentEl.textContent = `${shown}%`;
  bar.classList.toggle("is-settled", clamped >= 100);
}

function positionToSpeed(position) {
  const t = Number(position);
  if (t <= 50) return SPEED_MIN + (1 - SPEED_MIN) * (t / 50);
  return 1 + (SPEED_MAX - 1) * ((t - 50) / 50);
}

function speedToPosition(value) {
  if (value <= 1) return ((value - SPEED_MIN) / (1 - SPEED_MIN)) * 50;
  return 50 + ((value - 1) / (SPEED_MAX - 1)) * 50;
}

function positionToDuration(position) {
  const t = Number(position);
  if (t <= 50) return 100 + (500 - 100) * (t / 50);
  return 500 + (3000 - 500) * ((t - 50) / 50);
}

function durationToPosition(ms) {
  if (ms <= 500) return ((ms - 100) / 400) * 50;
  return 50 + ((ms - 500) / 2500) * 50;
}

function currentDelayMs() {
  const raw = Math.round(1000 / FPS / speed);
  const centiseconds = Math.min(50, Math.max(2, Math.round(raw / 10)));
  return centiseconds * 10;
}

function updateSpeedLabel() {
  const shown = Math.round(speed * 100) / 100;
  speedLabel.textContent = `${shown.toFixed(2)}배 · 약 ${Math.round(FPS * speed)}FPS`;
}

function updateDurationLabel() {
  const ms = selected >= 0 && frameDelays[selected] ? frameDelays[selected] : positionToDuration(durationInput.value);
  durationLabel.textContent = `${(ms / 1000).toFixed(2)}초`;
}

function delayForFrame(index) {
  if (editMode === "image") return Math.round(frameDelays[index] || 500);
  return currentDelayMs();
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFrame(width, height) {
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  frame.getContext("2d", { willReadFrequently: true });
  return frame;
}

function cloneFrame(source) {
  const copy = createFrame(source.width, source.height);
  copy.getContext("2d").drawImage(source, 0, 0);
  return copy;
}

function thumbURL(frame) {
  const width = 120;
  const height = Math.max(1, Math.round(frame.height * (width / frame.width)));
  thumbCanvas.width = width;
  thumbCanvas.height = height;
  thumbCtx.drawImage(frame, 0, 0, width, height);
  return thumbCanvas.toDataURL("image/jpeg", 0.72);
}

function addThumb(index) {
  document.getElementById("thumbEmpty")?.remove();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb";
  button.dataset.index = String(index);
  const image = document.createElement("img");
  image.src = thumbURL(frames[index]);
  image.alt = `${index + 1}번 프레임`;
  const caption = document.createElement("span");
  caption.textContent = String(index + 1);
  button.append(image, caption);
  button.addEventListener("click", () => selectFrame(Number(button.dataset.index)));
  thumbs.append(button);
  thumbs.scrollLeft = thumbs.scrollWidth;
  markSelected();
}

function updateThumbImage(index) {
  const button = thumbs.querySelector(`[data-index="${index}"]`);
  const image = button && button.querySelector("img");
  if (image) image.src = thumbURL(frames[index]);
}

function renumberThumbs() {
  [...thumbs.children].forEach((button, index) => {
    button.dataset.index = String(index);
    const caption = button.querySelector("span");
    if (caption) caption.textContent = String(index + 1);
    const image = button.querySelector("img");
    if (image) {
      image.alt = `${index + 1}번 프레임`;
      image.src = thumbURL(frames[index]);
    }
  });
  markSelected();
}

function markSelected() {
  thumbs.querySelectorAll(".thumb").forEach((button, index) => {
    const on = index === selected;
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function selectFrame(index) {
  if (index < 0 || index >= frames.length) return;
  selected = index;
  const frame = frames[index];
  stage.width = frame.width;
  stage.height = frame.height;
  stageCtx.drawImage(frame, 0, 0);
  stage.hidden = false;
  stageEmpty.hidden = true;
  frameLabel.textContent = `${index + 1} / ${frames.length} 프레임`;
  if (editMode === "image" && frameDelays[index]) {
    durationInput.value = String(Math.round(durationToPosition(frameDelays[index])));
    updateDurationLabel();
  }
  markSelected();
  syncInsertButtons();
  placePhotoBox();
  requestAnimationFrame(() => {
    if (selected === index) placePhotoBox();
  });
}

function syncHistoryButtons() {
  const canEdit = editorReady;
  undoBtn.disabled = !canEdit || undoStack.length === 0;
  redoBtn.disabled = !canEdit || redoStack.length === 0;
}

function rememberFrame(index) {
  undoStack.push({
    index,
    base: cloneFrame(baseFrames[index]),
    ink: cloneFrame(inkFrames[index]),
    photo: clonePhoto(photoLayers[index]),
  });
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  syncHistoryButtons();
}

function rememberStroke() {
  rememberFrame(selected);
}

function shiftHistory(start, delta) {
  [undoStack, redoStack].forEach((stack) => {
    stack.forEach((step) => {
      if (step.index >= start) step.index += delta;
    });
  });
}

function restoreStep(step) {
  if (!frames[step.index]) return;
  baseFrames[step.index] = step.base;
  inkFrames[step.index] = step.ink;
  photoLayers[step.index] = step.photo;
  composeFrame(step.index);
  selectFrame(step.index);
  updateThumbImage(step.index);
  drawPreviewFrame();
}

function undo() {
  const step = undoStack.pop();
  if (!step) return;
  redoStack.push({
    index: step.index,
    base: cloneFrame(baseFrames[step.index]),
    ink: cloneFrame(inkFrames[step.index]),
    photo: clonePhoto(photoLayers[step.index]),
  });
  restoreStep(step);
  syncHistoryButtons();
  markDirty();
}

function redo() {
  const step = redoStack.pop();
  if (!step) return;
  undoStack.push({
    index: step.index,
    base: cloneFrame(baseFrames[step.index]),
    ink: cloneFrame(inkFrames[step.index]),
    photo: clonePhoto(photoLayers[step.index]),
  });
  restoreStep(step);
  syncHistoryButtons();
  markDirty();
}

function syncInsertButtons() {
  const ready = editorReady && pendingImage;
  insertNextBtn.disabled = !ready || selected < 0;
  overlayBtn.disabled = !ready || selected < 0;
  imageBtn.disabled = !editorReady;
  sizeInput.disabled = !editorReady;
  colorInput.disabled = !editorReady;
  durationInput.disabled = !editorReady;
  applyDurationBtn.disabled = !editorReady;
  deleteFrameBtn.disabled = !editorReady || frames.length === 0;
  document.querySelectorAll(".pen-btn, .swatch").forEach((button) => {
    button.disabled = !editorReady;
  });
  syncHistoryButtons();
}

function markDirty() {
  archiveSaved = false;
}

function pointFromEvent(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * stage.width) / rect.width,
    y: ((event.clientY - rect.top) * stage.height) / rect.height,
  };
}

function toColorInput(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#e11d48";
}

function paint(from, to) {
  const ink = inkFrames[selected];
  if (!ink) return;
  const context = ink.getContext("2d");
  const preset = PENS[pen];
  context.save();
  context.globalCompositeOperation = preset.composite;
  context.globalAlpha = preset.alpha;
  context.strokeStyle = pen === "eraser" ? "#000" : color;
  context.fillStyle = context.strokeStyle;
  context.lineWidth = lineSize;
  context.lineCap = preset.cap;
  context.lineJoin = "round";
  context.shadowBlur = preset.blur;
  context.shadowColor = color;
  context.beginPath();
  if (from.x === to.x && from.y === to.y) {
    context.arc(to.x, to.y, Math.max(1, lineSize / 2), 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
  composeFrame(selected);
  stageCtx.clearRect(0, 0, stage.width, stage.height);
  stageCtx.drawImage(frames[selected], 0, 0);
}

function clonePhoto(photo) {
  if (!photo) return null;
  return { image: photo.image, x: photo.x, y: photo.y, w: photo.w, h: photo.h };
}

function fittedRect(image, width, height, scale) {
  const fit = Math.min(width / image.width, height / image.height) * scale;
  const w = Math.max(1, image.width * fit);
  const h = Math.max(1, image.height * fit);
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function composeFrame(index) {
  const frame = frames[index];
  const context = frame.getContext("2d");
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, frame.width, frame.height);
  context.drawImage(baseFrames[index], 0, 0);
  const photo = photoLayers[index];
  if (photo) context.drawImage(photo.image, photo.x, photo.y, photo.w, photo.h);
  context.drawImage(inkFrames[index], 0, 0);
  context.restore();
}

function stageMetrics() {
  if (stage.hidden || !stage.width || !stage.height) return null;
  const stageRect = stage.getBoundingClientRect();
  const wrapRect = stage.parentElement.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) return null;
  return {
    left: stageRect.left - wrapRect.left,
    top: stageRect.top - wrapRect.top,
    scaleX: stageRect.width / stage.width,
    scaleY: stageRect.height / stage.height,
  };
}

function placePhotoBox() {
  const photo = selected >= 0 ? photoLayers[selected] : null;
  const metrics = stageMetrics();
  if (!photo || !metrics) {
    photoBox.hidden = true;
    return;
  }
  photoBox.hidden = false;
  photoBox.style.left = `${metrics.left + photo.x * metrics.scaleX}px`;
  photoBox.style.top = `${metrics.top + photo.y * metrics.scaleY}px`;
  photoBox.style.width = `${Math.max(photo.w * metrics.scaleX, 8)}px`;
  photoBox.style.height = `${Math.max(photo.h * metrics.scaleY, 8)}px`;
}

function resizedPhoto(start, handle, dx, dy) {
  const aspect = start.h / start.w;
  let scale = 1;
  if (handle === "e") scale = (start.w + dx) / start.w;
  else if (handle === "w") scale = (start.w - dx) / start.w;
  else if (handle === "s") scale = (start.h + dy) / start.h;
  else if (handle === "n") scale = (start.h - dy) / start.h;
  else if (handle === "se") scale = Math.abs(dx) >= Math.abs(dy) ? (start.w + dx) / start.w : (start.h + dy) / start.h;
  else if (handle === "nw") scale = Math.abs(dx) >= Math.abs(dy) ? (start.w - dx) / start.w : (start.h - dy) / start.h;
  else if (handle === "ne") scale = Math.abs(dx) >= Math.abs(dy) ? (start.w + dx) / start.w : (start.h - dy) / start.h;
  else if (handle === "sw") scale = Math.abs(dx) >= Math.abs(dy) ? (start.w - dx) / start.w : (start.h + dy) / start.h;
  const limit = Math.max(stage.width, stage.height) * 2;
  scale = Math.max(16 / start.w, Math.min(limit / start.w, scale));
  const w = start.w * scale;
  const h = w * aspect;
  let x = start.x;
  let y = start.y;
  if (handle.includes("w")) x = start.x + start.w - w;
  else if (handle === "n" || handle === "s") x = start.x + (start.w - w) / 2;
  if (handle.includes("n")) y = start.y + start.h - h;
  else if (handle === "e" || handle === "w") y = start.y + (start.h - h) / 2;
  return { image: start.image, x, y, w, h };
}

function pushFrame(base, ink, photo, delay) {
  const frame = createFrame(base.width, base.height);
  frames.push(frame);
  baseFrames.push(base);
  inkFrames.push(ink);
  photoLayers.push(photo);
  if (editMode === "image") frameDelays.push(delay || 500);
  composeFrame(frames.length - 1);
  addThumb(frames.length - 1);
  if (selected < 0) selectFrame(0);
  else frameLabel.textContent = `${selected + 1} / ${frames.length} 프레임`;
}

function makeWhiteBase(width, height) {
  const base = createFrame(width, height);
  const context = base.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return base;
}

function deleteSelectedFrame() {
  if (!editorReady || selected < 0 || !frames.length) return;
  const index = selected;
  frames.splice(index, 1);
  baseFrames.splice(index, 1);
  inkFrames.splice(index, 1);
  photoLayers.splice(index, 1);
  if (editMode === "image") frameDelays.splice(index, 1);
  [undoStack, redoStack].forEach((stack) => {
    for (let step = stack.length - 1; step >= 0; step -= 1) {
      if (stack[step].index === index) stack.splice(step, 1);
      else if (stack[step].index > index) stack[step].index -= 1;
    }
  });
  thumbs.children[index]?.remove();
  renumberThumbs();
  markDirty();
  if (!frames.length) {
    selected = -1;
    stage.hidden = true;
    stageEmpty.hidden = false;
    photoBox.hidden = true;
    frameLabel.textContent = "프레임이 없습니다.";
    downloadBtn.disabled = true;
    downloadBtn.classList.remove("is-ready");
    stopPreview();
    syncInsertButtons();
    setStatus("프레임을 모두 지웠습니다.");
    return;
  }
  selectFrame(Math.min(index, frames.length - 1));
  restartPreview();
  setStatus(`${index + 1}번 프레임을 삭제했습니다. 뒤 프레임 번호가 하나씩 당겨졌습니다.`);
}

function placeImage(mode) {
  if (!editorReady || !pendingImage || !frames.length || selected < 0) return;
  if (mode === "next") {
    const insertAt = selected + 1;
    const basis = frames[selected];
    const base = makeWhiteBase(basis.width, basis.height);
    const ink = createFrame(basis.width, basis.height);
    const frame = createFrame(basis.width, basis.height);
    const photo = { image: pendingImage, ...fittedRect(pendingImage, basis.width, basis.height, 1) };
    frames.splice(insertAt, 0, frame);
    baseFrames.splice(insertAt, 0, base);
    inkFrames.splice(insertAt, 0, ink);
    photoLayers.splice(insertAt, 0, photo);
    if (editMode === "image") frameDelays.splice(insertAt, 0, frameDelays[selected] || 500);
    composeFrame(insertAt);
    shiftHistory(insertAt, 1);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb";
    const image = document.createElement("img");
    const caption = document.createElement("span");
    button.append(image, caption);
    button.addEventListener("click", () => selectFrame(Number(button.dataset.index)));
    thumbs.insertBefore(button, thumbs.children[insertAt] || null);
    renumberThumbs();
    selectFrame(insertAt);
    const inserted = thumbs.children[insertAt];
    if (inserted) thumbs.scrollLeft = inserted.offsetLeft - thumbs.clientWidth / 2;
    markDirty();
    setStatus(`${insertAt + 1}번 프레임에 사진을 넣었습니다. 테두리를 드래그해 크기를 조절하세요.`);
  } else {
    rememberFrame(selected);
    const current = frames[selected];
    baseFrames[selected] = cloneFrame(current);
    inkFrames[selected] = createFrame(current.width, current.height);
    photoLayers[selected] = { image: pendingImage, ...fittedRect(pendingImage, current.width, current.height, 0.72) };
    composeFrame(selected);
    selectFrame(selected);
    updateThumbImage(selected);
    markDirty();
    setStatus(`${selected + 1}번 프레임 위에 사진을 붙였습니다. 테두리를 드래그해 크기를 조절하세요.`);
  }
  restartPreview();
}

function stopPreview() {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = 0;
  }
}

function drawPreviewFrame() {
  if (!frames.length) return;
  previewIndex = previewIndex % frames.length;
  const frame = frames[previewIndex];
  previewCanvas.width = frame.width;
  previewCanvas.height = frame.height;
  previewCtx.drawImage(frame, 0, 0);
}

function restartPreview() {
  stopPreview();
  if (!frames.length) return;
  const step = () => {
    drawPreviewFrame();
    previewTimer = window.setTimeout(() => {
      previewIndex = (previewIndex + 1) % frames.length;
      step();
    }, delayForFrame(previewIndex));
  };
  step();
}

function loadImage(file) {
  return loadBlobImage(file);
}

function loadBlobImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 열 수 없습니다."));
    };
    image.src = url;
  });
}

function seekTo(time) {
  return new Promise((resolve, reject) => {
    const target = Math.min(Math.max(time, 0), Math.max(video.duration - 0.001, 0));
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("동영상에서 프레임을 읽지 못했습니다."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    if (Math.abs(video.currentTime - target) < 0.0005) {
      video.currentTime = target === 0 ? Math.min(0.001, video.duration) : Math.max(0, target - 0.0001);
    }
    video.currentTime = target;
  });
}

function hasUsableDuration() {
  return Number.isFinite(video.duration) && video.duration > 0 && video.duration < 1e8;
}

function resolveDuration() {
  if (hasUsableDuration()) return Promise.resolve(video.duration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("동영상 길이를 확인할 수 없습니다."));
    }, 8000);
    const finish = () => {
      if (!hasUsableDuration()) return;
      cleanup();
      resolve(video.duration);
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("durationchange", finish);
      video.removeEventListener("seeked", finish);
    };
    video.addEventListener("durationchange", finish);
    video.addEventListener("seeked", finish);
    try {
      video.currentTime = 1e101;
    } catch (_) {
      cleanup();
      reject(new Error("동영상 길이를 확인할 수 없습니다."));
    }
  });
}

function loadVideo(file) {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  video.load();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("영상을 불러오는 데 시간이 너무 오래 걸립니다."));
    }, 20000);
    const done = () => {
      if (!video.videoWidth) return;
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("이 브라우저에서 재생할 수 없는 동영상입니다. 표시된 형식으로 다시 첨부해 주세요."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", done);
      video.removeEventListener("error", fail);
    };
    if (video.readyState >= 2 && video.videoWidth) {
      clearTimeout(timer);
      resolve();
      return;
    }
    video.addEventListener("loadeddata", done);
    video.addEventListener("error", fail);
  });
}

function applyEditorMode(mode) {
  editMode = mode;
  editor.dataset.mode = mode;
  speedCard.hidden = mode === "image";
  durationCard.hidden = mode !== "image";
  editorKicker.textContent = mode === "image" ? "이미지 GIF 편집" : "GIF 편집창";
}

function prepareJob(file, mode = "video") {
  frames = [];
  baseFrames = [];
  inkFrames = [];
  photoLayers = [];
  frameDelays = [];
  undoStack = [];
  redoStack = [];
  selected = -1;
  editorReady = false;
  encoding = false;
  archiveSaved = true;
  currentArchiveId = null;
  pendingImage = null;
  speed = 1;
  speedInput.value = "50";
  durationInput.value = "50";
  photoBox.hidden = true;
  updateSpeedLabel();
  updateDurationLabel();
  applyEditorMode(mode);
  pickedName.textContent = "아직 고른 이미지가 없습니다.";
  gifName = toGifName(file.name);
  downloadBtn.disabled = true;
  downloadBtn.classList.remove("is-ready");
  downloadBtn.setAttribute("aria-label", `${gifName} 다운로드`);
  sourceName.textContent = file.name;
  targetName.textContent = gifName;
  setProgress(0);
  setStatus("편집창으로 이동했습니다. 프레임을 만드는 중입니다.");
  stage.hidden = true;
  stageEmpty.hidden = false;
  frameLabel.textContent = "프레임을 추출하는 중입니다.";
  thumbs.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "thumb-empty";
  empty.id = "thumbEmpty";
  empty.textContent = "변환되는 GIF 프레임이 여기에 순서대로 나타납니다.";
  thumbs.append(empty);
  syncInsertButtons();
  stopPreview();
  showEditor();
}

async function startConversion(file) {
  const myJob = ++jobId;
  prepareJob(file);

  try {
    const ext = extensionOf(file.name);
    if (!file.size) throw new Error("빈 파일은 변환할 수 없습니다.");
    if (!supportedExts.has(ext)) {
      throw new Error("이 형식으로는 GIF를 만들 수 없습니다. 처음 화면의 동영상 형식을 사용해 주세요.");
    }

    await loadVideo(file);
    if (myJob !== jobId) return;
    await resolveDuration();
    if (myJob !== jobId) return;

    try {
      video.muted = true;
      await video.play();
      video.pause();
    } catch (_) {
      // 탐색만으로 프레임을 읽을 수 있으면 변환을 계속한다.
    }
    if (myJob !== jobId) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));
    captureCanvas.width = width;
    captureCanvas.height = height;

    const trimmed = video.duration > MAX_SECONDS + 0.05;
    const duration = Math.min(video.duration, MAX_SECONDS);
    const frameCount = Math.max(1, Math.floor((duration - 0.001) * FPS) + 1);
    const times = Array.from({ length: frameCount }, (_, index) => {
      return Math.min(index / FPS, Math.max(0, duration - 0.001));
    });

    setStatus(
      trimmed
        ? `영상이 길어 앞부분 ${MAX_SECONDS}초만 30FPS로 변환합니다.`
        : `${frameCount}프레임을 30FPS로 변환합니다.`
    );

    for (let index = 0; index < times.length; index += 1) {
      if (myJob !== jobId) return;
      await seekTo(times[index]);
      if (myJob !== jobId) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      captureCtx.drawImage(video, 0, 0, width, height);
      const base = createFrame(width, height);
      base.getContext("2d").drawImage(captureCanvas, 0, 0);
      pushFrame(base, createFrame(width, height), null);
      if (frames.length === 1) restartPreview();
      setProgress(((index + 1) / times.length) * 100);
      setStatus(`변환 중 ${index + 1}/${times.length}프레임 · 30FPS`);
      await yieldToUi();
    }

    if (myJob !== jobId) return;
    editorReady = true;
    archiveSaved = false;
    syncInsertButtons();
    if (frames.length) selectFrame(0);
    setProgress(100);
    setStatus(`변환 완료 · ${gifName}`);
    thumbs.scrollLeft = 0;
    downloadBtn.disabled = false;
    downloadBtn.classList.add("is-ready");
    restartPreview();
  } catch (error) {
    if (myJob !== jobId) return;
    editorReady = false;
    syncInsertButtons();
    downloadBtn.disabled = true;
    downloadBtn.classList.remove("is-ready");
    bar.classList.add("is-settled");
    setStatus(error instanceof Error ? error.message : "변환에 실패했습니다.", true);
  }
}

function isImageFile(file) {
  const ext = extensionOf(file.name);
  return IMAGE_EXTS.has(ext) || /^image\/(png|jpeg|webp|gif)$/.test(file.type);
}

async function startFromImages(fileList) {
  const files = [...fileList].filter(isImageFile);
  if (!files.length) {
    imageHint.textContent = "JPG, PNG, WEBP, GIF 사진만 모을 수 있습니다.";
    return;
  }
  const myJob = ++jobId;
  prepareJob(files[0], "image");
  sourceName.textContent = files.length > 1 ? `${files[0].name} 외 ${files.length - 1}장` : files[0].name;
  gifName = toGifName(files[0].name);
  targetName.textContent = gifName;

  try {
    const images = [];
    for (let index = 0; index < files.length; index += 1) {
      if (myJob !== jobId) return;
      images.push(await loadImage(files[index]));
      setProgress(((index + 1) / files.length) * 70);
      setStatus(`사진 불러오는 중 ${index + 1}/${files.length}`);
      await yieldToUi();
    }
    if (myJob !== jobId) return;

    const maxW = Math.max(...images.map((image) => image.width));
    const maxH = Math.max(...images.map((image) => image.height));
    const scale = Math.min(1, MAX_EDGE / Math.max(maxW, maxH));
    const width = Math.max(2, Math.round(maxW * scale));
    const height = Math.max(2, Math.round(maxH * scale));

    images.forEach((image) => {
      const photo = { image, ...fittedRect(image, width, height, 1) };
      pushFrame(makeWhiteBase(width, height), createFrame(width, height), photo, 500);
    });

    if (myJob !== jobId) return;
    editorReady = true;
    archiveSaved = false;
    syncInsertButtons();
    if (frames.length) selectFrame(0);
    setProgress(100);
    setStatus(`사진 ${frames.length}장을 고른 순서대로 모았습니다 · ${gifName}`);
    thumbs.scrollLeft = 0;
    downloadBtn.disabled = false;
    downloadBtn.classList.add("is-ready");
    restartPreview();
  } catch (error) {
    if (myJob !== jobId) return;
    editorReady = false;
    syncInsertButtons();
    downloadBtn.disabled = true;
    downloadBtn.classList.remove("is-ready");
    bar.classList.add("is-settled");
    setStatus(error instanceof Error ? error.message : "사진을 불러오지 못했습니다.", true);
  }
}

async function encodeGifBlob() {
  const gif = GIFEncoder();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const rgba = new Uint8Array(
      frame.getContext("2d").getImageData(0, 0, frame.width, frame.height).data
    );
    const palette = quantize(rgba, PALETTE_SIZE);
    const pixels = applyPalette(rgba, palette);
    gif.writeFrame(pixels, frame.width, frame.height, {
      palette,
      delay: delayForFrame(index),
      repeat: 0,
    });
    if (index % 2 === 0) await yieldToUi();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function openArchive() {
  if (!openArchive.promise) {
    openArchive.promise = new Promise((resolve, reject) => {
      const request = indexedDB.open("smart-gif-box", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return openArchive.promise;
}

function listRecords() {
  return openArchive().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction("items", "readonly").objectStore("items").getAll();
    request.onsuccess = () => {
      const items = request.result || [];
      items.sort((a, b) => b.savedAt - a.savedAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  }));
}

function putRecord(record) {
  return openArchive().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction("items", "readwrite").objectStore("items").put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

function deleteRecord(id) {
  return openArchive().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction("items", "readwrite").objectStore("items").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

async function trimArchive(limit) {
  const items = await listRecords();
  await Promise.all(items.slice(limit).map((item) => deleteRecord(item.id)));
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("프레임을 저장하지 못했습니다."));
    }, "image/png");
  });
}

function imageBlob(image) {
  if (image.__pngBlob) return Promise.resolve(image.__pngBlob);
  const canvas = createFrame(image.naturalWidth || image.width, image.naturalHeight || image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvasBlob(canvas).then((blob) => {
    image.__pngBlob = blob;
    return blob;
  });
}

async function snapshotLayers() {
  const layers = [];
  for (let index = 0; index < frames.length; index += 1) {
    const photo = photoLayers[index];
    layers.push({
      base: await canvasBlob(baseFrames[index]),
      ink: await canvasBlob(inkFrames[index]),
      photo: photo
        ? { blob: await imageBlob(photo.image), x: photo.x, y: photo.y, w: photo.w, h: photo.h }
        : null,
      delay: editMode === "image" ? delayForFrame(index) : null,
    });
    if (index % 2 === 0) await yieldToUi();
  }
  return layers;
}

async function editArchiveItem(item) {
  const myJob = ++jobId;
  prepareJob({ name: item.name }, item.mode === "image" ? "image" : "video");
  currentArchiveId = item.id;
  gifName = /\.gif$/i.test(item.name) ? item.name : toGifName(item.name);
  sourceName.textContent = item.name;
  targetName.textContent = gifName;
  if (typeof item.speed === "number") {
    speed = item.speed;
    speedInput.value = String(Math.round(speedToPosition(speed)));
    updateSpeedLabel();
  }
  setStatus("보관함에서 편집창으로 여는 중입니다.");
  try {
    if (item.layers && item.layers.length) {
      for (const layer of item.layers) {
        if (myJob !== jobId) return;
        const baseImage = await loadBlobImage(layer.base);
        const inkImage = await loadBlobImage(layer.ink);
        const base = createFrame(baseImage.width, baseImage.height);
        base.getContext("2d").drawImage(baseImage, 0, 0);
        const ink = createFrame(baseImage.width, baseImage.height);
        ink.getContext("2d").drawImage(inkImage, 0, 0);
        let photo = null;
        if (layer.photo) {
          const photoImage = await loadBlobImage(layer.photo.blob);
          photo = {
            image: photoImage,
            x: layer.photo.x,
            y: layer.photo.y,
            w: layer.photo.w,
            h: layer.photo.h,
          };
        }
        pushFrame(base, ink, photo, layer.delay || 500);
        await yieldToUi();
      }
    } else {
      const image = await loadBlobImage(item.blob);
      const width = Math.max(2, image.naturalWidth || image.width);
      const height = Math.max(2, image.naturalHeight || image.height);
      applyEditorMode("image");
      pushFrame(
        makeWhiteBase(width, height),
        createFrame(width, height),
        { image, ...fittedRect(image, width, height, 1) },
        500
      );
    }
    if (myJob !== jobId) return;
    editorReady = true;
    archiveSaved = true;
    syncInsertButtons();
    selectFrame(0);
    setProgress(100);
    downloadBtn.disabled = false;
    downloadBtn.classList.add("is-ready");
    setStatus(`${gifName} 수정을 이어서 합니다.`);
    thumbs.scrollLeft = 0;
    restartPreview();
  } catch (error) {
    if (myJob !== jobId) return;
    setStatus(error instanceof Error ? error.message : "편집창을 열지 못했습니다.", true);
  }
}

async function recordGifBlob(blob) {
  const id = currentArchiveId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  currentArchiveId = id;
  const layers = await snapshotLayers();
  await putRecord({
    id,
    name: gifName || "output.gif",
    savedAt: Date.now(),
    mode: editMode,
    speed,
    frameCount: frames.length,
    blob,
    layers,
  });
  await trimArchive(30);
  archiveSaved = true;
  if (!archive.hidden) renderArchive();
}

async function recordCurrentGif() {
  const blob = await encodeGifBlob();
  await recordGifBlob(blob);
}

function formatSavedAt(time) {
  const date = new Date(time);
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const ampm = hour < 12 ? "오전" : "오후";
  const h12 = hour % 12 || 12;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${ampm} ${h12}:${minute}`;
}

async function renderArchive() {
  let items = [];
  try {
    items = await listRecords();
  } catch (_) {
    archiveEmpty.hidden = false;
    archiveEmpty.textContent = "보관함을 열지 못했습니다.";
    return;
  }
  archivePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  archivePreviewUrls = [];
  archiveGrid.replaceChildren();
  archiveEmpty.hidden = items.length > 0;
  archiveEmpty.textContent = "아직 기록된 GIF가 없습니다.";
  items.forEach((item) => {
    const url = URL.createObjectURL(item.blob);
    archivePreviewUrls.push(url);
    const card = document.createElement("article");
    card.className = "archive-card";
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.name;
    const title = document.createElement("h3");
    title.textContent = item.name;
    const meta = document.createElement("p");
    meta.className = "archive-meta";
    meta.textContent = `${formatSavedAt(item.savedAt)} · ${item.frameCount}프레임`;
    const actions = document.createElement("div");
    actions.className = "archive-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "solid-btn archive-edit";
    editBtn.textContent = "내 GIF 수정";
    editBtn.addEventListener("click", () => editArchiveItem(item));
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ghost-btn";
    saveBtn.textContent = "다운로드";
    saveBtn.addEventListener("click", () => downloadBlob(item.blob, item.name));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost-btn";
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", async () => {
      if (!window.confirm("이 GIF를 보관함에서 지울까요?")) return;
      await deleteRecord(item.id);
      renderArchive();
    });
    actions.append(editBtn, saveBtn, removeBtn);
    card.append(image, title, meta, actions);
    archiveGrid.append(card);
  });
}

async function saveGif() {
  if (!frames.length) return;
  encoding = true;
  downloadBtn.disabled = true;
  setStatus("편집 내용을 GIF로 저장하는 중입니다.");
  try {
    const blob = await encodeGifBlob();
    try {
      await recordGifBlob(blob);
    } catch (_) {
      setStatus("파일은 저장하지만 보관함 기록은 건너뜁니다.", true);
    }
    downloadBlob(blob, gifName);
    setStatus(`저장했습니다 · ${gifName}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "GIF 저장에 실패했습니다.", true);
  } finally {
    encoding = false;
    downloadBtn.disabled = frames.length === 0;
  }
}

updateSpeedLabel();
syncInsertButtons();
renderArchive();
