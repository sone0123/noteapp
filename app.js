const storageKey = "noteapp.web.handwritten.v1";
const legacyStorageKey = "noteapp.web.notes.v1";
const selectedKey = "noteapp.web.handwritten.selected.v1";

const paperSizes = {
  a4: { label: "A4", width: 1400, height: 1980 }
};
const paperBackgrounds = ["plain", "lined", "grid"];
const defaultPaper = { size: "a4", background: "grid" };
const paperPatternSpacing = 40;
const defaultStrokeWidth = 6;

const elements = {
  skipLink: document.querySelector(".skip-link"),
  listView: document.querySelector("#listView"),
  editorView: document.querySelector("#editorView"),
  newNoteButton: document.querySelector("#newNoteButton"),
  backToListButton: document.querySelector("#backToListButton"),
  clearCanvasButton: document.querySelector("#clearCanvasButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  penButton: document.querySelector("#penButton"),
  eraserButton: document.querySelector("#eraserButton"),
  previousPageButton: document.querySelector("#previousPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  addPageButton: document.querySelector("#addPageButton"),
  deletePageButton: document.querySelector("#deletePageButton"),
  pageState: document.querySelector("#pageState"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomValue: document.querySelector("#zoomValue"),
  paperBackgroundSelect: document.querySelector("#paperBackgroundSelect"),
  swatches: [...document.querySelectorAll(".swatch")],
  widthButtons: [...document.querySelectorAll(".width-option")],
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
let strokeWidth = defaultStrokeWidth;
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
  const note = createNote();
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

elements.clearCanvasButton.addEventListener("click", () => {
  const note = getSelectedNote();
  const page = getSelectedPage(note);
  if (!note || !page || page.strokes.length === 0) {
    return;
  }

  const shouldClear = window.confirm("このページを消去しますか？");
  if (!shouldClear) {
    return;
  }

  page.strokes = [];
  note.updatedAt = new Date().toISOString();
  redoStack = [];
  persistSoon();
  render();
});

elements.undoButton.addEventListener("click", () => {
  const note = getSelectedNote();
  const page = getSelectedPage(note);
  if (!note || !page || page.strokes.length === 0) {
    return;
  }

  const stroke = page.strokes.pop();
  redoStack.push(stroke);
  note.updatedAt = new Date().toISOString();
  persistSoon();
  render();
});

elements.redoButton.addEventListener("click", () => {
  const note = getSelectedNote();
  const page = getSelectedPage(note);
  const stroke = redoStack.pop();
  if (!note || !page || !stroke) {
    return;
  }

  page.strokes.push(stroke);
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

elements.paperBackgroundSelect.addEventListener("change", () => {
  updatePaperBackground(elements.paperBackgroundSelect.value);
});

elements.previousPageButton.addEventListener("click", () => {
  selectPageByOffset(-1);
});

elements.nextPageButton.addEventListener("click", () => {
  selectPageByOffset(1);
});

elements.addPageButton.addEventListener("click", addPage);

elements.deletePageButton.addEventListener("click", deleteCurrentPage);

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

for (const button of elements.widthButtons) {
  button.addEventListener("click", () => {
    strokeWidth = Number(button.dataset.width) || defaultStrokeWidth;
    updateWidthButtons();
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
  const firstPage = createPage();

  return {
    id: makeId(),
    title: "",
    paper: { ...defaultPaper },
    pages: [firstPage],
    selectedPageId: firstPage.id,
    createdAt: now,
    updatedAt: now
  };
}

function createPage(strokes = []) {
  return {
    id: makeId(),
    strokes
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

  const pages = normalizePages(note);
  const selectedPageId = pages.some((page) => page.id === note.selectedPageId)
    ? note.selectedPageId
    : pages[0].id;

  return {
    id: note.id,
    title: typeof note.title === "string" ? note.title : "",
    paper: normalizePaper(note.paper),
    pages,
    selectedPageId,
    createdAt: typeof note.createdAt === "string" ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString()
  };
}

function normalizePages(note) {
  const pageSources = Array.isArray(note.pages)
    ? note.pages
    : [{ id: makeId(), strokes: note.strokes }];
  const pages = pageSources.map(normalizePage).filter(Boolean);

  return pages.length > 0 ? pages : [createPage()];
}

function normalizePage(page) {
  if (!page || typeof page !== "object") {
    return null;
  }

  return {
    id: typeof page.id === "string" ? page.id : makeId(),
    strokes: Array.isArray(page.strokes) ? page.strokes.filter(isValidStroke) : []
  };
}

function normalizePaper(paper) {
  const background = paperBackgrounds.includes(paper?.background) ? paper.background : defaultPaper.background;

  return { size: defaultPaper.size, background };
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

function getSelectedPage(note = getSelectedNote()) {
  if (!note) {
    return null;
  }

  return note.pages.find((page) => page.id === note.selectedPageId) ?? note.pages[0] ?? null;
}

function getSelectedPageIndex(note = getSelectedNote()) {
  if (!note) {
    return -1;
  }

  return note.pages.findIndex((page) => page.id === note.selectedPageId);
}

function sortNotes(items) {
  return [...items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function persistSoon() {
  updateSaveState();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    persistNow();
    updateSaveState();
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

function updateSaveState(note = getSelectedNote()) {
  elements.saveState.textContent = note ? `最終更新 ${formatDate(note.updatedAt)}` : "最終更新 --";
}

function render() {
  renderView();
  renderEditor();
  renderList();
  updateZoomControls();
  redrawCanvas();
  updateToolButtons();
  updateSwatches();
  updateWidthButtons();
  updatePageControls();
  updateActionButtons();
  updateSaveState();
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
  const page = getSelectedPage(note);

  elements.titleInput.disabled = !hasNote;
  elements.paperBackgroundSelect.disabled = !hasNote;
  elements.clearCanvasButton.disabled = !hasNote || !page || page.strokes.length === 0;
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
    const item = document.createElement("div");
    item.className = note.id === selectedId ? "note-item active" : "note-item";
    item.setAttribute("role", "listitem");

    const title = document.createElement("div");
    title.className = "note-title";
    title.textContent = note.title.trim() || "無題";

    const meta = document.createElement("div");
    meta.className = "note-meta";

    const date = document.createElement("div");
    date.className = "note-date";
    date.textContent = formatDate(note.updatedAt);

    const pages = document.createElement("div");
    pages.className = "note-pages";
    pages.textContent = `${note.pages.length}ページ`;

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "note-open";
    openButton.setAttribute("aria-current", note.id === selectedId ? "true" : "false");
    openButton.setAttribute("aria-label", `${title.textContent}，${date.textContent}`);
    meta.append(date, pages);
    openButton.append(title, meta);
    openButton.addEventListener("click", () => {
      selectedId = note.id;
      currentView = "editor";
      currentStroke = null;
      redoStack = [];
      persistNow();
      render();
      elements.canvas.focus();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "icon-button danger note-delete";
    deleteButton.title = "ノート削除";
    deleteButton.setAttribute("aria-label", `${title.textContent}を削除`);
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"></path>
      </svg>
    `;
    deleteButton.addEventListener("click", () => {
      deleteNote(note.id);
    });

    item.append(openButton, deleteButton);
    elements.noteList.append(item);
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

function updateWidthButtons() {
  for (const button of elements.widthButtons) {
    const active = Number(button.dataset.width) === strokeWidth;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function updatePageControls() {
  const note = getSelectedNote();
  const pageIndex = getSelectedPageIndex(note);
  const pageCount = note?.pages.length ?? 0;
  const pageNumber = pageIndex >= 0 ? pageIndex + 1 : 0;

  elements.pageState.textContent = pageCount > 0 ? `${pageNumber} / ${pageCount}` : "0 / 0";
  elements.previousPageButton.disabled = !note || pageIndex <= 0;
  elements.nextPageButton.disabled = !note || pageIndex < 0 || pageIndex >= pageCount - 1;
  elements.addPageButton.disabled = !note;
  elements.deletePageButton.disabled = !note || pageCount <= 1;
}

function updateActionButtons() {
  const note = getSelectedNote();
  const page = getSelectedPage(note);
  elements.undoButton.disabled = !note || !page || page.strokes.length === 0;
  elements.redoButton.disabled = redoStack.length === 0;
  elements.clearCanvasButton.disabled = !note || !page || page.strokes.length === 0;
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

function deleteNote(noteId) {
  const note = notes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  const label = note.title.trim() || "無題";
  const shouldDelete = window.confirm(`「${label}」を削除しますか？`);
  if (!shouldDelete) {
    return;
  }

  notes = notes.filter((item) => item.id !== noteId);
  if (selectedId === noteId) {
    selectedId = notes[0]?.id ?? null;
  }

  currentView = "list";
  currentStroke = null;
  redoStack = [];
  persistSoon();
  render();
  elements.searchInput.focus();
}

function selectPageByOffset(offset) {
  const note = getSelectedNote();
  const pageIndex = getSelectedPageIndex(note);
  if (!note || pageIndex < 0) {
    return;
  }

  const nextIndex = clamp(pageIndex + offset, 0, note.pages.length - 1);
  const nextPage = note.pages[nextIndex];
  if (!nextPage || nextPage.id === note.selectedPageId) {
    return;
  }

  note.selectedPageId = nextPage.id;
  currentStroke = null;
  redoStack = [];
  persistNow();
  render();
  elements.canvas.focus();
}

function addPage() {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const page = createPage();
  note.pages.push(page);
  note.selectedPageId = page.id;
  note.updatedAt = new Date().toISOString();
  currentStroke = null;
  redoStack = [];
  persistSoon();
  render();
  elements.canvas.focus();
}

function deleteCurrentPage() {
  const note = getSelectedNote();
  const pageIndex = getSelectedPageIndex(note);
  if (!note || pageIndex < 0 || note.pages.length <= 1) {
    return;
  }

  const shouldDelete = window.confirm("このページを削除しますか？");
  if (!shouldDelete) {
    return;
  }

  note.pages.splice(pageIndex, 1);
  const nextIndex = Math.min(pageIndex, note.pages.length - 1);
  note.selectedPageId = note.pages[nextIndex].id;
  note.updatedAt = new Date().toISOString();
  currentStroke = null;
  redoStack = [];
  persistSoon();
  render();
  elements.canvas.focus();
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
  const page = getSelectedPage(note);
  if (!note || !page || event.button !== 0) {
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
  const page = getSelectedPage(note);
  if (note && page) {
    page.strokes.push(currentStroke);
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
  const page = getSelectedPage(note);
  if (page) {
    for (const stroke of page.strokes) {
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
