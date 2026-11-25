const $ = id => document.getElementById(id);
const paths = {
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 15v5h14v-5"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',
  shield: '<path d="m12 3 7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
  back: '<path d="m10 7-5 5 5 5m-5-5h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sliders: '<path d="M5 4v16m7-16v16m7-16v16M2 9h6m1 6h6m1-7h6"/>',
  resize: '<path d="M4 10V4h6m4 0h6v6m0 4v6h-6m-4 0H4v-6m4 2 8-8"/>',
  crop: '<path d="M6 3v15h15M3 6h15v15"/>',
  downsizing: '<path d="M4 4l6 6m-6 0h6V4m10 16-6-6m6 0h-6v6"/>',
  convert: '<path d="M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4"/>',
  rotate: '<path d="M4 12a8 8 0 1 0 8-8H5m3-3L5 4l3 3"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  optimize: '<path d="m13 2-8 12h6l-1 8 9-12h-6l1-8Z"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h10a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5H10a5 5 0 0 0 0 10h3"/>',
  reverse: '<path d="m12 5-8 7 8 7V5Zm8 0-8 7 8 7V5Z"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0H4Zm8-4 4-5"/>',
  subtitle: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M6.5 12h4m3 0h4m-11 3.5h11"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12M8 16 20 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2m-3.5 9v3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
document.querySelectorAll("[data-icon]").forEach(node => { node.innerHTML = icon(node.dataset.icon); });

const tools = {
  resize: ["Resize", "크기 조절", "Resized GIF"],
  crop: ["Crop", "비율에 맞춰 자르기", "Cropped GIF"],
  downsizing: ["Downsizing", "파일 용량 줄이기", "Downsized GIF"],
  convert: ["Format Convert", "MP4 또는 JPG로 변환", "Converted"],
  rotate: ["Rotate", "회전 및 뒤집기", "Rotated GIF"],
  optimize: ["Optimize", "화질 손실 없이 최적화", "Optimized GIF"],
  reverse: ["Reverse", "역재생", "Reversed GIF"],
  speed: ["Speed", "재생 속도 조절", "Speed-adjusted GIF"],
  cut: ["Cut", "재생 구간 잘라내기", "Trimmed GIF"],
  subtitle: ["자막 넣기", "문구와 표시 구간을 설정하세요.", "자막이 포함된 GIF"]
};
let original;
let current;
let result;
let resultUrl;
const undoHistory = [];
const redoHistory = [];
let fileHandle;
let pending = false;
let savedHandle;
let draft;
const objectUrls = new Set();

function urlFor(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function clearUrl(url) {
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(url);
}

function status(id, message = "", error = false) {
  const node = $(id);
  node.textContent = message;
  node.hidden = !message;
  node.classList.toggle("error", error);
}

async function processGif(blob, tool, values, onProgress, signal) {
  const buffer = await blob.arrayBuffer();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let worker;
    const cleanup = () => {
      worker?.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    try {
      worker = new Worker(new URL("./gif-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (data.progress !== undefined) {
          onProgress?.(data.progress);
          return;
        }
        cleanup();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = event => {
        cleanup();
        reject(new Error("GIF 처리 모듈을 실행할 수 없습니다.", { cause: event.message }));
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ buffer, tool, values }, [buffer]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function byteSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(2)} MB`;
}

function preview(target, asset, title, downloadName) {
  const { blob, ext, info, url } = asset;
  const frame = document.createElement("div");
  frame.className = "media-stage";
  const media = document.createElement(ext === "mp4" ? "video" : "img");
  if (ext === "mp4") {
    media.controls = true;
    media.playsInline = true;
    if (target.id === "draft-body") {
      media.muted = true;
      media.loop = true;
      media.autoplay = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    media.setAttribute("aria-label", title);
  } else {
    media.alt = title;
  }
  media.src = url;
  frame.append(media);
  const list = document.createElement("dl");
  list.className = "meta";
  const metadata = [
    ["크기", `${info.width} × ${info.height} px`],
    ["용량", byteSize(blob.size)],
    ["형식", ext.toUpperCase()],
    ["프레임", info.count === null ? null : `${info.count}개`],
    ["재생 시간", info.duration === null ? null : `${(info.duration / 1000).toFixed(2)}초`]
  ];
  for (const [key, value] of metadata) {
    if (value === null) continue;
    const item = document.createElement("div");
    const label = document.createElement("dt");
    const data = document.createElement("dd");
    label.textContent = key;
    data.textContent = value;
    item.append(label, data);
    list.append(item);
  }
  target.replaceChildren(frame, list);
  if (downloadName) {
    const actions = document.createElement("div");
    actions.className = "result-actions";
    const download = document.createElement("a");
    download.className = "secondary";
    download.href = url;
    download.download = downloadName;
    download.innerHTML = `${icon("download")} 다운로드`;
    actions.append(download);
    target.append(actions);
  }
}

function optionValues(form) {
  return Object.fromEntries([...form.querySelectorAll("input, select, textarea")].map(input => [
    input.name, input.type === "checkbox" ? input.checked : (["range", "number"].includes(input.type) ? input.valueAsNumber : input.value)
  ]));
}

function optionError(tool, values) {
  if ((tool === "cut" || tool === "subtitle") && (!Number.isFinite(values.start) || !Number.isFinite(values.end) ||
      values.start < 0 || values.end > current.info.duration / 1000 || values.start >= values.end)) {
    return "재생 시간 안에서 시작 시간과 그보다 뒤의 종료 시간을 입력해 주세요.";
  }
  if (tool === "subtitle" && !values.text.trim()) return "미리볼 자막을 입력해 주세요.";
  if (tool === "downsizing" && !values.scale && !values.drop && !values.resolution) {
    return "용량을 줄일 방법을 한 가지 이상 선택해 주세요.";
  }
  return "";
}

function cancelDraft() {
  if (!draft) return;
  clearTimeout(draft.timer);
  draft.controller.abort();
  draft = undefined;
}

function clearDraftMedia() {
  clearUrl($("draft-body").querySelector("img, video")?.src);
  $("draft-body").replaceChildren();
}

const previewPanels = document.querySelector(".previews");
const previewButtons = [...document.querySelectorAll(".preview-switch button")];

function showPreview(view = previewPanels.dataset.view) {
  if ($(view).hidden) view = $("result").hidden ? "original" : "result";
  previewPanels.dataset.view = view;
  for (const button of previewButtons) {
    const panel = button.dataset.view;
    button.hidden = $(panel).hidden;
    button.setAttribute("aria-pressed", String(panel === view));
  }
}

for (const button of previewButtons) {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "original") setOriginalOpen(true);
    showPreview(view);
  });
}

function closeDraft() {
  cancelDraft();
  clearDraftMedia();
  $("draft").hidden = true;
  showPreview();
  status("draft-status");
}

const draftKey = (tool, values) => JSON.stringify([tool, values]);

function updateDraft(form, tool) {
  const values = optionValues(form);
  const error = optionError(tool, values);
  const key = draftKey(tool, values);
  if (!error && draft?.key === key) return;
  cancelDraft();
  $("draft").hidden = false;
  $("draft-tool").textContent = tools[tool][0];
  if (error) {
    clearDraftMedia();
    status("draft-status", error, true);
    return;
  }

  const controller = new AbortController();
  const job = { key, controller, timer: null, edited: null };
  const input = current.blob;
  draft = job;
  status("draft-status", "미리보기 업데이트 중…");
  job.timer = setTimeout(async () => {
    try {
      const edited = await processGif(input, tool, values, undefined, controller.signal);
      if (draft !== job) return;
      job.edited = edited;
      clearDraftMedia();
      preview($("draft-body"), { ...edited, url: urlFor(edited.blob) }, `${tools[tool][0]} 미리보기`);
      const sizeChange = ["optimize", "downsizing"].includes(tool)
        ? `용량 ${byteSize(input.size)} → ${byteSize(edited.blob.size)}`
        : "";
      status("draft-status", sizeChange);
    } catch (error) {
      if (draft !== job) return;
      clearDraftMedia();
      status("draft-status", error.message, true);
    }
  }, 180);
}

function setOriginalOpen(open) {
  $("original-body").hidden = !open;
  $("toggle-original").setAttribute("aria-expanded", String(open));
  $("toggle-original").setAttribute("aria-label", `Original GIF ${open ? "접기" : "펼치기"}`);
}

async function loadFiles(files, handle) {
  if (pending || !files.length) return;
  if (files.length !== 1) {
    status("upload-status", "한 번에 GIF 파일 한 개만 선택할 수 있습니다.", true);
    return;
  }
  const [file] = files;
  pending = true;
  $("choose").disabled = true;
  status("upload-status", "GIF 정보를 읽는 중…");
  try {
    const info = await processGif(file);
    original = { blob: file, ext: "gif", info, url: urlFor(file) };
    current = original;
    fileHandle = handle;
    $("filename").textContent = file.name;
    preview($("original-body"), original, "원본 GIF");
    setOriginalOpen(true);
    showTools();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("filename").focus();
  } catch (error) {
    status("upload-status", error.message, true);
  } finally {
    pending = false;
    $("choose").disabled = false;
  }
}

$("choose").addEventListener("click", async () => {
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false, types: [{ description: "GIF 이미지", accept: { "image/gif": [".gif"] } }]
      });
      if (handle) await loadFiles([await handle.getFile()], handle);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  $("file").click();
});

$("file").addEventListener("change", event => {
  void loadFiles([...event.target.files]);
  event.target.value = "";
});

const dropzone = $("dropzone");
dropzone.addEventListener("dragover", event => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", event => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("dragover");
});
dropzone.addEventListener("drop", async event => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  const files = [...event.dataTransfer.files];
  const item = [...event.dataTransfer.items].find(candidate => candidate.kind === "file");
  let handle;
  if (files.length === 1 && item?.getAsFileSystemHandle) {
    handle = await item.getAsFileSystemHandle().catch(() => undefined);
    if (handle?.kind !== "file") handle = undefined;
  }
  void loadFiles(files, handle);
});
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => event.preventDefault());

$("toggle-original").addEventListener("click", () => setOriginalOpen($("original-body").hidden));
$("reset").addEventListener("click", () => {
  closeDraft();
  for (const url of objectUrls) clearUrl(url);
  original = current = result = resultUrl = fileHandle = savedHandle = undefined;
  undoHistory.length = redoHistory.length = 0;
  syncHistoryControls();
  $("original-body").replaceChildren();
  $("result-body").replaceChildren();
  $("result").hidden = true;
  showPreview("original");
  $("editor").hidden = true;
  $("home").hidden = false;
  status("upload-status");
  $("choose").focus();
});

function showTools(focus = false) {
  closeDraft();
  $("tools-title").textContent = "Editor Tools";
  const buttons = Object.entries(tools).map(([key, [name, description]]) =>
    `<button class="tool-button" type="button" data-tool="${key}" aria-label="${name} · ${description}" title="${description}">${icon(key)}<span>${name}</span></button>`
  );
  $("tools").innerHTML = `<div class="tool-grid">${buttons.join("")}</div>`;
  $("tools").querySelectorAll("[data-tool]").forEach(button => {
    button.addEventListener("click", () => showOptions(button.dataset.tool));
  });
  status("edit-status");
  if (focus) $("tools-title").focus();
}

function select(name, label, items) {
  const options = items.map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
  return `<label class="field">${label}<select name="${name}">${options}</select></label>`;
}

function range(name, label, min, max, value, step, units) {
  return `<label class="field"><span>${label}<output data-unit="${units}">${value}${units}</output></span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function showOptions(tool) {
  const { width, height, duration } = current.info;
  const seconds = duration / 1000;
  const timingFields = `<p>전체 재생 시간 ${seconds.toFixed(2)}초</p>
      <div class="time-fields"><label class="field">시작 시간 (초)<input type="number" name="start" min="0" max="${seconds}" step="0.01" value="0" required></label>
      <label class="field">종료 시간 (초)<input type="number" name="end" min="0.01" max="${seconds}" step="0.01" value="${seconds}" required></label></div>`;
  const axis = (name, label, size) => range(name, label, Math.max(1, Math.round(size * 0.05)), size * 3, size, 1, " px");
  const options = {
    resize: axis("width", "X축 · 가로", width) +
      `<div class="lock-row"><button id="ratio-lock" type="button" class="icon-button" aria-label="가로세로 비율 잠금" aria-pressed="true">${icon("lock")}</button><span id="lock-note">비율 유지 켜짐</span></div>` +
      axis("height", "Y축 · 세로", height),
    crop: select("ratio", "가로:세로 비율", [["1:1", "1:1 · 정사각형"], ["4:3", "4:3"], ["16:9", "16:9 · 가로"], ["9:16", "9:16 · 세로"], ["3:2", "3:2"], ["2:3", "2:3"]]) +
      select("mode", "빈 공간 처리", [["fill", "단색으로 채우기"], ["cover", "확대해서 채우기"]]) +
      '<label id="color-field" class="field">배경색<input name="color" type="color" value="#ffffff"></label>',
    downsizing: '<label><input name="scale" type="checkbox" checked> 사이즈 축소</label>' +
      range("percent", "원본 크기 대비", 10, 95, 70, 1, "%") +
      '<label><input name="drop" type="checkbox"> 프레임 삭제 · 한 프레임씩 건너뛰기</label><label><input name="resolution" type="checkbox"> 해상도 낮추기 · 세부 묘사와 색상 줄이기</label>',
    convert: select("format", "저장할 형식", [["mp4", "MP4 · 동영상"], ["jpg", "JPG · 첫 프레임"]]),
    rotate: select("angle", "회전 또는 뒤집기", [["90", "오른쪽 90°"], ["180", "180°"], ["270", "오른쪽 270°"], ["vertical", "상하 뒤집기"], ["horizontal", "좌우 뒤집기"]]),
    optimize: "<p>화질을 유지하면서 GIF 용량을 줄입니다.</p>",
    reverse: "<p>마지막 프레임부터 거꾸로 재생합니다.</p>",
    speed: range("speed", "재생 속도", 0.25, 4, 1, 0.05, "×"),
    cut: timingFields,
    subtitle: '<label class="field">자막 문구<textarea name="text" rows="2" maxlength="160" required placeholder="GIF에 넣을 문구"></textarea></label>' +
      '<div class="subtitle-options">' +
      select("position", "자막 위치", [["bottom", "아래"], ["middle", "가운데"], ["top", "위"]]) +
      '<label class="field">글자 색<input name="color" type="color" value="#ffffff"></label></div>' +
      range("size", "글자 크기 · 화면 높이 대비", 3, 20, 8, 1, "%") + timingFields
  };
  $("tools-title").textContent = `Editor Tools · ${tools[tool][0]}`;
  $("tools").innerHTML = `<form class="tool-form"><div class="tool-fields"><p>${tools[tool][1]}</p>${options[tool]}</div><div class="action-row">
    <button type="button" class="secondary" id="tool-back">Back</button><button type="submit" class="primary">Go!</button></div></form>`;
  const form = $("tools").querySelector("form");
  const control = name => form.elements.namedItem(name);
  const refresh = () => {
    for (const input of form.querySelectorAll('input[type="range"]')) {
      const output = input.parentElement.querySelector("output");
      output.value = input.value + output.dataset.unit;
    }
  };
  form.addEventListener("input", event => {
    if (tool === "resize" && $("ratio-lock").getAttribute("aria-pressed") === "true") {
      if (event.target === control("width")) control("height").value = Math.round(control("width").value * height / width);
      if (event.target === control("height")) control("width").value = Math.round(control("height").value * width / height);
    }
    if (tool === "crop") $("color-field").hidden = control("mode").value !== "fill";
    if (tool === "downsizing") control("percent").disabled = !control("scale").checked;
    refresh();
    status("edit-status");
    updateDraft(form, tool);
  });
  $("ratio-lock")?.addEventListener("click", event => {
    const button = event.currentTarget;
    const locked = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(locked));
    button.innerHTML = icon(locked ? "lock" : "unlock");
    $("lock-note").textContent = `비율 유지 ${locked ? "켜짐" : "꺼짐"}`;
    if (locked) control("height").value = Math.round(control("width").value * height / width);
    refresh();
    status("edit-status");
    updateDraft(form, tool);
  });
  $("tool-back").addEventListener("click", () => showTools(true));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const values = optionValues(form);
    const error = optionError(tool, values);
    if (error) {
      status("edit-status", error, true);
      return;
    }
    void runEdit(form, tool, values);
  });
  status("edit-status");
  updateDraft(form, tool);
  showPreview("draft");
  $("tools-title").focus();
}

const stem = () => original.blob.name.replace(/\.[^.]+$/, "") || original.blob.name;

function syncHistoryControls() {
  $("undo").disabled = pending || !undoHistory.length;
  $("redo").disabled = pending || !redoHistory.length;
  $("save").disabled = pending || !result;
}

function renderResult() {
  clearUrl(resultUrl);
  resultUrl = undefined;
  $("result").hidden = !result;
  if (result) {
    const { title, downloadName } = result;
    resultUrl = urlFor(result.blob);
    $("result-title").textContent = title;
    preview($("result-body"), { ...result, url: resultUrl }, title, downloadName);
    setOriginalOpen(false);
    showPreview("result");
  } else {
    $("result-body").replaceChildren();
    setOriginalOpen(true);
    showPreview("original");
  }
}

function moveInHistory(from, to, message) {
  if (pending || $("save-dialog").open || !from.length) return;
  to.push({ current, result });
  ({ current, result } = from.pop());
  showTools();
  renderResult();
  syncHistoryControls();
  status("edit-status", message);
}

$("undo").addEventListener("click", () => {
  moveInHistory(undoHistory, redoHistory, "이전 편집 상태로 돌아갔습니다.");
});
$("redo").addEventListener("click", () => {
  moveInHistory(redoHistory, undoHistory, "되돌린 편집을 다시 적용했습니다.");
});

document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey ||
      event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const key = event.key.toLowerCase();
  const button = key === "z" ? $(event.shiftKey ? "redo" : "undo") : key === "y" ? $("redo") : null;
  if (!button || button.disabled || $("save-dialog").open) return;
  event.preventDefault();
  button.click();
});

