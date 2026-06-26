const storageKey = "noteapp.web.handwritten.v1";
const legacyStorageKey = "noteapp.web.notes.v1";
const selectedKey = "noteapp.web.handwritten.selected.v1";

const paperSizes = {
  a4: { label: "A4", width: 1400, height: 1980 },
  a5: { label: "A5", width: 990, height: 1400 },
  b5: { label: "B5", width: 1200, height: 1697 },
  letter: { label: "Letter", width: 1400, height: 1812 }
};
const paperBackgrounds = ["plain", "lined", "grid"];
const defaultPaper = { size: "a4", background: "grid" };
const paperPatternSpacing = 40;

const elements = {
  skipLink: document.querySelector(".skip-link"),
  listView: document.querySelector("#listView"),
  editorView: document.querySelector("#editorView"),
  newNoteButton: document.querySelector("#newNoteButton"),
  newPaperSizeSelect: document.querySelector("#newPaperSizeSelect"),
  backToListButton: document.querySelector("#backToListButton"),
  deleteNoteButton: document.querySelector("#deleteNoteButton"),
  clearCanvasButton: document.querySelector("#clearCanvasButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  penButton: document.querySelector("#penButton"),
  eraserButton: document.querySelector("#eraserButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomValue: document.querySelector("#zoomValue"),
  strokeWidthInput: document.querySelector("#strokeWidthInput"),
  paperBackgroundSelect: document.querySelector("#paperBackgroundSelect"),
  swatches: [...document.querySelectorAll(".swatch")],
  searchInput: document.querySelector("#searchInput"),
  noteList: document.querySelector("#noteList"),
  titleInput: document.querySelector("#titleInput"),
  canvas: document.querySelector("#drawingCanvas"),
  saveState: document.querySelector("#saveState")
};

const context = elements.canvas.getContext("2d");
const strokeLayer = document.createElement("canvas");
const strokeLayerContext = strokeLayer.getContext("2d");
const canvasResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(updatePaperPattern)
  : null;

let notes = loadNotes();
let selectedId = localStorage.getItem(selectedKey);
let saveTimer = null;
let currentStroke = null;
let activeTool = "pen";
let activeColor = "#202124";
let strokeWidth = Number(elements.strokeWidthInput.value);
let redoStack = [];
let currentView = "list";
let canvasZoom = 1;

const minCanvasZoom = 0.5;
const maxCanvasZoom = 2;
const canvasZoomStep = 0.25;

if (!notes.some((note) => note.id === selectedId)) {
  selectedId = notes[0]?.id ?? null;
}

render();

canvasResizeObserver?.observe(elements.canvas);
window.addEventListener("resize", updatePaperPattern);

elements.newNoteButton.addEventListener("click", () => {
  const note = createNote(elements.newPaperSizeSelect.value);
  notes = [note, ...notes];
  selectedId = note.id;
  redoStack = [];
  currentView = "editor";
  persistSoon();
  render();
  elements.titleInput.focus();
});

elements.backToListButton.addEventListener("click", () => {
  currentView = "list";
  currentStroke = null;
  persistNow();
  render();
  elements.searchInput.focus();
});

elements.deleteNoteButton.addEventListener("click", () => {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const label = note.title.trim() || "無題";
  const shouldDelete = window.confirm(`「${label}」を削除しますか？`);
  if (!shouldDelete) {
    return;
  }

  notes = notes.filter((item) => item.id !== note.id);

  if (notes.length === 0) {
    selectedId = null;
    currentView = "list";
  } else {
    selectedId = notes[0].id;
    currentView = "list";
  }

  redoStack = [];
  persistSoon();
  render();
});

elements.clearCanvasButton.addEventListener("click", () => {
  const note = getSelectedNote();
  if (!note || note.strokes.length === 0) {
    return;
  }

  const shouldClear = window.confirm("このページを消去しますか？");
  if (!shouldClear) {
    return;
  }

  note.strokes = [];
  note.updatedAt = new Date().toISOString();
  redoStack = [];
  persistSoon();
  render();
});

elements.undoButton.addEventListener("click", () => {
  const note = getSelectedNote();
  if (!note || note.strokes.length === 0) {
    return;
  }

  const stroke = note.strokes.pop();
  redoStack.push(stroke);
  note.updatedAt = new Date().toISOString();
  persistSoon();
  render();
});

elements.redoButton.addEventListener("click", () => {
  const note = getSelectedNote();
  const stroke = redoStack.pop();
  if (!note || !stroke) {
    return;
  }

  note.strokes.push(stroke);
  note.updatedAt = new Date().toISOString();
  persistSoon();
  render();
});

elements.penButton.addEventListener("click", () => {
  activeTool = "pen";
  updateToolButtons();
});

elements.eraserButton.addEventListener("click", () => {
  activeTool = "eraser";
  updateToolButtons();
});

elements.strokeWidthInput.addEventListener("input", () => {
  strokeWidth = Number(elements.strokeWidthInput.value);
});

elements.paperBackgroundSelect.addEventListener("change", () => {
  updatePaperBackground(elements.paperBackgroundSelect.value);
});

elements.zoomOutButton.addEventListener("click", () => {
  setCanvasZoom(canvasZoom - canvasZoomStep);
});

elements.zoomResetButton.addEventListener("click", () => {
  setCanvasZoom(1);
});

elements.zoomInButton.addEventListener("click", () => {
  setCanvasZoom(canvasZoom + canvasZoomStep);
});

for (const swatch of elements.swatches) {
  swatch.addEventListener("click", () => {
    activeColor = swatch.dataset.color;
    activeTool = "pen";
    updateToolButtons();
    updateSwatches();
  });
}

elements.searchInput.addEventListener("input", renderList);

elements.titleInput.addEventListener("input", () => {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  note.title = elements.titleInput.value;
  note.updatedAt = new Date().toISOString();
  persistSoon();
  renderList();
});

elements.canvas.addEventListener("pointerdown", startStroke);
elements.canvas.addEventListener("pointermove", continueStroke);
elements.canvas.addEventListener("pointerup", finishStroke);
elements.canvas.addEventListener("pointercancel", cancelStroke);
window.addEventListener("beforeunload", persistNow);

function createNote(size = defaultPaper.size) {
  const now = new Date().toISOString();
  const paperSize = paperSizes[size] ? size : defaultPaper.size;

  return {
    id: makeId(),
    title: "",
    paper: {
      ...defaultPaper,
      size: paperSize
    },
    strokes: [],
    createdAt: now,
    updatedAt: now
  };
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeNote).filter(Boolean);
      }
    }

    const legacyRaw = localStorage.getItem(legacyStorageKey);
    if (legacyRaw) {
      const parsedLegacy = JSON.parse(legacyRaw);
      if (Array.isArray(parsedLegacy)) {
        return parsedLegacy.map((note) => normalizeNote({
          ...note,
          strokes: []
        })).filter(Boolean);
      }
    }

    return [];
  } catch {
    return [];
  }
}

