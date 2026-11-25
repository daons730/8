import { parseGIF, decompressFrame } from "./gif-reader.js";
import { GIFEncoder, quantize, applyPalette } from "./gifenc.esm.js";

function readGif(buffer) {
  const signature = String.fromCharCode(...new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 6)));
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new Error("GIF 형식만 편집할 수 있습니다. .gif 파일을 선택해 주세요.");
  const parsed = parseGIF(buffer);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const entries = parsed.frames.filter(frame => frame.image);
  if (!entries.length || !width || !height || new Uint8Array(buffer).at(-1) !== 59) {
    throw new Error("GIF를 읽을 수 없습니다. 파일이 정상적으로 재생되는지 확인해 주세요.");
  }
  const delays = entries.map(frame => {
    const delay = frame.gce?.delay ?? 0;
    return delay < 2 ? 100 : delay * 10;
  });
  const loop = parsed.frames.find(frame => /^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(frame.application?.id))?.application.blocks;
  const repeat = loop?.[0] === 1 ? loop[1] + 256 * loop[2] : -1;
  return {
    parsed, entries, delays, repeat, width, height,
    info: { width, height, count: entries.length, duration: delays.reduce((sum, delay) => sum + delay, 0) }
  };
}

function allocate(width, height) {
  return new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
}

function paintBackground(context, { left, top, width, height }, color) {
  context.clearRect(left, top, width, height);
  if (!color) return;
  context.fillStyle = `rgb(${color.join(" ")})`;
  context.fillRect(left, top, width, height);
}

function* composeFrames(gif) {
  const { entries, parsed, width, height } = gif;
  const screen = allocate(width, height);
  const patch = allocate(1, 1);
  const backgroundIndex = parsed.lsd.backgroundColorIndex;
  const background = parsed.gct?.[backgroundIndex];
  const first = entries[0].gce;
  const clearColor = first?.extras.transparentColorGiven ? null : background;
  paintBackground(screen, { left: 0, top: 0, width, height }, clearColor);

  for (const entry of entries) {
    const descriptor = entry.image.descriptor;
    if (!descriptor.width || !descriptor.height || descriptor.width * descriptor.height > 24_000_000) {
      throw new Error("이 GIF에 처리할 수 없는 크기의 프레임이 있습니다.");
    }
    const frame = decompressFrame(entry, parsed.gct, true);
    const { dims, disposalType } = frame;
    const previous = disposalType === 3 ? screen.getImageData(0, 0, width, height) : null;
    patch.canvas.width = dims.width;
    patch.canvas.height = dims.height;
    patch.putImageData(new ImageData(frame.patch, dims.width, dims.height), 0, 0);
    screen.drawImage(patch.canvas, dims.left, dims.top);
    yield screen.canvas;
    if (previous) screen.putImageData(previous, 0, 0);
    if (disposalType === 2) {
      paintBackground(screen, dims, frame.transparentIndex === undefined ? clearColor : null);
    }
  }
}

function writeFrame(encoder, pixels, width, height, delay, repeat, colorLimit) {
  const indices = new Uint8Array(width * height);
  const palette = [];
  const colors = new Map();
  let transparentIndex = -1;
  let overflow = false;
  for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index += 1) {
    const opaque = pixels[pixel + 3] >= 128;
    const key = opaque ? pixels[pixel] * 65536 + pixels[pixel + 1] * 256 + pixels[pixel + 2] : -1;
    if (!colors.has(key)) {
      if (palette.length >= colorLimit) { overflow = true; break; }
      colors.set(key, palette.length);
      if (!opaque) transparentIndex = palette.length;
      palette.push(opaque ? [pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]] : [0, 0, 0]);
    }
    indices[index] = colors.get(key);
  }

  let indexed = indices;
  let table = palette;
  if (overflow) {
    const hasAlpha = pixels.some((value, index) => index % 4 === 3 && value < 128);
    const format = hasAlpha ? "rgba4444" : "rgb565";
    if (hasAlpha) {
      for (let i = 3; i < pixels.length; i += 4) {
        pixels[i] = pixels[i] < 128 ? 0 : 255;
        if (!pixels[i]) pixels.fill(0, i - 3, i);
      }
    }
    table = quantize(pixels, colorLimit, { format, oneBitAlpha: true });
    indexed = applyPalette(pixels, table, format);
    transparentIndex = table.findIndex(color => color[3] === 0);
  }
  if (table.length === 1) table.push([0, 0, 0]);
  const options = { palette: table, transparent: transparentIndex >= 0, transparentIndex, delay, repeat, dispose: 2 };
  while (options.delay > 655350) {
    encoder.writeFrame(indexed, width, height, { ...options, delay: 655350 });
    options.delay -= 655350;
  }
  encoder.writeFrame(indexed, width, height, options);
}

