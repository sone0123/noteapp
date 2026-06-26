const storageKey = "noteapp.web.handwritten.v1";
const legacyStorageKey = "noteapp.web.notes.v1";
const selectedKey = "noteapp.web.handwritten.selected.v1";

const canvasWidth = 1400;
const canvasHeight = 1900;

const elements = {
  newNoteButton: document.querySelector("#newNoteButton"),
  deleteNoteButton: document.querySelector("#deleteNoteButton"),
  clearCanvasButton: document.querySelector("#clearCanvasButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  penButton: document.querySelector("#penButton"),
  eraserButton: document.querySelector("#eraserButton"),
  strokeWidthInput: document.querySelector("#strokeWidthInput"),
  swatches: [...document.querySelectorAll(".swatch")],
  searchInput: document.querySelector("#searchInput"),
  noteList: document.querySelector("#noteList"),
  titleInput: document.querySelector("#titleInput"),
  canvas: document.querySelector("#drawingCanvas"),
  saveState: document.querySelector("#saveState")
};

const context = elements.canvas.getContext("2d");

let notes = loadNotes();
let selectedId = localStorage.getItem(selectedKey);
let saveTimer = null;
let currentStroke = null;
let activeTool = "pen";
let activeColor = "#202124";
let strokeWidth = Number(elements.strokeWidthInput.value);
let redoStack = [];

if (notes.length === 0) {
  const firstNote = createNote();
  notes = [firstNote];
  selectedId = firstNote.id;
  persistNow();
}

if (!notes.some((note) => note.id === selectedId)) {
  selectedId = notes[0]?.id ?? null;
}

render();

elements.newNoteButton.addEventListener("click", () => {
  const note = createNote();
  notes = [note, ...notes];
  selectedId = note.id;
  redoStack = [];
  persistSoon();
  render();
  elements.titleInput.focus();
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
    const nextNote = createNote();
    notes = [nextNote];
    selectedId = nextNote.id;
  } else {
    selectedId = notes[0].id;
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

function createNote() {
  const now = new Date().toISOString();

  return {
    id: makeId(),
    title: "",
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
    strokes: Array.isArray(note.strokes) ? note.strokes.filter(isValidStroke) : [],
    createdAt: typeof note.createdAt === "string" ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString()
  };
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
  }
}

function render() {
  renderEditor();
  renderList();
  redrawCanvas();
  updateToolButtons();
  updateSwatches();
  updateActionButtons();
}

function renderEditor() {
  const note = getSelectedNote();
  const hasNote = Boolean(note);

  elements.titleInput.disabled = !hasNote;
  elements.deleteNoteButton.disabled = !hasNote;
  elements.clearCanvasButton.disabled = !hasNote || note.strokes.length === 0;
  elements.titleInput.value = note?.title ?? "";
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
    empty.textContent = "該当するノートはありません";
    elements.noteList.append(empty);
    return;
  }

  for (const note of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = note.id === selectedId ? "note-item active" : "note-item";
    button.setAttribute("role", "listitem");

    const title = document.createElement("div");
    title.className = "note-title";
    title.textContent = note.title.trim() || "無題";

    const preview = document.createElement("div");
    preview.className = "note-preview";
    preview.textContent = `${note.strokes.length}本`;

    const date = document.createElement("div");
    date.className = "note-date";
    date.textContent = formatDate(note.updatedAt);

    button.append(title, preview, date);
    button.addEventListener("click", () => {
      selectedId = note.id;
      redoStack = [];
      persistNow();
      render();
      elements.canvas.focus();
    });

    elements.noteList.append(button);
  }
}

function updateToolButtons() {
  elements.penButton.classList.toggle("active", activeTool === "pen");
  elements.eraserButton.classList.toggle("active", activeTool === "eraser");
}

function updateSwatches() {
  for (const swatch of elements.swatches) {
    swatch.classList.toggle("active", swatch.dataset.color === activeColor);
  }
}

function updateActionButtons() {
  const note = getSelectedNote();
  elements.undoButton.disabled = !note || note.strokes.length === 0;
  elements.redoButton.disabled = redoStack.length === 0;
  elements.clearCanvasButton.disabled = !note || note.strokes.length === 0;
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
    x: clamp(((event.clientX - rect.left) / rect.width) * canvasWidth, 0, canvasWidth),
    y: clamp(((event.clientY - rect.top) / rect.height) * canvasHeight, 0, canvasHeight)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function redrawCanvas() {
  context.clearRect(0, 0, canvasWidth, canvasHeight);

  const note = getSelectedNote();
  if (note) {
    for (const stroke of note.strokes) {
      drawStroke(stroke);
    }
  }

  if (currentStroke) {
    drawStroke(currentStroke);
  }
}

function drawStroke(stroke) {
  if (stroke.points.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";

  const [firstPoint, ...restPoints] = stroke.points;
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);

  if (restPoints.length === 0) {
    context.lineTo(firstPoint.x + 0.1, firstPoint.y + 0.1);
  } else {
    for (let index = 0; index < restPoints.length; index += 1) {
      const current = restPoints[index];
      const next = restPoints[index + 1];

      if (next) {
        const midX = (current.x + next.x) / 2;
        const midY = (current.y + next.y) / 2;
        context.quadraticCurveTo(current.x, current.y, midX, midY);
      } else {
        context.lineTo(current.x, current.y);
      }
    }
  }

  context.stroke();
  context.restore();
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