function normalizeNote(note) {
  if (!note || typeof note.id !== "string") {
    return null;
  }

  return {
    id: note.id,
    title: typeof note.title === "string" ? note.title : "",
    paper: normalizePaper(note.paper),
    strokes: Array.isArray(note.strokes) ? note.strokes.filter(isValidStroke) : [],
    createdAt: typeof note.createdAt === "string" ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString()
  };
}

function normalizePaper(paper) {
  const size = paperSizes[paper?.size] ? paper.size : defaultPaper.size;
  const background = paperBackgrounds.includes(paper?.background) ? paper.background : defaultPaper.background;

  return { size, background };
}

function isValidStroke(stroke) {
  return stroke
    && (stroke.tool === "pen" || stroke.tool === "eraser")
    && typeof stroke.color === "string"
    && typeof stroke.width === "number"
    && Array.isArray(stroke.points)
    && stroke.points.every(isValidPoint);
}

function isValidPoint(point) {
  return point
    && typeof point.x === "number"
    && typeof point.y === "number";
}

function getSelectedNote() {
  return notes.find((note) => note.id === selectedId) ?? null;
}

function sortNotes(items) {
  return [...items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function persistSoon() {
  elements.saveState.textContent = "保存中";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    persistNow();
    elements.saveState.textContent = "保存済み";
  }, 250);
}

function persistNow() {
  localStorage.setItem(storageKey, JSON.stringify(notes));
  if (selectedId) {
    localStorage.setItem(selectedKey, selectedId);
  } else {
    localStorage.removeItem(selectedKey);
  }
}

function render() {
  renderView();
  renderEditor();
  renderList();
  updateZoomControls();
  redrawCanvas();
  updateToolButtons();
  updateSwatches();
  updateActionButtons();
}