function layout(gif, tool, values) {
  const { width, height } = gif;
  if (tool === "resize") return [values.width, values.height];
  if (tool === "crop") {
    const [x, y] = values.ratio.split(":").map(Number);
    const scale = values.mode === "fill" ? Math.max(width / x, height / y) : Math.min(width / x, height / y);
    return [Math.max(1, Math.round(x * scale)), Math.max(1, Math.round(y * scale))];
  }
  if (tool === "downsizing" && values.scale) return [width, height].map(size => Math.max(1, Math.round(size * values.percent / 100)));
  if (tool === "rotate" && ["90", "270"].includes(values.angle)) return [height, width];
  return [width, height];
}

function renderFrame(output, source, tool, values) {
  const { width, height } = output.canvas;
  output.clearRect(0, 0, width, height);
  output.save();
  if (tool === "crop") {
    const fit = values.mode === "fill" ? Math.min : Math.max;
    const scale = fit(width / source.width, height / source.height);
    if (values.mode === "fill") {
      output.fillStyle = values.color;
      output.fillRect(0, 0, width, height);
    }
    const w = source.width * scale;
    const h = source.height * scale;
    output.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
  } else if (tool === "rotate") {
    output.translate(width / 2, height / 2);
    if (values.angle === "horizontal") output.scale(-1, 1);
    else if (values.angle === "vertical") output.scale(1, -1);
    else output.rotate(Number(values.angle) * Math.PI / 180);
    output.drawImage(source, -source.width / 2, -source.height / 2);
  } else {
    output.drawImage(source, 0, 0, width, height);
  }
  output.restore();
}

