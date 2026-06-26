const storageKey = "noteapp.web.handwritten.v1";
const legacyStorageKey = "noteapp.web.notes.v1";
const selectedKey = "noteapp.web.handwritten.selected.v1";

const paperSizes = {
  a4: { label: "A4", width: 1400, height: 1980 }
};
const fixedPaper = { size: "a4", background: "lined" };
const paperPatternSpacing = 40;
const fixedStrokeWidth = 3;

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
  deletePageButton: document.querySelector("#deletePageButton"),
  pageState: document.querySelector("#pageState"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomValue: document.querySelector("#zoomValue"),
  swatches: [...document.querySelectorAll(".swatch")],
  searchInput: document.querySelector("#searchInput"),
  noteList: document.querySelector("#noteList"),
  titleInput: document.querySelector("#titleInput"),
  canvasShell: document.querySelector(".canvas-shell"),
  pageStack: document.querySelector("#pageStack"),
  saveState: document.querySelector("#saveState")
};

const pageStackResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(updatePaperPatterns)
  : null;
const pageAnalysisCanvas = document.createElement("canvas");
const pageAnalysisContext = pageAnalysisCanvas.getContext("2d", { willReadFrequently: true });

let notes = loadNotes();
let selectedId = localStorage.getItem(selectedKey);
let saveTimer = null;
let currentStroke = null;
let activeTool = "pen";
let activeColor = "#202124";
let redoStack = [];
let currentView = "list";
let canvasZoom = 1;
let visiblePageSelectionFrame = null;

const minCanvasZoom = 0.5;
const maxCanvasZoom = 2;
const canvasZoomStep = 0.25;

if (!notes.some((note) => note.id === selectedId)) {
  selectedId = notes[0]?.id ?? null;
}

render();

pageStackResizeObserver?.observe(elements.pageStack);
elements.canvasShell.addEventListener("scroll", scheduleVisiblePageSelection, { passive: true });
window.addEventListener("resize", () => {
  updatePaperPatterns();
  scheduleVisiblePageSelection();
});

elements.newNoteButton.addEventListener("click", () => {
  const note = createNote();
  notes = [note, ...notes];
  selectedId = note.id;
  currentStroke = null;
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
  normalizeAutoPages(note);
  note.updatedAt = new Date().toISOString();
  currentStroke = null;
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
  redoStack.push({ pageId: page.id, stroke });
  normalizeAutoPages(note);
  note.updatedAt = new Date().toISOString();
  persistSoon();
  render();
});

