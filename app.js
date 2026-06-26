const storageKey = "noteapp.web.handwritten.v1";
const legacyStorageKey = "noteapp.web.notes.v1";
const selectedKey = "noteapp.web.handwritten.selected.v1";

const paperSizes = {
  a4: { label: "A4", width: 1400, height: 1980 }
};
const fixedPaper = { size: "a4", background: "lined" };
const paperPatternSpacing = 40;
const fixedStrokeWidth = 3;
const strokeEraserScreenRadius = 9;

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
  strokeEraserButton: document.querySelector("#strokeEraserButton"),
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
let undoStack = [];
let redoStack = [];
let currentView = "list";
let canvasZoom = 1;
let visiblePageSelectionFrame = null;
let stylusModeActive = false;
let touchScrollGesture = null;

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
  clearHistory();
  currentView = "editor";
  persistSoon();
  render();
});

elements.backToListButton.addEventListener("click", () => {
  currentView = "list";
  currentStroke = null;
  persistNow();
  render();
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
  clearHistory();
  persistSoon();
  render();
});

elements.undoButton.addEventListener("click", undoLastAction);

elements.redoButton.addEventListener("click", redoLastAction);

elements.penButton.addEventListener("click", () => {
  activeTool = "pen";
  updateToolButtons();
});

elements.eraserButton.addEventListener("click", () => {
  activeTool = "eraser";
  updateToolButtons();
});