function subtitleLayout(output, values) {
  const { width, height } = output.canvas;
  const maxWidth = width * 0.88;
  let fontSize = Math.max(1, Math.round(height * values.size / 100));
  let lines;
  const font = size => `700 ${size}px system-ui, "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
  while (true) {
    output.font = font(fontSize);
    lines = values.text.trim().split(/\r?\n/).flatMap(paragraph => {
      const wrapped = [];
      let line = "";
      for (const character of paragraph) {
        if (line && output.measureText(line + character).width > maxWidth) {
          wrapped.push(line.trimEnd());
          line = "";
        }
        line += character;
      }
      return [...wrapped, line.trimEnd()];
    });
    if (fontSize <= 1 || lines.length * fontSize * 1.2 <= height * 0.88) break;
    fontSize = Math.max(1, Math.floor(fontSize * 0.8));
  }
  const lineHeight = Math.min(fontSize * 1.2, height / lines.length);
  const textHeight = lines.length * lineHeight;
  const margin = Math.min(height * 0.06, (height - textHeight) / 2);
  const top = values.position === "top" ? margin :
    values.position === "middle" ? (height - textHeight) / 2 : height - textHeight - margin;

  return () => {
    output.save();
    output.font = font(fontSize);
    output.textAlign = "center";
    output.textBaseline = "middle";
    output.lineJoin = "round";
    output.lineWidth = Math.max(1, fontSize * 0.16);
    output.strokeStyle = "#101723";
    output.fillStyle = values.color;
    lines.forEach((line, index) => {
      const y = top + (index + 0.5) * lineHeight;
      output.strokeText(line, width / 2, y, maxWidth);
      output.fillText(line, width / 2, y, maxWidth);
    });
    output.restore();
  };
}

function subtitleSegments(time, delay, { start, end }) {
  const last = time + delay;
  start = Math.round(start * 100) * 10;
  end = Math.round(end * 100) * 10;
  if (end <= time || start >= last) return [[delay, false]];
  const inAt = Math.max(time, start);
  const outAt = Math.min(last, end);
  const before = inAt - time >= 20 ? inAt - time : 0;
  const after = last - outAt >= 20 ? last - outAt : 0;
  const visible = delay - before - after;
  // GIF players can treat delays under 20 ms as a longer default.
  if (visible < 20) return [[delay, true]];
  return [[before, false], [visible, true], [after, false]].filter(([ms]) => ms);
}

function frameDelays(gif, tool, values) {
  const delays = [...gif.delays];
  if (tool === "speed") return delays.map(delay => Math.max(20, Math.round(delay / values.speed / 10) * 10));
  if (tool === "cut") {
    let time = 0;
    return delays.map(delay => {
      const overlap = Math.min(time + delay, values.end * 1000) - Math.max(time, values.start * 1000);
      time += delay;
      return overlap > 1e-6 ? Math.max(20, Math.round(overlap / 10) * 10) : 0;
    });
  }
  if (tool === "downsizing" && values.drop) {
    for (let i = 1; i < delays.length; i += 2) {
      delays[i - 1] += delays[i];
      delays[i] = 0;
    }
  }
  return delays;
}

async function optimize(buffer) {
  const { default: createGifsicle } = await import("./gifsicle.js");
  const mod = await createGifsicle({ printErr: console.warn });
  mod.FS.writeFile("/original.gif", new Uint8Array(buffer));
  const args = ["gifsicle", "-O3", "-o", "/result.gif", "/original.gif"];
  const argv = mod._malloc((args.length + 1) * 4);
  const pointers = args.map(arg => mod.stringToNewUTF8(arg));
  try {
    pointers.forEach((pointer, i) => mod.setValue(argv + i * 4, pointer, "i32"));
    mod.setValue(argv + args.length * 4, 0, "i32");
    if (mod._run_gifsicle(args.length, argv)) throw new Error("GIF를 최적화할 수 없습니다.");
    const bytes = mod.FS.readFile("/result.gif");
    return bytes.length < buffer.byteLength ? bytes.buffer : buffer;
  } finally {
    pointers.forEach(mod._free);
    mod._free(argv);
  }
}

async function toMp4(buffer, info) {
  const { default: createFFmpeg } = await import("./ffmpeg-core.js");
  const response = await fetch(new URL("./ffmpeg-core.wasm.gz", import.meta.url));
  if (!response.ok || !response.body) throw new Error("MP4 변환 모듈을 불러올 수 없습니다.");
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  const wasmBinary = await new Response(decompressed).arrayBuffer();
  const ffmpeg = await createFFmpeg({ wasmBinary });
  ffmpeg.FS.writeFile("input.gif", new Uint8Array(buffer));
  const exit = ffmpeg.exec("-ignore_loop", "1", "-i", "input.gif", "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=100,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
    "-movflags", "+faststart", "output.mp4");
  if (exit !== 0) throw new Error("MP4 변환에 실패했습니다.");
  const bytes = ffmpeg.FS.readFile("output.mp4");
  return {
    blob: new Blob([bytes], { type: "video/mp4" }), ext: "mp4",
    info: { ...info, width: Math.ceil(info.width / 2) * 2, height: Math.ceil(info.height / 2) * 2, count: null }
  };
}

async function edit(buffer, tool, values) {
  const gif = readGif(buffer);
  if (tool === "optimize") {
    const data = await optimize(buffer);
    return { blob: new Blob([data], { type: "image/gif" }), ext: "gif", info: readGif(data).info };
  }
  if (tool === "convert" && values.format === "mp4") return toMp4(buffer, gif.info);

  const [width, height] = layout(gif, tool, values);
  if (width * height > 24_000_000 || gif.width * gif.height > 24_000_000 ||
      (tool === "reverse" && width * height * gif.entries.length > 50_000_000)) {
    throw new Error("처리할 이미지가 너무 큽니다. 크기를 줄이거나 구간을 잘라 다시 시도해 주세요.");
  }
  const output = allocate(width, height);
  const composed = composeFrames(gif);
  const reduced = tool === "downsizing" && values.resolution
    ? allocate(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)))
    : null;
  if (tool === "convert") {
    renderFrame(output, composed.next().value, tool, values);
    output.globalCompositeOperation = "destination-over";
    output.fillStyle = "#ffffff";
    output.fillRect(0, 0, width, height);
    const blob = await output.canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    return { blob, ext: "jpg", info: { width, height, count: 1, duration: null } };
  }

  const encoder = GIFEncoder();
  const reversed = [];
  const delays = frameDelays(gif, tool, values);
  const colorLimit = tool === "downsizing" && values.resolution ? 64 : 256;
  const drawSubtitle = tool === "subtitle" ? subtitleLayout(output, values) : null;
  let time = 0;
  let index = 0;
  for (const source of composed) {
    const delay = delays[index];
    index += 1;
    if (!delay) continue;
    if (reduced) {
      renderFrame(reduced, source, tool, values);
      output.imageSmoothingEnabled = false;
    }
    const segments = drawSubtitle ? subtitleSegments(time, delay, values) : [[delay, false]];
    time += delay;
    for (const [segmentDelay, showSubtitle] of segments) {
      renderFrame(output, reduced?.canvas ?? source, tool, values);
      if (showSubtitle) drawSubtitle();
      const { data } = output.getImageData(0, 0, width, height);
      if (tool === "reverse") reversed.push({ data, delay: segmentDelay });
      else writeFrame(encoder, data, width, height, segmentDelay, gif.repeat, colorLimit);
    }
    if (index === 1 || index % 8 === 0) self.postMessage({ progress: index / delays.length });
  }
  for (const { data, delay } of reversed.reverse()) {
    writeFrame(encoder, data, width, height, delay, gif.repeat, colorLimit);
  }
  encoder.finish();
  let data = encoder.bytes().buffer;
  if (tool === "downsizing" && data.byteLength >= buffer.byteLength) {
    try {
      data = await optimize(data);
    } catch (error) {
      console.warn("GIF 압축을 추가로 적용할 수 없습니다.", error);
    }
  }
  return { blob: new Blob([data], { type: "image/gif" }), ext: "gif", info: readGif(data).info };
}

self.onmessage = async ({ data: { buffer, tool, values } }) => {
  try {
    const result = tool ? await edit(buffer, tool, values) : readGif(buffer).info;
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