function renderView() {
  const showEditor = currentView === "editor" && Boolean(getSelectedNote());

  elements.listView.hidden = showEditor;
  elements.editorView.hidden = !showEditor;
  elements.skipLink.href = showEditor ? "#drawingCanvas" : "#noteList";
  elements.skipLink.textContent = showEditor ? "キャンバスへ移動" : "ノート一覧へ移動";

  if (!showEditor) {
    currentView = "list";
  }
}

function renderEditor() {
  const note = getSelectedNote();
  const hasNote = Boolean(note);

  elements.titleInput.disabled = !hasNote;
  elements.deleteNoteButton.disabled = !hasNote;
  elements.paperBackgroundSelect.disabled = !hasNote;
  elements.clearCanvasButton.disabled = !hasNote || note.strokes.length === 0;
  elements.titleInput.value = note?.title ?? "";

  if (note) {
    applyPaperToCanvas(note.paper);
    elements.paperBackgroundSelect.value = note.paper.background;
  }
}

function renderList() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  const filtered = sortNotes(notes).filter((note) => {
    const title = (note.title.trim() || "無題").toLocaleLowerCase();
    return title.includes(query);
  });

  elements.noteList.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = notes.length === 0 ? "ノートがありません" : "該当するノートはありません";
    elements.noteList.append(empty);
    return;
  }

  for (const note of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = note.id === selectedId ? "note-item active" : "note-item";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-current", note.id === selectedId ? "true" : "false");

    const title = document.createElement("div");
    title.className = "note-title";
    title.textContent = note.title.trim() || "無題";

    const date = document.createElement("div");
    date.className = "note-date";
    date.textContent = formatDate(note.updatedAt);

    button.setAttribute("aria-label", `${title.textContent}，${date.textContent}`);
    button.append(title, date);
    button.addEventListener("click", () => {
      selectedId = note.id;
      currentView = "editor";
      redoStack = [];
      persistNow();
      render();
      elements.canvas.focus();
    });

    elements.noteList.append(button);
  }
}

function updateToolButtons() {
  const penActive = activeTool === "pen";
  const eraserActive = activeTool === "eraser";

  elements.penButton.classList.toggle("active", penActive);
  elements.eraserButton.classList.toggle("active", eraserActive);
  elements.penButton.setAttribute("aria-pressed", String(penActive));
  elements.eraserButton.setAttribute("aria-pressed", String(eraserActive));
}

function updateSwatches() {
  for (const swatch of elements.swatches) {
    const active = swatch.dataset.color === activeColor;
    swatch.classList.toggle("active", active);
    swatch.setAttribute("aria-pressed", String(active));
  }
}

function updateActionButtons() {
  const note = getSelectedNote();
  elements.undoButton.disabled = !note || note.strokes.length === 0;
  elements.redoButton.disabled = redoStack.length === 0;
  elements.clearCanvasButton.disabled = !note || note.strokes.length === 0;
}

function setCanvasZoom(value) {
  const nextZoom = clamp(roundZoom(value), minCanvasZoom, maxCanvasZoom);
  if (nextZoom === canvasZoom) {
    updateZoomControls();
    return;
  }

  canvasZoom = nextZoom;
  updateZoomControls();
}

function roundZoom(value) {
  return Math.round(value * 100) / 100;
}

function updateZoomControls() {
  const hasNote = Boolean(getSelectedNote());
  const zoomPercent = Math.round(canvasZoom * 100);

  elements.canvas.style.width = `${zoomPercent}%`;
  elements.zoomValue.textContent = `${zoomPercent}%`;
  elements.zoomResetButton.setAttribute("aria-label", `表示倍率${zoomPercent}%。100%に戻す`);
  elements.zoomOutButton.disabled = !hasNote || canvasZoom <= minCanvasZoom;
  elements.zoomResetButton.disabled = !hasNote || canvasZoom === 1;
  elements.zoomInButton.disabled = !hasNote || canvasZoom >= maxCanvasZoom;
  updatePaperPattern();
}

function updatePaperBackground(background) {
  const note = getSelectedNote();
  if (!note || !paperBackgrounds.includes(background) || note.paper.background === background) {
    return;
  }

  note.paper.background = background;
  note.updatedAt = new Date().toISOString();
  persistSoon();
  render();
}