elements.strokeEraserButton.addEventListener("click", () => {
  activeTool = "stroke-eraser";
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
elements.editorView.addEventListener("selectstart", preventEditorSelectionInStylusMode);
elements.editorView.addEventListener("touchstart", clearEditorSelectionInStylusMode, { passive: true });

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

function clearHistory() {
  undoStack = [];
  redoStack = [];
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
  updateInputMode();
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
    canvas.addEventListener("contextmenu", preventCanvasGestureMenu);
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
      clearHistory();
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
  const strokeEraserActive = activeTool === "stroke-eraser";

  elements.penButton.classList.toggle("active", penActive);
  elements.eraserButton.classList.toggle("active", eraserActive);
  elements.strokeEraserButton.classList.toggle("active", strokeEraserActive);
  elements.penButton.setAttribute("aria-pressed", String(penActive));
  elements.eraserButton.setAttribute("aria-pressed", String(eraserActive));
  elements.strokeEraserButton.setAttribute("aria-pressed", String(strokeEraserActive));
  elements.pageStack.dataset.tool = activeTool;
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
  const hasFallbackUndo = Boolean(page && page.strokes.length > 0);
  elements.undoButton.disabled = !note || (!hasFallbackUndo && undoStack.length === 0);
  elements.redoButton.disabled = redoStack.length === 0;
  elements.clearCanvasButton.disabled = !note || !page || page.strokes.length === 0;
}

function undoLastAction() {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const action = undoStack.pop();
  if (action) {
    if (undoAction(note, action)) {
      redoStack.push(action);
      completeHistoryMutation(note, action.pageId);
    } else {
      render();
    }
    return;
  }

  const page = getSelectedPage(note);
  if (!page || page.strokes.length === 0) {
    return;
  }

  const stroke = page.strokes.pop();
  redoStack.push({
    type: "add-stroke",
    pageId: page.id,
    pageIndex: note.pages.findIndex((item) => item.id === page.id),
    stroke
  });
  completeHistoryMutation(note, page.id);
}

function redoLastAction() {
  const note = getSelectedNote();
  const action = redoStack.pop();
  if (!note || !action) {
    return;
  }

  if (redoAction(note, action)) {
    undoStack.push(action);
    completeHistoryMutation(note, action.pageId);
  } else {
    render();
  }
}

function pushUndoAction(action) {
  undoStack.push(action);
  redoStack = [];
}

function completeHistoryMutation(note, preferredPageId) {
  normalizeAutoPages(note, preferredPageId);
  note.updatedAt = new Date().toISOString();
  notes = sortNotes(notes);
  persistSoon();
  render();
}

function undoAction(note, action) {
  if (action.type === "add-stroke") {
    const page = getHistoryPage(note, action);
    if (!page) {
      return false;
    }

    const strokeIndex = findStrokeIndex(page, action.stroke);
    if (strokeIndex === -1) {
      return false;
    }

    page.strokes.splice(strokeIndex, 1);
    return true;
  }

  if (action.type === "delete-strokes") {
    const page = getHistoryPage(note, action, true);
    if (!page) {
      return false;
    }

    restoreDeletedStrokes(page, action.deleted);
    return true;
  }

  return false;
}

function redoAction(note, action) {
  if (action.type === "add-stroke") {
    const page = getHistoryPage(note, action, true);
    if (!page) {
      return false;
    }

    note.selectedPageId = page.id;
    page.strokes.push(action.stroke);
    return true;
  }

  if (action.type === "delete-strokes") {
    const page = getHistoryPage(note, action);
    if (!page) {
      return false;
    }

    note.selectedPageId = page.id;
    return removeDeletedStrokes(page, action.deleted);
  }

  return false;
}

function getHistoryPage(note, action, createIfMissing = false) {
  let page = getPageById(note, action.pageId);
  if (page || !createIfMissing) {
    return page;
  }

  page = { id: action.pageId, strokes: [] };
  const pageIndex = Number.isInteger(action.pageIndex)
    ? clamp(action.pageIndex, 0, note.pages.length)
    : note.pages.length;
  note.pages.splice(pageIndex, 0, page);

  return page;
}

function findStrokeIndex(page, stroke) {
  const directIndex = page.strokes.lastIndexOf(stroke);
  if (directIndex !== -1) {
    return directIndex;
  }

  const lastIndex = page.strokes.length - 1;
  return strokesMatch(page.strokes[lastIndex], stroke) ? lastIndex : -1;
}

function restoreDeletedStrokes(page, deletedStrokes) {
  const sortedStrokes = [...deletedStrokes].sort((a, b) => a.index - b.index);
  for (const item of sortedStrokes) {
    page.strokes.splice(clamp(item.index, 0, page.strokes.length), 0, item.stroke);
  }
}

function removeDeletedStrokes(page, deletedStrokes) {
  let removed = false;
  const sortedStrokes = [...deletedStrokes].sort((a, b) => b.index - a.index);

  for (const item of sortedStrokes) {
    if (page.strokes[item.index] === item.stroke || strokesMatch(page.strokes[item.index], item.stroke)) {
      page.strokes.splice(item.index, 1);
      removed = true;
      continue;
    }

    const strokeIndex = findStrokeIndex(page, item.stroke);
    if (strokeIndex !== -1) {
      page.strokes.splice(strokeIndex, 1);
      removed = true;
    }
  }

  return removed;
}

function strokesMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.tool === right.tool
    && left.color === right.color
    && left.width === right.width
    && JSON.stringify(left.points) === JSON.stringify(right.points);
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
  clearHistory();
  persistSoon();
  render();
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
  clearHistory();
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

  if (event.pointerType === "pen") {
    activateStylusMode();
  }

  if (event.pointerType === "touch") {
    if (currentStroke || touchScrollGesture) {
      preventIgnoredCanvasInput(event);
      return;
    }

    beginTouchScroll(event, canvas);
    return;
  }

  if (currentStroke || !canUsePointerForDrawing(event)) {
    preventIgnoredCanvasInput(event);
    return;
  }

  event.preventDefault();
  elements.titleInput.blur();
  clearTextSelection();
  selectPage(page.id);
  canvas.setPointerCapture(event.pointerId);

  const point = getCanvasPoint(event, canvas);
  if (activeTool === "stroke-eraser") {
    currentStroke = {
      type: "stroke-eraser",
      pageId: page.id,
      canvas,
      pointerId: event.pointerId,
      deleted: []
    };
    eraseStrokesAtPoint(page, point, canvas, currentStroke.deleted);
    return;
  }

  currentStroke = {
    type: "draw",
    pageId: page.id,
    canvas,
    pointerId: event.pointerId,
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
  if (isTouchScrollPointer(event)) {
    continueTouchScroll(event);
    return;
  }

  if (!isCurrentStrokePointer(event)) {
    preventIgnoredCanvasInput(event);
    return;
  }

  event.preventDefault();

  if (currentStroke.type === "stroke-eraser") {
    const note = getSelectedNote();
    const page = getPageById(note, currentStroke.pageId);
    if (page) {
      eraseStrokesAtPoint(page, getCanvasPoint(event, currentStroke.canvas), currentStroke.canvas, currentStroke.deleted);
    }
    return;
  }

  const point = getCanvasPoint(event, currentStroke.canvas);
  const lastPoint = currentStroke.stroke.points[currentStroke.stroke.points.length - 1];
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);

  if (distance >= 1.5) {
    currentStroke.stroke.points.push(point);
    redrawPage(currentStroke.pageId);
  }
}

function finishStroke(event) {
  if (isTouchScrollPointer(event)) {
    finishTouchScroll(event);
    return;
  }

  if (!isCurrentStrokePointer(event)) {
    preventIgnoredCanvasInput(event);
    return;
  }

  event.preventDefault();
  const strokeAction = currentStroke;

  const note = getSelectedNote();
  const page = getPageById(note, strokeAction.pageId);

  if (strokeAction.canvas.hasPointerCapture(event.pointerId)) {
    strokeAction.canvas.releasePointerCapture(event.pointerId);
  }

  currentStroke = null;

  if (strokeAction.type === "stroke-eraser") {
    finishStrokeErase(strokeAction);
    return;
  }

  if (note && page) {
    const pageIndex = note.pages.findIndex((item) => item.id === page.id);
    page.strokes.push(strokeAction.stroke);
    normalizeAutoPages(note, page.id);
    note.updatedAt = new Date().toISOString();
    notes = sortNotes(notes);
    pushUndoAction({
      type: "add-stroke",
      pageId: page.id,
      pageIndex,
      stroke: strokeAction.stroke
    });
    persistSoon();
  }

  render();
}

function cancelStroke(event) {
  if (isTouchScrollPointer(event)) {
    finishTouchScroll(event);
    return;
  }

  if (!isCurrentStrokePointer(event)) {
    preventIgnoredCanvasInput(event);
    return;
  }

  const strokeAction = currentStroke;
  const canvas = strokeAction?.canvas;
  const pageId = strokeAction?.pageId;

  if (canvas?.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  currentStroke = null;
  if (strokeAction?.type === "stroke-eraser") {
    finishStrokeErase(strokeAction);
    return;
  }

  if (pageId) {
    redrawPage(pageId);
  }
}

function canUsePointerForDrawing(event) {
  return event.pointerType !== "touch";
}

function beginTouchScroll(event, canvas) {
  event.preventDefault();
  clearEditorSelectionInStylusMode();
  touchScrollGesture = {
    pointerId: event.pointerId,
    canvas,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: elements.canvasShell.scrollLeft,
    scrollTop: elements.canvasShell.scrollTop
  };
  canvas.setPointerCapture(event.pointerId);
}

function continueTouchScroll(event) {
  event.preventDefault();
  const deltaX = event.clientX - touchScrollGesture.startX;
  const deltaY = event.clientY - touchScrollGesture.startY;
  elements.canvasShell.scrollLeft = touchScrollGesture.scrollLeft - deltaX;
  elements.canvasShell.scrollTop = touchScrollGesture.scrollTop - deltaY;
}

function finishTouchScroll(event) {
  event.preventDefault();
  const gesture = touchScrollGesture;
  if (gesture?.canvas.hasPointerCapture(event.pointerId)) {
    gesture.canvas.releasePointerCapture(event.pointerId);
  }

  touchScrollGesture = null;
}

function isTouchScrollPointer(event) {
  return Boolean(
    touchScrollGesture
    && event.currentTarget === touchScrollGesture.canvas
    && event.pointerId === touchScrollGesture.pointerId
  );
}

function isCurrentStrokePointer(event) {
  return Boolean(
    currentStroke
    && event.currentTarget === currentStroke.canvas
    && event.pointerId === currentStroke.pointerId
  );
}

function preventIgnoredCanvasInput(event) {
  clearEditorSelectionInStylusMode();
  event.preventDefault();
}

function preventCanvasGestureMenu(event) {
  event.preventDefault();
}

function activateStylusMode() {
  if (!stylusModeActive) {
    stylusModeActive = true;
    updateInputMode();
  }
}

function updateInputMode() {
  elements.editorView.dataset.inputMode = stylusModeActive ? "stylus" : "default";
}

function preventEditorSelectionInStylusMode(event) {
  if (!stylusModeActive) {
    return;
  }

  event.preventDefault();
  clearTextSelection();
}

function clearEditorSelectionInStylusMode() {
  if (stylusModeActive) {
    clearTextSelection();
  }
}

function clearTextSelection() {
  const selection = globalThis.getSelection?.();
  if (selection && !selection.isCollapsed) {
    selection.removeAllRanges();
  }
}

function finishStrokeErase(strokeAction) {
  const note = getSelectedNote();
  const page = getPageById(note, strokeAction.pageId);
  if (!note || !page || strokeAction.deleted.length === 0) {
    render();
    return;
  }

  const pageIndex = note.pages.findIndex((item) => item.id === page.id);
  strokeAction.deleted.sort((a, b) => a.index - b.index);
  normalizeAutoPages(note, page.id);
  note.updatedAt = new Date().toISOString();
  notes = sortNotes(notes);
  pushUndoAction({
    type: "delete-strokes",
    pageId: page.id,
    pageIndex,
    deleted: strokeAction.deleted
  });
  persistSoon();
  render();
}

function eraseStrokesAtPoint(page, point, canvas, deletedStrokes) {
  const hitRadius = getStrokeEraserRadius(canvas);
  let erased = false;

  for (let index = page.strokes.length - 1; index >= 0; index -= 1) {
    const stroke = page.strokes[index];
    if (stroke.tool !== "pen" || !strokeHitsPoint(stroke, point, hitRadius)) {
      continue;
    }

    deletedStrokes.push({
      index: getOriginalStrokeIndex(index, deletedStrokes),
      stroke
    });
    page.strokes.splice(index, 1);
    erased = true;
  }

  if (erased) {
    redrawPage(page.id);
  }

  return erased;
}

function getOriginalStrokeIndex(currentIndex, deletedStrokes) {
  let originalIndex = currentIndex;
  const deletedIndexes = deletedStrokes.map((item) => item.index).sort((a, b) => a - b);

  for (const deletedIndex of deletedIndexes) {
    if (deletedIndex <= originalIndex) {
      originalIndex += 1;
    }
  }

  return originalIndex;
}

function getStrokeEraserRadius(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0) {
    return fixedStrokeWidth * 6;
  }

  return (strokeEraserScreenRadius / rect.width) * canvas.width;
}

function strokeHitsPoint(stroke, point, hitRadius) {
  const points = stroke.points;
  const radius = hitRadius + fixedStrokeWidth / 2;
  const radiusSquared = radius * radius;

  if (points.length === 1) {
    return distanceSquared(points[0], point) <= radiusSquared;
  }

  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegmentSquared(point, points[index - 1], points[index]) <= radiusSquared) {
      return true;
    }
  }

  return false;
}

function distanceSquared(left, right) {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function distanceToSegmentSquared(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return distanceSquared(point, start);
  }

  const progress = clamp(
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared,
    0,
    1
  );
  const closest = {
    x: start.x + progress * segmentX,
    y: start.y + progress * segmentY
  };

  return distanceSquared(point, closest);
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

  if (currentStroke?.type === "draw" && currentStroke.pageId === pageId) {
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