elements.redoButton.addEventListener("click", () => {
  const note = getSelectedNote();
  const redo = redoStack.pop();
  if (!note || !redo) {
    return;
  }

  const page = getPageById(note, redo.pageId);
  if (!page) {
    render();
    return;
  }

  note.selectedPageId = page.id;
  page.strokes.push(redo.stroke);
  normalizeAutoPages(note, page.id);
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

window.addEventListener("beforeunload", persistNow);

function createNote() {
  const now = new Date().toISOString();
  const firstPage = createPage();

  return {
    id: makeId(),
    title: "",
    paper: { ...fixedPaper },
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

  return normalizeAutoPages({
    id: note.id,
    title: typeof note.title === "string" ? note.title : "",
    paper: { ...fixedPaper },
    pages,
    selectedPageId,
    createdAt: typeof note.createdAt === "string" ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString()
  }, selectedPageId);
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

function normalizeAutoPages(note, preferredPageId = note?.selectedPageId) {
  if (!note) {
    return note;
  }

  if (!Array.isArray(note.pages) || note.pages.length === 0) {
    note.pages = [createPage()];
  }

  while (
    note.pages.length > 1
    && !hasPageDrawing(note.pages[note.pages.length - 1])
    && !hasPageDrawing(note.pages[note.pages.length - 2])
  ) {
    note.pages.pop();
  }

  if (hasPageDrawing(note.pages[note.pages.length - 1])) {
    note.pages.push(createPage());
  }

  if (note.pages.some((page) => page.id === preferredPageId)) {
    note.selectedPageId = preferredPageId;
  } else if (!note.pages.some((page) => page.id === note.selectedPageId)) {
    note.selectedPageId = note.pages[note.pages.length - 1].id;
  }

  return note;
}

function hasPageDrawing(page) {
  if (!page?.strokes.some((stroke) => stroke.tool === "pen")) {
    return false;
  }

  const size = getPaperSize();
  if (pageAnalysisCanvas.width !== size.width) {
    pageAnalysisCanvas.width = size.width;
  }

  if (pageAnalysisCanvas.height !== size.height) {
    pageAnalysisCanvas.height = size.height;
  }

  pageAnalysisContext.clearRect(0, 0, pageAnalysisCanvas.width, pageAnalysisCanvas.height);
  for (const stroke of page.strokes) {
    drawStroke(stroke, pageAnalysisContext);
  }

  const pixels = pageAnalysisContext.getImageData(0, 0, pageAnalysisCanvas.width, pageAnalysisCanvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) {
      return true;
    }
  }

  return false;
}

function isValidStroke(stroke) {
  return stroke
    && (stroke.tool === "pen" || stroke.tool === "eraser")
    && typeof stroke.color === "string"
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

  return getPageById(note, note.selectedPageId) ?? note.pages[0] ?? null;
}

function getPageById(note, pageId) {
  return note?.pages.find((page) => page.id === pageId) ?? null;
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
  redrawCanvases();
  updateToolButtons();
  updateSwatches();
  updatePageControls();
  updateActionButtons();
  updateSaveState();
}

function renderView() {
  const showEditor = currentView === "editor" && Boolean(getSelectedNote());

  elements.listView.hidden = showEditor;
  elements.editorView.hidden = !showEditor;
  elements.skipLink.href = showEditor ? "#pageStack" : "#noteList";
  elements.skipLink.textContent = showEditor ? "ページへ移動" : "ノート一覧へ移動";

  if (!showEditor) {
    currentView = "list";
  }
}

function renderEditor() {
  const note = getSelectedNote();
  const hasNote = Boolean(note);
  const page = getSelectedPage(note);

  elements.titleInput.disabled = !hasNote;
  elements.clearCanvasButton.disabled = !hasNote || !page || page.strokes.length === 0;
  elements.titleInput.value = note?.title ?? "";
  renderPageStack(note);
}

function renderPageStack(note) {
  elements.pageStack.replaceChildren();
  if (!note) {
    return;
  }

  const size = getPaperSize();
  note.pages.forEach((page, index) => {
    const canvas = document.createElement("canvas");
    canvas.className = page.id === note.selectedPageId ? "drawing-canvas active" : "drawing-canvas";
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.dataset.pageId = page.id;
    canvas.dataset.background = fixedPaper.background;
    canvas.style.aspectRatio = `${size.width} / ${size.height}`;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", `ページ ${index + 1}`);
    canvas.addEventListener("pointerdown", startStroke);
    canvas.addEventListener("pointermove", continueStroke);
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", cancelStroke);
    canvas.addEventListener("focus", () => {
      selectPage(page.id);
    });

    elements.pageStack.append(canvas);
  });
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
      focusSelectedPage();
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

function updatePageControls() {
  const note = getSelectedNote();
  const pageIndex = getSelectedPageIndex(note);
  const pageCount = note?.pages.length ?? 0;
  const pageNumber = pageIndex >= 0 ? pageIndex + 1 : 0;
  const page = getSelectedPage(note);
  const selectedPageIsAutoBlank = Boolean(
    note
    && page
    && pageIndex === pageCount - 1
    && !hasPageDrawing(page)
  );

  elements.pageState.textContent = pageCount > 0 ? `${pageNumber} / ${pageCount}` : "0 / 0";
  elements.deletePageButton.disabled = !note || pageCount <= 1 || selectedPageIsAutoBlank;
  updatePageSelection();
}

function updatePageSelection() {
  const note = getSelectedNote();
  for (const canvas of getPageCanvases()) {
    canvas.classList.toggle("active", Boolean(note) && canvas.dataset.pageId === note.selectedPageId);
  }
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
  scheduleVisiblePageSelection();
}

function roundZoom(value) {
  return Math.round(value * 100) / 100;
}

function updateZoomControls() {
  const hasNote = Boolean(getSelectedNote());
  const zoomPercent = Math.round(canvasZoom * 100);

  for (const canvas of getPageCanvases()) {
    canvas.style.width = `${zoomPercent}%`;
  }

  elements.zoomValue.textContent = `${zoomPercent}%`;
  elements.zoomResetButton.setAttribute("aria-label", `表示倍率${zoomPercent}%。100%に戻す`);
  elements.zoomOutButton.disabled = !hasNote || canvasZoom <= minCanvasZoom;
  elements.zoomResetButton.disabled = !hasNote || canvasZoom === 1;
  elements.zoomInButton.disabled = !hasNote || canvasZoom >= maxCanvasZoom;
  updatePaperPatterns();
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

function selectPage(pageId) {
  const note = getSelectedNote();
  if (!note || note.selectedPageId === pageId || !getPageById(note, pageId)) {
    return;
  }

  note.selectedPageId = pageId;
  redoStack = [];
  updatePageControls();
  updateActionButtons();
}

function scheduleVisiblePageSelection() {
  if (visiblePageSelectionFrame !== null) {
    return;
  }

  visiblePageSelectionFrame = window.requestAnimationFrame(() => {
    visiblePageSelectionFrame = null;
    selectMostlyVisiblePage();
  });
}

function selectMostlyVisiblePage() {
  const note = getSelectedNote();
  if (currentView !== "editor" || !note || currentStroke) {
    return;
  }

  const shellRect = elements.canvasShell.getBoundingClientRect();
  const shellHeight = shellRect.height;
  if (shellHeight <= 0) {
    return;
  }

  let bestPageId = null;
  let bestVisibleRatio = 0;

  for (const canvas of getPageCanvases()) {
    const rect = canvas.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, shellRect.top);
    const visibleBottom = Math.min(rect.bottom, shellRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const visibleRatio = visibleHeight / shellHeight;

    if (visibleRatio >= 0.5 && visibleRatio > bestVisibleRatio) {
      bestPageId = canvas.dataset.pageId;
      bestVisibleRatio = visibleRatio;
    }
  }

  if (bestPageId && bestPageId !== note.selectedPageId) {
    note.selectedPageId = bestPageId;
    updatePageControls();
    updateActionButtons();
  }
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
  normalizeAutoPages(note, note.selectedPageId);
  note.updatedAt = new Date().toISOString();
  currentStroke = null;
  redoStack = [];
  persistSoon();
  render();
  focusSelectedPage();
}

function getPaperSize() {
  return paperSizes[fixedPaper.size];
}

function startStroke(event) {
  const note = getSelectedNote();
  const canvas = event.currentTarget;
  const page = getPageById(note, canvas.dataset.pageId);
  if (!note || !page || event.button !== 0) {
    return;
  }

  event.preventDefault();
  selectPage(page.id);
  canvas.setPointerCapture(event.pointerId);

  const point = getCanvasPoint(event, canvas);
  currentStroke = {
    pageId: page.id,
    canvas,
    stroke: {
      tool: activeTool,
      color: activeTool === "eraser" ? "#000000" : activeColor,
      width: activeTool === "eraser" ? fixedStrokeWidth * 3 : fixedStrokeWidth,
      points: [point]
    }
  };

  redrawPage(page.id);
}

function continueStroke(event) {
  if (!currentStroke || event.currentTarget !== currentStroke.canvas) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event, currentStroke.canvas);
  const lastPoint = currentStroke.stroke.points[currentStroke.stroke.points.length - 1];
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);

  if (distance >= 1.5) {
    currentStroke.stroke.points.push(point);
    redrawPage(currentStroke.pageId);
  }
}

function finishStroke(event) {
  if (!currentStroke || event.currentTarget !== currentStroke.canvas) {
    return;
  }

  event.preventDefault();

  const note = getSelectedNote();
  const page = getPageById(note, currentStroke.pageId);
  if (note && page) {
    page.strokes.push(currentStroke.stroke);
    normalizeAutoPages(note, page.id);
    note.updatedAt = new Date().toISOString();
    notes = sortNotes(notes);
    redoStack = [];
    persistSoon();
  }

  if (currentStroke.canvas.hasPointerCapture(event.pointerId)) {
    currentStroke.canvas.releasePointerCapture(event.pointerId);
  }

  currentStroke = null;
  render();
}

function cancelStroke(event) {
  const canvas = currentStroke?.canvas;
  const pageId = currentStroke?.pageId;

  if (canvas?.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  currentStroke = null;
  if (pageId) {
    redrawPage(pageId);
  }
}

function getCanvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
    y: clamp(((event.clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function redrawCanvases() {
  for (const canvas of getPageCanvases()) {
    redrawPage(canvas.dataset.pageId);
  }
}

function redrawPage(pageId) {
  const note = getSelectedNote();
  const page = getPageById(note, pageId);
  const canvas = getPageCanvas(pageId);
  if (!page || !canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const stroke of page.strokes) {
    drawStroke(stroke, context);
  }

  if (currentStroke?.pageId === pageId) {
    drawStroke(currentStroke.stroke, context);
  }
}

function updatePaperPatterns() {
  for (const canvas of getPageCanvases()) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }

    const stepX = Math.max(8, Math.round((paperPatternSpacing / canvas.width) * rect.width));
    const stepY = Math.max(8, Math.round((paperPatternSpacing / canvas.height) * rect.height));

    canvas.style.setProperty("--paper-step-x", `${stepX}px`);
    canvas.style.setProperty("--paper-step-y", `${stepY}px`);
  }
}

function drawStroke(stroke, targetContext) {
  if (stroke.points.length === 0) {
    return;
  }

  targetContext.save();
  targetContext.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  targetContext.strokeStyle = stroke.color;
  targetContext.lineWidth = stroke.tool === "eraser" ? fixedStrokeWidth * 3 : fixedStrokeWidth;
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

function getPageCanvases() {
  return [...elements.pageStack.querySelectorAll(".drawing-canvas")];
}

function getPageCanvas(pageId) {
  return getPageCanvases().find((canvas) => canvas.dataset.pageId === pageId) ?? null;
}

function focusSelectedPage() {
  window.requestAnimationFrame(() => {
    const page = getSelectedPage();
    const canvas = page ? getPageCanvas(page.id) : null;
    canvas?.focus();
    canvas?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
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