function applyPaperToCanvas(paper) {
  const normalizedPaper = normalizePaper(paper);
  const size = getPaperSize(normalizedPaper);

  if (elements.canvas.width !== size.width) {
    elements.canvas.width = size.width;
  }

  if (elements.canvas.height !== size.height) {
    elements.canvas.height = size.height;
  }

  elements.canvas.style.aspectRatio = `${size.width} / ${size.height}`;
  elements.canvas.dataset.background = normalizedPaper.background;
}

function getPaperSize(paper) {
  return paperSizes[paper?.size] ?? paperSizes[defaultPaper.size];
}

function startStroke(event) {
  const note = getSelectedNote();
  if (!note || event.button !== 0) {
    return;
  }

  event.preventDefault();
  elements.canvas.setPointerCapture(event.pointerId);

  const point = getCanvasPoint(event);
  currentStroke = {
    tool: activeTool,
    color: activeTool === "eraser" ? "#000000" : activeColor,
    width: activeTool === "eraser" ? strokeWidth * 3 : strokeWidth,
    points: [point]
  };

  redrawCanvas();
}

function continueStroke(event) {
  if (!currentStroke) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event);
  const lastPoint = currentStroke.points[currentStroke.points.length - 1];
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);

  if (distance >= 1.5) {
    currentStroke.points.push(point);
    redrawCanvas();
  }
}

function finishStroke(event) {
  if (!currentStroke) {
    return;
  }

  event.preventDefault();

  const note = getSelectedNote();
  if (note) {
    note.strokes.push(currentStroke);
    note.updatedAt = new Date().toISOString();
    notes = sortNotes(notes);
    redoStack = [];
    persistSoon();
  }

  currentStroke = null;
  if (elements.canvas.hasPointerCapture(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
  render();
}

function cancelStroke(event) {
  if (currentStroke && elements.canvas.hasPointerCapture(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }

  currentStroke = null;
  redrawCanvas();
}

function getCanvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();

  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * elements.canvas.width, 0, elements.canvas.width),
    y: clamp(((event.clientY - rect.top) / rect.height) * elements.canvas.height, 0, elements.canvas.height)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function redrawCanvas() {
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  syncStrokeLayerSize();
  strokeLayerContext.clearRect(0, 0, strokeLayer.width, strokeLayer.height);

  const note = getSelectedNote();
  if (note) {
    for (const stroke of note.strokes) {
      drawStroke(stroke, strokeLayerContext);
    }
  }

  if (currentStroke) {
    drawStroke(currentStroke, strokeLayerContext);
  }

  context.drawImage(strokeLayer, 0, 0);
}

function updatePaperPattern() {
  const rect = elements.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }

  const stepX = Math.max(8, Math.round((paperPatternSpacing / elements.canvas.width) * rect.width));
  const stepY = Math.max(8, Math.round((paperPatternSpacing / elements.canvas.height) * rect.height));

  elements.canvas.style.setProperty("--paper-step-x", `${stepX}px`);
  elements.canvas.style.setProperty("--paper-step-y", `${stepY}px`);
}

function syncStrokeLayerSize() {
  if (strokeLayer.width !== elements.canvas.width) {
    strokeLayer.width = elements.canvas.width;
  }

  if (strokeLayer.height !== elements.canvas.height) {
    strokeLayer.height = elements.canvas.height;
  }
}

function drawStroke(stroke, targetContext = context) {
  if (stroke.points.length === 0) {
    return;
  }

  targetContext.save();
  targetContext.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  targetContext.strokeStyle = stroke.color;
  targetContext.lineWidth = stroke.width;
  targetContext.lineCap = "round";
  targetContext.lineJoin = "round";

  const [firstPoint, ...restPoints] = stroke.points;
  targetContext.beginPath();
  targetContext.moveTo(firstPoint.x, firstPoint.y);

  if (restPoints.length === 0) {
    targetContext.lineTo(firstPoint.x + 0.1, firstPoint.y + 0.1);
  } else {
    for (let index = 0; index < restPoints.length; index += 1) {
      const current = restPoints[index];
      const next = restPoints[index + 1];

      if (next) {
        const midX = (current.x + next.x) / 2;
        const midY = (current.y + next.y) / 2;
        targetContext.quadraticCurveTo(current.x, current.y, midX, midY);
      } else {
        targetContext.lineTo(current.x, current.y);
      }
    }
  }

  targetContext.stroke();
  targetContext.restore();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