async function runEdit(form, tool, values) {
  if (pending) return;
  pending = true;
  const ready = draft?.key === draftKey(tool, values) ? draft.edited : null;
  closeDraft();
  const controls = [...form.querySelectorAll("button, input, select, textarea")].filter(control => !control.disabled);
  controls.forEach(control => { control.disabled = true; });
  $("reset").disabled = true;
  syncHistoryControls();
  status("edit-status", "처리 중…");
  const previousSize = current.blob.size;
  try {
    const edited = ready ?? await processGif(current.blob, tool, values, percent => {
      status("edit-status", `처리 중… ${Math.min(99, Math.round(percent * 100))}%`);
    });
    const title = tool === "convert" ? `Converted ${edited.ext.toUpperCase()}` : tools[tool][2];
    const originalGifName = /\.gif$/i.test(original.blob.name) ? original.blob.name : `${stem()}.gif`;
    const downloadName = tool === "resize" ? `Resized_${originalGifName}` : `${stem()}_ed.${edited.ext}`;
    undoHistory.push({ current, result });
    redoHistory.length = 0;
    result = { ...edited, title, downloadName };
    if (edited.ext === "gif") current = result;
    showTools(true);
    renderResult();
    const unchangedSize = tool === "optimize" && edited.blob.size === previousSize;
    const increasedSize = tool === "downsizing" && edited.blob.size >= previousSize;
    status("edit-status", unchangedSize ? "화질을 유지하면서 더 줄일 수 있는 용량이 없습니다." :
      increasedSize ? "이 설정으로는 용량이 줄지 않았습니다. 축소 비율이나 프레임 옵션을 조정해 보세요." : "편집이 완료되었습니다.");
  } catch (error) {
    status("edit-status", error.message, true);
  } finally {
    pending = false;
    controls.forEach(control => { control.disabled = false; });
    $("reset").disabled = false;
    syncHistoryControls();
  }
}

$("save").addEventListener("click", () => {
  if (!result || pending) return;
  $("save-name").value = `${stem()}_ed.${result.ext}`;
  $("save-location").textContent = !("showSaveFilePicker" in window) ?
    "이 브라우저의 다운로드 설정에 따라 저장됩니다." :
    fileHandle ? "저장 창이 원본 파일의 폴더에서 열립니다. 다른 폴더도 선택할 수 있습니다." :
      "저장 창에서 폴더를 선택할 수 있습니다.";
  status("save-status");
  $("save-dialog").showModal();
  $("save-name").select();
});

$("cancel-save").addEventListener("click", () => $("save-dialog").close());
$("save-form").addEventListener("submit", async event => {
  event.preventDefault();
  if ($("save-submit").disabled) return;
  const raw = $("save-name").value.trim();
  if (!raw || /^[.\s]+$/.test(raw) || /[\\/:*?"<>|]/.test(raw)) {
    status("save-status", "사용할 수 있는 파일명을 입력해 주세요.", true);
    return;
  }
  const ext = result.ext;
  const name = raw.toLowerCase().endsWith(`.${ext}`) ? raw : `${raw.replace(/\.(gif|mp4|jpe?g)$/i, "")}.${ext}`;
  $("save-submit").disabled = true;
  try {
    if ("showSaveFilePicker" in window) {
      const accept = { [result.blob.type]: [`.${ext}`] };
      let picker;
      try {
        picker = await window.showSaveFilePicker({
          suggestedName: name, types: [{ description: ext.toUpperCase(), accept }],
          startIn: fileHandle ?? savedHandle ?? "downloads"
        });
      } catch (error) {
        if (error.name !== "SecurityError" && error.name !== "NotSupportedError") throw error;
      }
      if (picker) {
        const writable = await picker.createWritable();
        try {
          await writable.write(result.blob);
          await writable.close();
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
        savedHandle = picker;
        $("save-dialog").close();
        status("edit-status", "파일을 저장했습니다.");
        return;
      }
    }
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = name;
    link.click();
    $("save-dialog").close();
    status("edit-status", "브라우저에서 파일 다운로드를 시작했습니다.");
  } catch (error) {
    if (error.name !== "AbortError") status("save-status", "저장할 수 없습니다. 파일명과 폴더 권한을 확인해 주세요.", true);
  } finally {
    $("save-submit").disabled = false;
  }
});
