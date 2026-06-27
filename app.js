const storageKey = "noteapp.web.handwritten.v1";
const legacyStorageKey = "noteapp.web.notes.v1";
const selectedKey = "noteapp.web.handwritten.selected.v1";
const databaseName = "noteapp.web.handwritten.db";
const databaseVersion = 1;
const noteStoreName = "notes";
const metaStoreName = "meta";
const selectedMetaKey = "selectedId";

const paperSizes = {
  a4: { label: "A4", width: 1400, height: 1980 }
};
const fixedPaper = { size: "a4", background: "lined" };
const notebookRuleSpacing = 48;
const notebookTopMargin = 144;
const notebookBottomMargin = 96;
const notebookLeftMargin = 56;
const notebookRightMargin = 56;
const notebookDotSpacing = notebookRuleSpacing;
const notebookDateLineWidth = 280;
const notebookDateLineTop = 48;
const notebookRuleWidth = 1.15;
const notebookDotRadius = 2.4;
const notebookPaperColor = "#fffefa";
const notebookRuleColor = "rgba(85, 142, 170, 0.36)";
const notebookDotColor = "rgba(85, 142, 170, 0.28)";
const fixedStrokeWidth = 2.5;
const lassoPasteOffset = 48;
const lassoPointSpacing = 3;
const lassoMinimumPoints = 3;
const lassoBoundaryHitTolerance = 5;
const pdfPageSize = { width: 595.28, height: 841.89 };
const pdfImageQuality = 0.92;

const elements = {
  skipLink: document.querySelector(".skip-link"),
  listView: document.querySelector("#listView"),
  editorView: document.querySelector("#editorView"),
  newNoteButton: document.querySelector("#newNoteButton"),
  installAppButton: document.querySelector("#installAppButton"),
  backToListButton: document.querySelector("#backToListButton"),
  clearCanvasButton: document.querySelector("#clearCanvasButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
  penToolCluster: document.querySelector("#penToolCluster"),
  penButton: document.querySelector("#penButton"),
  eraserToolCluster: document.querySelector("#eraserToolCluster"),
  eraserButton: document.querySelector("#eraserButton"),
  eraserModeButton: document.querySelector("#eraserModeButton"),
  lassoToolCluster: document.querySelector("#lassoToolCluster"),
  lassoButton: document.querySelector("#lassoButton"),
  selectionActions: document.querySelector("#selectionActions"),
  copySelectionButton: document.querySelector("#copySelectionButton"),
  pasteSelectionButton: document.querySelector("#pasteSelectionButton"),
  pencilModeButton: document.querySelector("#pencilModeButton"),
  deletePageButton: document.querySelector("#deletePageButton"),
  pageState: document.querySelector("#pageState"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomValue: document.querySelector("#zoomValue"),
  colorSwatches: document.querySelector("#colorSwatches"),
  swatches: [...document.querySelectorAll(".swatch")],
  searchInput: document.querySelector("#searchInput"),
  noteList: document.querySelector("#noteList"),
  titleInput: document.querySelector("#titleInput"),
  canvasShell: document.querySelector(".canvas-shell"),
  pageStack: document.querySelector("#pageStack"),
  saveState: document.querySelector("#saveState"),
  saveStateTime: document.querySelector("#saveStateTime")
};

const eraserPreview = document.createElement("div");
const pageStackResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(updatePaperPatterns)
  : null;
const pageAnalysisCanvas = document.createElement("canvas");
const pageAnalysisContext = pageAnalysisCanvas.getContext("2d", { willReadFrequently: true });

let notes = [];
let selectedId = null;
let databasePromise = null;
let saveTimer = null;
let currentStroke = null;
let activeTool = "pen";
let activeEraserTool = "eraser";
let activeColor = "#202124";
let lassoSelection = null;
let lassoClipboard = null;
let undoStack = [];
let redoStack = [];
let currentView = "list";
let canvasZoom = 1;
let visiblePageSelectionFrame = null;
let pencilModeActive = true;
let touchScrollGesture = null;
let deferredInstallPrompt = null;
let appInstalled = isAppInstalled();
let storageReady = false;

const minCanvasZoom = 0.5;
const maxCanvasZoom = 2;
const canvasZoomStep = 0.25;

eraserPreview.className = "eraser-preview";
document.body.append(eraserPreview);
applyIcons();
initializeApp();

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
  clearLassoSelection();
  clearHistory();
  currentView = "editor";
  persistSoon();
  render();
});

elements.installAppButton.addEventListener("click", installAppFromList);

elements.backToListButton.addEventListener("click", () => {
  currentView = "list";
  currentStroke = null;
  clearLassoSelection();
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
  clearLassoSelection();
  clearHistory();
  persistSoon();
  render();
});

elements.undoButton.addEventListener("click", undoLastAction);

elements.redoButton.addEventListener("click", redoLastAction);

elements.exportPdfButton.addEventListener("click", exportSelectedNoteAsPdf);

elements.penButton.addEventListener("click", () => {
  activeTool = "pen";
  clearLassoSelection();
  updateToolButtons();
});

elements.eraserButton.addEventListener("click", () => {
  activeTool = activeEraserTool;
  clearLassoSelection();
  updateToolButtons();
});

elements.eraserModeButton.addEventListener("click", () => {
  activeEraserTool = activeEraserTool === "eraser" ? "stroke-eraser" : "eraser";
  activeTool = activeEraserTool;
  clearLassoSelection();
  updateToolButtons();
});

elements.lassoButton.addEventListener("click", () => {
  activeTool = "lasso";
  updateToolButtons();
});

elements.copySelectionButton.addEventListener("click", copyLassoSelection);

elements.pasteSelectionButton.addEventListener("click", pasteLassoSelection);

elements.pencilModeButton.addEventListener("click", () => {
  pencilModeActive = !pencilModeActive;
  currentStroke = null;
  touchScrollGesture = null;
  clearTextSelection();
  updateInputMode();
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
    clearLassoSelection();
    updateToolButtons();
    updateSwatches();
  });
}

elements.searchInput.addEventListener("input", renderList);
elements.editorView.addEventListener("selectstart", preventEditorSelectionInPencilMode);
elements.editorView.addEventListener("touchstart", clearEditorSelectionInPencilMode, { passive: true });

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
window.addEventListener("keydown", handleEditorKeyboardShortcuts);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  appInstalled = false;
  updateInstallButton();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  appInstalled = true;
  updateInstallButton();
});

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service Worker registration failed:", error);
    });
  });
}

function applyIcons() {
  const iconTargets = [
    [elements.installAppButton, "download"],
    [elements.newNoteButton, "plus"],
    [elements.backToListButton, "arrowLeft"],
    [elements.penButton, "pen"],
    [elements.eraserButton, "eraser"],
    [elements.lassoButton, "lasso"],
    [elements.copySelectionButton, "copy"],
    [elements.pasteSelectionButton, "clipboardPaste"],
    [elements.deletePageButton, "fileX"],
    [elements.zoomOutButton, "zoomOut"],
    [elements.zoomInButton, "zoomIn"],
    [elements.undoButton, "undo"],
    [elements.redoButton, "redo"],
    [elements.exportPdfButton, "fileDown"],
    [elements.clearCanvasButton, "trash"]
  ];

  for (const [button, iconName] of iconTargets) {
    setButtonIcon(button, iconName);
  }

  updateEraserModeIcon();
  updatePencilModeIcon();
}

function setButtonIcon(button, iconName) {
  if (!button) {
    return;
  }

  button.innerHTML = getLucideIcon(iconName);
}

function getLucideIcon(iconName) {
  return `
    <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true">
      ${getLucideIconPaths(iconName)}
    </svg>
  `;
}

function getLucideIconPaths(iconName) {
  const paths = {
    arrowLeft: `
      <path d="m12 19-7-7 7-7"></path>
      <path d="M19 12H5"></path>
    `,
    plus: `
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    `,
    download: `
      <path d="M12 15V3"></path>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <path d="m7 10 5 5 5-5"></path>
    `,
    pen: `
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
    `,
    eraser: `
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"></path>
      <path d="M22 21H7"></path>
      <path d="m5 11 9 9"></path>
    `,
    strokeEraser: `
      <path d="M7 3.5c5-2 7 2.5 3 4C1.5 10 2 15 5 16c5 2 9-10 14-7s.5 13.5-4 12c-5-2.5.5-11 6-2"></path>
    `,
    lasso: `
      <path d="M7 22a5 5 0 0 1-2-4"></path>
      <path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"></path>
      <circle cx="7" cy="18" r="2"></circle>
    `,
    copy: `
      <rect width="14" height="14" x="8" y="8" rx="2"></rect>
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    `,
    clipboardPaste: `
      <path d="M15 2H9a2 2 0 0 0-2 2v2h10V4a2 2 0 0 0-2-2Z"></path>
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"></path>
    `,
    pencilMode: `
      <path d="M10 3H8"></path>
      <path d="m15.007 5.008 3.987 3.986"></path>
      <path d="M20 15v4"></path>
      <path d="M21.174 6.813a2.82 2.82 0 0 0-3.986-3.987L3.842 16.175a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path>
      <path d="M22 17h-4"></path>
      <path d="M4 5v4"></path>
      <path d="M6 7H2"></path>
      <path d="M9 2v2"></path>
    `,
    touchMode: `
      <path d="m10 10-6.157 6.162a2 2 0 0 0-.5.833l-1.322 4.36a.5.5 0 0 0 .622.624l4.358-1.323a2 2 0 0 0 .83-.5L14 13.982"></path>
      <path d="m12.829 7.172 4.359-4.346a1 1 0 1 1 3.986 3.986l-4.353 4.353"></path>
      <path d="m15 5 4 4"></path>
      <path d="m2 2 20 20"></path>
    `,
    fileX: `
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <path d="m10 13 4 4"></path>
      <path d="m14 13-4 4"></path>
    `,
    zoomOut: `
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.3-4.3"></path>
      <path d="M8 11h6"></path>
    `,
    zoomIn: `
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.3-4.3"></path>
      <path d="M8 11h6"></path>
      <path d="M11 8v6"></path>
    `,
    undo: `
      <path d="M9 14 4 9l5-5"></path>
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13"></path>
    `,
    redo: `
      <path d="m15 14 5-5-5-5"></path>
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H11"></path>
    `,
    fileDown: `
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <path d="M12 18v-6"></path>
      <path d="m9 15 3 3 3-3"></path>
    `,
    trash: `
      <path d="M3 6h18"></path>
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
      <line x1="10" x2="10" y1="11" y2="17"></line>
      <line x1="14" x2="14" y1="11" y2="17"></line>
    `
  };

  return paths[iconName] ?? paths.plus;
}

function updatePencilModeIcon() {
  setButtonIcon(elements.pencilModeButton, pencilModeActive ? "pencilMode" : "touchMode");
}

function updateEraserModeIcon() {
  const eraserIcon = getEraserIconName();
  const alternateIcon = activeEraserTool === "stroke-eraser" ? "eraser" : "strokeEraser";

  setButtonIcon(elements.eraserButton, eraserIcon);
  setButtonIcon(elements.eraserModeButton, alternateIcon);
  elements.eraserToolCluster.classList.toggle("normal-selected", activeEraserTool === "eraser");
  elements.eraserToolCluster.classList.toggle("stroke-selected", activeEraserTool === "stroke-eraser");
}

function getEraserIconName() {
  return activeEraserTool === "stroke-eraser" ? "strokeEraser" : "eraser";
}

async function initializeApp() {
  try {
    const indexedState = await loadIndexedState();
    const legacyState = loadLegacyState();
    const shouldMigrateLegacy = indexedState.notes.length === 0 && legacyState.notes.length > 0;

    if (shouldMigrateLegacy) {
      notes = legacyState.notes;
      selectedId = legacyState.selectedId;
      ensureSelectedNote();
      await writeIndexedState();
      clearLegacyState();
    } else {
      notes = indexedState.notes;
      selectedId = indexedState.selectedId;
      ensureSelectedNote();
    }
  } catch (error) {
    console.error("IndexedDB initialization failed:", error);
    const legacyState = loadLegacyState();
    notes = legacyState.notes;
    selectedId = legacyState.selectedId;
    ensureSelectedNote();
  } finally {
    storageReady = true;
    render();
  }
}

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

function openNoteDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(noteStoreName)) {
          database.createObjectStore(noteStoreName, { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains(metaStoreName)) {
          database.createObjectStore(metaStoreName, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  return databasePromise;
}

async function loadIndexedState() {
  const database = await openNoteDatabase();
  const [savedNotes, selectedMeta] = await Promise.all([
    getAllFromStore(database, noteStoreName),
    getFromStore(database, metaStoreName, selectedMetaKey)
  ]);

  return {
    notes: savedNotes.map(normalizeNote).filter(Boolean),
    selectedId: typeof selectedMeta?.value === "string" ? selectedMeta.value : null
  };
}

async function writeIndexedState() {
  const database = await openNoteDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([noteStoreName, metaStoreName], "readwrite");
    const noteStore = transaction.objectStore(noteStoreName);
    const metaStore = transaction.objectStore(metaStoreName);

    noteStore.clear();
    for (const note of notes) {
      noteStore.put(note);
    }

    metaStore.put({ key: selectedMetaKey, value: selectedId });
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error);
    };
    transaction.onabort = () => {
      reject(transaction.error);
    };
  });
}

function getAllFromStore(database, storeName) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => {
      resolve(Array.isArray(request.result) ? request.result : []);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

function getFromStore(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

function loadLegacyState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return {
          notes: parsed.map(normalizeNote).filter(Boolean),
          selectedId: localStorage.getItem(selectedKey)
        };
      }
    }

    const legacyRaw = localStorage.getItem(legacyStorageKey);
    if (legacyRaw) {
      const parsedLegacy = JSON.parse(legacyRaw);
      if (Array.isArray(parsedLegacy)) {
        return {
          notes: parsedLegacy.map((note) => normalizeNote({
            ...note,
            strokes: []
          })).filter(Boolean),
          selectedId: localStorage.getItem(selectedKey)
        };
      }
    }

    return { notes: [], selectedId: null };
  } catch {
    return { notes: [], selectedId: null };
  }
}

function clearLegacyState() {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(legacyStorageKey);
  localStorage.removeItem(selectedKey);
}

function ensureSelectedNote() {
  if (!notes.some((note) => note.id === selectedId)) {
    selectedId = notes[0]?.id ?? null;
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
  if (!storageReady) {
    return;
  }

  updateSaveState();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    persistNow().finally(updateSaveState);
  }, 250);
}

function persistNow() {
  if (!storageReady) {
    return Promise.resolve();
  }

  return writeIndexedState().catch((error) => {
    console.error("IndexedDB save failed:", error);
  });
}

function updateSaveState(note = getSelectedNote()) {
  elements.saveStateTime.textContent = note ? formatDate(note.updatedAt) : "--";
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
  updateInstallButton();
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

async function installAppFromList() {
  if (isAppInstalled()) {
    appInstalled = true;
    updateInstallButton();
    return;
  }

  if (!deferredInstallPrompt) {
    window.alert(getManualInstallMessage());
    return;
  }

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateInstallButton();

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    appInstalled = choice.outcome === "accepted";
  } catch (error) {
    console.error("PWA install prompt failed:", error);
  } finally {
    updateInstallButton();
  }
}

function updateInstallButton() {
  const installed = isAppInstalled() || appInstalled;
  elements.installAppButton.hidden = installed;
  elements.installAppButton.disabled = installed;
  elements.installAppButton.title = deferredInstallPrompt ? "アプリをインストール" : "インストール方法";
  elements.installAppButton.setAttribute(
    "aria-label",
    deferredInstallPrompt ? "アプリをインストール" : "インストール方法"
  );
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function getManualInstallMessage() {
  if (window.location.protocol === "file:") {
    return "PWAとしてインストールするには，開発用サーバーやHTTPSから開いてください。";
  }

  return "このブラウザでは自動インストール画面を開けません。ブラウザの共有メニューまたはメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。";
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
    setButtonIcon(deleteButton, "trash");
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
  const lassoActive = activeTool === "lasso";
  const eraserGroupActive = eraserActive || strokeEraserActive;
  const eraserLabel = activeEraserTool === "stroke-eraser"
    ? "ストローク消しゴム"
    : "通常の消しゴム";
  const eraserModeLabel = activeEraserTool === "stroke-eraser"
    ? "通常の消しゴムに切り替え"
    : "ストローク消しゴムに切り替え";

  elements.penButton.classList.toggle("active", penActive);
  elements.eraserButton.classList.toggle("active", eraserGroupActive);
  elements.lassoButton.classList.toggle("active", lassoActive);
  elements.penToolCluster.classList.toggle("open", penActive);
  elements.eraserToolCluster.classList.toggle("open", eraserGroupActive);
  elements.lassoToolCluster.classList.toggle("open", lassoActive);
  elements.pencilModeButton.classList.remove("active");
  elements.eraserModeButton.classList.remove("active");
  elements.penButton.setAttribute("aria-pressed", String(penActive));
  elements.eraserButton.setAttribute("aria-pressed", String(eraserGroupActive));
  elements.lassoButton.setAttribute("aria-pressed", String(lassoActive));
  elements.eraserModeButton.setAttribute("aria-pressed", "false");
  elements.pencilModeButton.setAttribute("aria-pressed", String(pencilModeActive));
  elements.eraserButton.title = eraserLabel;
  elements.eraserButton.setAttribute("aria-label", eraserLabel);
  elements.eraserModeButton.title = eraserModeLabel;
  elements.eraserModeButton.setAttribute("aria-label", eraserModeLabel);
  elements.pencilModeButton.title = pencilModeActive ? "Pencilモード" : "タッチ描画モード";
  elements.pencilModeButton.setAttribute("aria-label", pencilModeActive ? "Pencilモード" : "タッチ描画モード");
  elements.colorSwatches.hidden = !penActive;
  elements.eraserModeButton.hidden = !eraserGroupActive;
  updateSelectionControls(lassoActive);
  updateEraserModeIcon();
  updatePencilModeIcon();
  elements.pageStack.dataset.tool = activeTool;
}

function updateSelectionControls(lassoActive = activeTool === "lasso") {
  const hasSelection = Boolean(lassoSelection);
  const hasClipboard = Boolean(lassoClipboard?.strokes.length);
  const enabled = lassoActive && currentView === "editor" && Boolean(getSelectedNote());

  elements.selectionActions.hidden = !lassoActive;
  elements.copySelectionButton.disabled = !enabled || !hasSelection;
  elements.pasteSelectionButton.disabled = !enabled || !hasClipboard;
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
  elements.exportPdfButton.disabled = !note;
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
  clearLassoSelection(false);
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

  if (action.type === "move-strokes") {
    const page = getHistoryPage(note, action);
    if (!page) {
      return false;
    }

    note.selectedPageId = page.id;
    return undoMovedStrokes(page, action.items);
  }

  if (action.type === "paste-strokes") {
    const page = getHistoryPage(note, action);
    if (!page) {
      return false;
    }

    note.selectedPageId = page.id;
    return removeDeletedStrokes(page, action.inserted);
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
    page.strokes.push(cloneStroke(action.stroke));
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

  if (action.type === "move-strokes") {
    const page = getHistoryPage(note, action, true);
    if (!page) {
      return false;
    }

    note.selectedPageId = page.id;
    return redoMovedStrokes(page, action.items);
  }

  if (action.type === "paste-strokes") {
    const page = getHistoryPage(note, action, true);
    if (!page) {
      return false;
    }

    note.selectedPageId = page.id;
    restoreDeletedStrokes(page, action.inserted);
    return true;
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

  for (let index = page.strokes.length - 1; index >= 0; index -= 1) {
    if (strokesMatch(page.strokes[index], stroke)) {
      return index;
    }
  }

  return -1;
}

function restoreDeletedStrokes(page, deletedStrokes) {
  const sortedStrokes = [...deletedStrokes].sort((a, b) => a.index - b.index);
  for (const item of sortedStrokes) {
    page.strokes.splice(clamp(item.index, 0, page.strokes.length), 0, cloneStroke(item.stroke));
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

function moveSelectedStrokesToFront(page, movedStrokes) {
  const sortedStrokes = [...movedStrokes].sort((a, b) => a.index - b.index);
  const actionItems = sortedStrokes.map((item) => ({
    index: item.index,
    before: cloneStroke(item.before),
    after: cloneStroke(item.after),
    finalIndex: 0
  }));

  for (const item of [...sortedStrokes].sort((a, b) => b.index - a.index)) {
    page.strokes.splice(item.index, 1);
  }

  const insertionIndex = page.strokes.length;
  const frontStrokes = actionItems.map((item, offset) => {
    item.finalIndex = insertionIndex + offset;
    return cloneStroke(item.after);
  });

  page.strokes.push(...frontStrokes);

  return {
    items: actionItems,
    indexes: actionItems.map((item) => item.finalIndex)
  };
}

function undoMovedStrokes(page, movedStrokes) {
  const removed = removeMovedFrontStrokes(page, movedStrokes);
  restoreDeletedStrokes(page, movedStrokes.map((item) => ({
    index: item.index,
    stroke: cloneStroke(item.before)
  })));

  return removed || movedStrokes.length > 0;
}

function redoMovedStrokes(page, movedStrokes) {
  const removed = removeDeletedStrokes(page, movedStrokes.map((item) => ({
    index: item.index,
    stroke: item.before
  })));
  if (!removed) {
    return false;
  }

  const insertionIndex = page.strokes.length;
  const frontStrokes = movedStrokes.map((item, offset) => {
    item.finalIndex = insertionIndex + offset;
    return cloneStroke(item.after);
  });
  page.strokes.push(...frontStrokes);

  return true;
}

function removeMovedFrontStrokes(page, movedStrokes) {
  let removed = false;
  const sortedStrokes = [...movedStrokes].sort((a, b) => b.finalIndex - a.finalIndex);

  for (const item of sortedStrokes) {
    let strokeIndex = -1;
    if (Number.isInteger(item.finalIndex) && strokesMatch(page.strokes[item.finalIndex], item.after)) {
      strokeIndex = item.finalIndex;
    } else {
      strokeIndex = findStrokeIndex(page, item.after);
    }

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

async function exportSelectedNoteAsPdf() {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  elements.exportPdfButton.disabled = true;

  try {
    const pdfBlob = await createNotePdfBlob(note);
    downloadBlob(pdfBlob, getPdfFileName(note));
  } catch (error) {
    console.error(error);
    window.alert("PDFの書き出しに失敗しました。");
  } finally {
    updateActionButtons();
  }
}

async function createNotePdfBlob(note) {
  const exportPages = getPdfExportPages(note);
  const images = [];

  for (const page of exportPages) {
    const canvas = renderPageForPdf(page);
    const data = await canvasToJpegBytes(canvas, pdfImageQuality);
    images.push({
      width: canvas.width,
      height: canvas.height,
      data
    });
  }

  return buildPdfBlob(images);
}

function getPdfExportPages(note) {
  let lastDrawnIndex = -1;

  note.pages.forEach((page, index) => {
    if (hasPageDrawing(page)) {
      lastDrawnIndex = index;
    }
  });

  if (lastDrawnIndex === -1) {
    return [note.pages[0] ?? createPage()];
  }

  return note.pages.slice(0, lastDrawnIndex + 1);
}

function renderPageForPdf(page) {
  const size = getPaperSize();
  const paperCanvas = document.createElement("canvas");
  const inkCanvas = document.createElement("canvas");
  paperCanvas.width = size.width;
  paperCanvas.height = size.height;
  inkCanvas.width = size.width;
  inkCanvas.height = size.height;

  const paperContext = paperCanvas.getContext("2d");
  const inkContext = inkCanvas.getContext("2d");
  drawPaperBackground(paperContext, size);

  for (const stroke of page.strokes) {
    drawStroke(stroke, inkContext);
  }

  paperContext.drawImage(inkCanvas, 0, 0);

  return paperCanvas;
}

function drawPaperBackground(targetContext, size) {
  targetContext.save();
  targetContext.fillStyle = notebookPaperColor;
  targetContext.fillRect(0, 0, size.width, size.height);

  const ruledLeft = notebookLeftMargin;
  const ruledRight = size.width - notebookRightMargin;
  const ruledBottom = size.height - notebookBottomMargin;
  const dateRight = ruledRight;
  const dateLeft = dateRight - notebookDateLineWidth;

  targetContext.strokeStyle = notebookRuleColor;
  targetContext.lineWidth = notebookRuleWidth;
  targetContext.beginPath();

  const dateLineY = Math.round(notebookDateLineTop + notebookRuleSpacing) + 0.5;
  targetContext.moveTo(dateLeft, dateLineY);
  targetContext.lineTo(dateRight, dateLineY);

  for (let y = notebookTopMargin; y <= ruledBottom; y += notebookRuleSpacing) {
    const lineY = Math.round(y) + 0.5;
    targetContext.moveTo(ruledLeft, lineY);
    targetContext.lineTo(ruledRight, lineY);
  }

  targetContext.stroke();
  targetContext.fillStyle = notebookDotColor;

  for (let y = notebookTopMargin; y <= ruledBottom; y += notebookRuleSpacing) {
    for (let x = ruledLeft; x <= ruledRight; x += notebookDotSpacing) {
      targetContext.beginPath();
      targetContext.arc(x, y + 0.5, notebookDotRadius, 0, Math.PI * 2);
      targetContext.fill();
    }
  }

  targetContext.restore();
}

function canvasToJpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error("Canvasから画像を生成できませんでした。"));
          return;
        }

        try {
          resolve(new Uint8Array(await blob.arrayBuffer()));
        } catch (error) {
          reject(error);
        }
      }, "image/jpeg", quality);
      return;
    }

    resolve(dataUrlToBytes(canvas.toDataURL("image/jpeg", quality)));
  });
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildPdfBlob(images) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let byteLength = 0;
  const pageIds = images.map((_, index) => 3 + index * 3);
  const objectCount = 2 + images.length * 3;

  const appendText = (text) => {
    appendBytes(encoder.encode(text));
  };
  const appendBytes = (bytes) => {
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  };
  const beginObject = (objectId) => {
    offsets[objectId] = byteLength;
    appendText(`${objectId} 0 obj\n`);
  };
  const endObject = () => {
    appendText("endobj\n");
  };

  appendText("%PDF-1.4\n");

  beginObject(1);
  appendText("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObject();

  beginObject(2);
  appendText(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>\n`);
  endObject();

  images.forEach((image, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index}`;
    const content = `q\n${pdfPageSize.width} 0 0 ${pdfPageSize.height} 0 0 cm\n/${imageName} Do\nQ\n`;

    beginObject(pageId);
    appendText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageSize.width} ${pdfPageSize.height}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\n`);
    endObject();

    beginObject(contentId);
    appendText(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream\n`);
    endObject();

    beginObject(imageId);
    appendText(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.byteLength} >>\nstream\n`);
    appendBytes(image.data);
    appendText("\nendstream\n");
    endObject();
  });

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${objectCount + 1}\n`);
  appendText("0000000000 65535 f \n");

  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    appendText(`${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`);
  }

  appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function getPdfFileName(note) {
  const title = note.title.trim() || "NoteApp";
  const safeTitle = title
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return `${safeTitle || "NoteApp"}.pdf`;
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

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
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
  clearLassoSelection(false);
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
  clearLassoSelection(false);
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

  if (event.pointerType === "touch" && pencilModeActive) {
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
  if (activeTool === "lasso") {
    startLassoAction(page, canvas, event.pointerId, point);
    redrawPage(page.id);
    return;
  }

  if (activeTool === "stroke-eraser") {
    currentStroke = {
      type: "stroke-eraser",
      pageId: page.id,
      canvas,
      pointerId: event.pointerId,
      deleted: []
    };
    updateEraserPreview(event, canvas, activeTool);
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

  if (activeTool === "eraser") {
    updateEraserPreview(event, canvas, activeTool);
  }
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

  if (currentStroke.type === "lasso") {
    continueLassoAction(event);
    return;
  }

  if (currentStroke.type === "move-selection") {
    continueSelectionMove(event);
    return;
  }

  if (currentStroke.type === "stroke-eraser") {
    const note = getSelectedNote();
    const page = getPageById(note, currentStroke.pageId);
    if (page) {
      updateEraserPreview(event, currentStroke.canvas, currentStroke.type);
      eraseStrokesAtPoint(page, getCanvasPoint(event, currentStroke.canvas), currentStroke.canvas, currentStroke.deleted);
    }
    return;
  }

  const point = getCanvasPoint(event, currentStroke.canvas);
  const lastPoint = currentStroke.stroke.points[currentStroke.stroke.points.length - 1];
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  if (currentStroke.stroke.tool === "eraser") {
    updateEraserPreview(event, currentStroke.canvas, currentStroke.stroke.tool);
  }

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

  hideEraserPreview();
  currentStroke = null;

  if (strokeAction.type === "lasso") {
    finishLassoAction(strokeAction);
    return;
  }

  if (strokeAction.type === "move-selection") {
    finishSelectionMove(strokeAction);
    return;
  }

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
      stroke: cloneStroke(strokeAction.stroke)
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

  hideEraserPreview();
  currentStroke = null;
  if (strokeAction?.type === "lasso") {
    redrawPage(pageId);
    updateSelectionControls();
    return;
  }

  if (strokeAction?.type === "move-selection") {
    cancelSelectionMove(strokeAction);
    return;
  }

  if (strokeAction?.type === "stroke-eraser") {
    finishStrokeErase(strokeAction);
    return;
  }

  if (pageId) {
    redrawPage(pageId);
  }
}

function startLassoAction(page, canvas, pointerId, point) {
  if (lassoSelection?.pageId === page.id && selectionMoveHitTest(lassoSelection, point, canvas)) {
    const items = getSelectionItems(page, lassoSelection);
    if (items.length > 0) {
      currentStroke = {
        type: "move-selection",
        pageId: page.id,
        canvas,
        pointerId,
        lastPoint: point,
        totalDelta: { x: 0, y: 0 },
        selectionBefore: cloneLassoSelection(lassoSelection),
        items: items.map((item) => ({
          index: item.index,
          before: cloneStroke(item.stroke)
        }))
      };
      return;
    }
  }

  clearLassoSelection();
  currentStroke = {
    type: "lasso",
    pageId: page.id,
    canvas,
    pointerId,
    points: [point]
  };
}

function continueLassoAction(event) {
  const point = getCanvasPoint(event, currentStroke.canvas);
  const lastPoint = currentStroke.points[currentStroke.points.length - 1];
  if (distanceSquared(point, lastPoint) < lassoPointSpacing * lassoPointSpacing) {
    return;
  }

  currentStroke.points.push(point);
  redrawPage(currentStroke.pageId);
}

function finishLassoAction(strokeAction) {
  const note = getSelectedNote();
  const page = getPageById(note, strokeAction.pageId);
  if (!page || strokeAction.points.length < lassoMinimumPoints) {
    clearLassoSelection();
    redrawPage(strokeAction.pageId);
    return;
  }

  const selection = createLassoSelection(page, strokeAction.points);
  lassoSelection = selection;
  redrawPage(page.id);
  updateSelectionControls();
}

function continueSelectionMove(event) {
  const note = getSelectedNote();
  const page = getPageById(note, currentStroke.pageId);
  if (!page || !lassoSelection) {
    return;
  }

  const point = getCanvasPoint(event, currentStroke.canvas);
  const requestedDelta = {
    x: point.x - currentStroke.lastPoint.x,
    y: point.y - currentStroke.lastPoint.y
  };
  const delta = getClampedSelectionDelta(lassoSelection.bounds, requestedDelta.x, requestedDelta.y);
  currentStroke.lastPoint = point;

  if (delta.x === 0 && delta.y === 0) {
    return;
  }

  for (const item of currentStroke.items) {
    const stroke = page.strokes[item.index];
    if (stroke) {
      translateStroke(stroke, delta.x, delta.y);
    }
  }

  translateLassoSelection(lassoSelection, delta.x, delta.y);
  currentStroke.totalDelta.x += delta.x;
  currentStroke.totalDelta.y += delta.y;
  redrawPage(page.id);
}

function finishSelectionMove(strokeAction) {
  const note = getSelectedNote();
  const page = getPageById(note, strokeAction.pageId);
  if (!note || !page) {
    render();
    return;
  }

  const moved = Math.abs(strokeAction.totalDelta.x) > 0.01 || Math.abs(strokeAction.totalDelta.y) > 0.01;
  if (!moved) {
    redrawPage(page.id);
    updateSelectionControls();
    return;
  }

  const items = strokeAction.items
    .map((item) => ({
      index: item.index,
      before: item.before,
      after: cloneStroke(page.strokes[item.index])
    }))
    .filter((item) => item.after && !strokesMatch(item.before, item.after));

  if (items.length === 0) {
    redrawPage(page.id);
    updateSelectionControls();
    return;
  }

  const pageIndex = note.pages.findIndex((item) => item.id === page.id);
  const moveResult = moveSelectedStrokesToFront(page, items);
  if (lassoSelection) {
    lassoSelection.strokeIndexes = moveResult.indexes;
  }

  normalizeAutoPages(note, page.id);
  note.updatedAt = new Date().toISOString();
  notes = sortNotes(notes);
  pushUndoAction({
    type: "move-strokes",
    pageId: page.id,
    pageIndex,
    items: moveResult.items
  });
  persistSoon();
  render();
}

function cancelSelectionMove(strokeAction) {
  const note = getSelectedNote();
  const page = getPageById(note, strokeAction.pageId);
  if (page) {
    for (const item of strokeAction.items) {
      if (page.strokes[item.index]) {
        page.strokes[item.index] = cloneStroke(item.before);
      }
    }
  }

  lassoSelection = cloneLassoSelection(strokeAction.selectionBefore);
  redrawPage(strokeAction.pageId);
  updateSelectionControls();
}

function copyLassoSelection() {
  const note = getSelectedNote();
  const page = getPageById(note, lassoSelection?.pageId);
  if (!page || !lassoSelection) {
    return;
  }

  const items = getSelectionItems(page, lassoSelection);
  if (items.length === 0) {
    clearLassoSelection();
    return;
  }

  lassoClipboard = {
    strokes: items.map((item) => cloneStroke(item.stroke)),
    bounds: getStrokesBounds(items.map((item) => item.stroke)),
    pasteCount: 0
  };
  updateSelectionControls();
}

function pasteLassoSelection() {
  const note = getSelectedNote();
  const page = getSelectedPage(note);
  if (activeTool !== "lasso" || !note || !page || !lassoClipboard?.strokes.length) {
    return;
  }

  const pasteCount = lassoClipboard.pasteCount + 1;
  const requestedOffset = lassoPasteOffset * pasteCount;
  const delta = getClampedSelectionDelta(lassoClipboard.bounds, requestedOffset, requestedOffset);
  const pastedStrokes = lassoClipboard.strokes.map((stroke) => {
    const copy = cloneStroke(stroke);
    translateStroke(copy, delta.x, delta.y);
    return copy;
  });
  const insertionIndex = page.strokes.length;
  const inserted = pastedStrokes.map((stroke, offset) => ({
    index: insertionIndex + offset,
    stroke
  }));
  const insertedAction = inserted.map((item) => ({
    index: item.index,
    stroke: cloneStroke(item.stroke)
  }));

  page.strokes.push(...pastedStrokes);
  lassoClipboard.pasteCount = pasteCount;
  lassoSelection = createSelectionFromItems(page.id, inserted.map((item) => ({
    index: item.index,
    stroke: item.stroke
  })));

  const pageIndex = note.pages.findIndex((item) => item.id === page.id);
  normalizeAutoPages(note, page.id);
  note.updatedAt = new Date().toISOString();
  notes = sortNotes(notes);
  pushUndoAction({
    type: "paste-strokes",
    pageId: page.id,
    pageIndex,
    inserted: insertedAction
  });
  persistSoon();
  render();
}

function clearLassoSelection(redraw = true) {
  const pageId = lassoSelection?.pageId;
  lassoSelection = null;
  if (redraw && pageId) {
    redrawPage(pageId);
  }

  updateSelectionControls();
}

function selectionMoveHitTest(selection, point, canvas) {
  return pointInPolygon(point, selection.polygon)
    || pointNearClosedPolygon(
      point,
      selection.polygon,
      getScreenLengthAsCanvasPixels(canvas, lassoBoundaryHitTolerance)
    );
}

function createLassoSelection(page, polygon) {
  const items = getStrokesInPolygon(page, polygon);
  if (items.length === 0) {
    return null;
  }

  return createSelectionFromItems(page.id, items, polygon);
}

function createSelectionFromItems(pageId, items, polygon = null) {
  const bounds = getStrokesBounds(items.map((item) => item.stroke));
  if (!bounds) {
    return null;
  }

  return {
    pageId,
    strokeIndexes: items.map((item) => item.index),
    polygon: polygon ? polygon.map(clonePoint) : getBoundsPolygon(bounds),
    bounds
  };
}

function getSelectionItems(page, selection) {
  if (!page || !selection) {
    return [];
  }

  return selection.strokeIndexes
    .map((index) => ({ index, stroke: page.strokes[index] }))
    .filter((item) => item.stroke?.tool === "pen");
}

function getStrokesInPolygon(page, polygon) {
  const polygonBounds = getPointsBounds(polygon);
  if (!polygonBounds) {
    return [];
  }

  return page.strokes
    .map((stroke, index) => ({ index, stroke }))
    .filter((item) => item.stroke.tool === "pen")
    .filter((item) => strokeIntersectsPolygon(item.stroke, polygon, polygonBounds));
}

function strokeIntersectsPolygon(stroke, polygon, polygonBounds) {
  const strokeBounds = getStrokeBounds(stroke);
  if (!strokeBounds || !boundsOverlap(strokeBounds, polygonBounds)) {
    return false;
  }

  if (stroke.points.some((point) => pointInPolygon(point, polygon))) {
    return true;
  }

  for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex += 1) {
    const start = stroke.points[pointIndex - 1];
    const end = stroke.points[pointIndex];
    for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
      const edgeStart = polygon[polygonIndex];
      const edgeEnd = polygon[(polygonIndex + 1) % polygon.length];
      if (segmentsIntersect(start, end, edgeStart, edgeEnd)) {
        return true;
      }
    }
  }

  return false;
}

function getStrokesBounds(strokes) {
  const bounds = strokes
    .map(getStrokeBounds)
    .filter(Boolean)
    .reduce((merged, item) => mergeBounds(merged, item), null);

  return bounds;
}

function getStrokeBounds(stroke) {
  if (!stroke?.points.length) {
    return null;
  }

  const padding = stroke.tool === "eraser" ? getNormalEraserCanvasRadius() : fixedStrokeWidth / 2;
  return getPointsBounds(stroke.points, padding);
}

function getPointsBounds(points, padding = 0) {
  if (!points.length) {
    return null;
  }

  let left = points[0].x;
  let right = points[0].x;
  let top = points[0].y;
  let bottom = points[0].y;

  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }

  return {
    left: left - padding,
    right: right + padding,
    top: top - padding,
    bottom: bottom + padding
  };
}

function mergeBounds(left, right) {
  if (!left) {
    return { ...right };
  }

  return {
    left: Math.min(left.left, right.left),
    right: Math.max(left.right, right.right),
    top: Math.min(left.top, right.top),
    bottom: Math.max(left.bottom, right.bottom)
  };
}

function boundsOverlap(left, right) {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top;
}

function pointInBounds(point, bounds) {
  return Boolean(
    bounds
    && point.x >= bounds.left
    && point.x <= bounds.right
    && point.y >= bounds.top
    && point.y <= bounds.bottom
  );
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointNearClosedPolygon(point, polygon, tolerance) {
  if (polygon.length < 2) {
    return false;
  }

  const toleranceSquared = tolerance * tolerance;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (distanceToSegmentSquared(point, start, end) <= toleranceSquared) {
      return true;
    }
  }

  return false;
}

function segmentsIntersect(a, b, c, d) {
  const epsilon = 0.0001;
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);

  if (Math.abs(abC) < epsilon && pointOnSegment(c, a, b, epsilon)) {
    return true;
  }

  if (Math.abs(abD) < epsilon && pointOnSegment(d, a, b, epsilon)) {
    return true;
  }

  if (Math.abs(cdA) < epsilon && pointOnSegment(a, c, d, epsilon)) {
    return true;
  }

  if (Math.abs(cdB) < epsilon && pointOnSegment(b, c, d, epsilon)) {
    return true;
  }

  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function crossProduct(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, start, end, epsilon = 0) {
  return point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

function getClampedSelectionDelta(bounds, deltaX, deltaY) {
  const size = getPaperSize();
  return {
    x: clamp(deltaX, -bounds.left, size.width - bounds.right),
    y: clamp(deltaY, -bounds.top, size.height - bounds.bottom)
  };
}

function translateLassoSelection(selection, deltaX, deltaY) {
  selection.polygon = selection.polygon.map((point) => translatePoint(point, deltaX, deltaY));
  selection.bounds = translateBounds(selection.bounds, deltaX, deltaY);
}

function translateStroke(stroke, deltaX, deltaY) {
  stroke.points = stroke.points.map((point) => translatePoint(point, deltaX, deltaY));
}

function translatePoint(point, deltaX, deltaY) {
  return {
    x: point.x + deltaX,
    y: point.y + deltaY
  };
}

function translateBounds(bounds, deltaX, deltaY) {
  return {
    left: bounds.left + deltaX,
    right: bounds.right + deltaX,
    top: bounds.top + deltaY,
    bottom: bounds.bottom + deltaY
  };
}

function getBoundsPolygon(bounds) {
  return [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom }
  ];
}

function cloneLassoSelection(selection) {
  if (!selection) {
    return null;
  }

  return {
    pageId: selection.pageId,
    strokeIndexes: [...selection.strokeIndexes],
    polygon: selection.polygon.map(clonePoint),
    bounds: { ...selection.bounds }
  };
}

function cloneStroke(stroke) {
  return {
    ...stroke,
    points: stroke.points.map(clonePoint)
  };
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}

function handleEditorKeyboardShortcuts(event) {
  if (currentView !== "editor" || activeTool !== "lasso" || isEditableTarget(event.target)) {
    return;
  }

  const modifierPressed = event.metaKey || event.ctrlKey;
  if (!modifierPressed) {
    return;
  }

  const key = event.key.toLocaleLowerCase();
  if (key === "c" && lassoSelection) {
    event.preventDefault();
    copyLassoSelection();
  } else if (key === "v" && lassoClipboard?.strokes.length) {
    event.preventDefault();
    pasteLassoSelection();
  }
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target?.isContentEditable;
}

function canUsePointerForDrawing(event) {
  return event.pointerType !== "touch" || !pencilModeActive;
}

function beginTouchScroll(event, canvas) {
  event.preventDefault();
  clearEditorSelectionInPencilMode();
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
  clearEditorSelectionInPencilMode();
  event.preventDefault();
}

function preventCanvasGestureMenu(event) {
  event.preventDefault();
}

function updateInputMode() {
  elements.editorView.dataset.inputMode = pencilModeActive ? "pencil" : "touch";
  elements.pageStack.dataset.inputMode = pencilModeActive ? "pencil" : "touch";
}

function preventEditorSelectionInPencilMode(event) {
  if (!pencilModeActive) {
    return;
  }

  event.preventDefault();
  clearTextSelection();
}

function clearEditorSelectionInPencilMode() {
  if (pencilModeActive) {
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

function getStrokeEraserRadius() {
  return Math.max(0, getNormalEraserCanvasRadius() - fixedStrokeWidth / 2);
}

function getCanvasLengthAsScreenPixels(canvas, length) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || canvas.width <= 0) {
    return length;
  }

  return (length / canvas.width) * rect.width;
}

function getScreenLengthAsCanvasPixels(canvas, length) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || canvas.width <= 0) {
    return length;
  }

  return (length / rect.width) * canvas.width;
}

function getNormalEraserCanvasRadius() {
  return (fixedStrokeWidth * 3) / 2;
}

function getNormalEraserScreenRadius(canvas) {
  return getCanvasLengthAsScreenPixels(canvas, getNormalEraserCanvasRadius());
}

function getStrokeEraserPreviewRadius(canvas) {
  return getNormalEraserScreenRadius(canvas);
}

function updateEraserPreview(event, canvas, tool) {
  const radius = tool === "stroke-eraser"
    ? getStrokeEraserPreviewRadius(canvas)
    : getNormalEraserScreenRadius(canvas);
  const visibleRadius = Math.max(2, radius);
  const size = visibleRadius * 2;

  eraserPreview.classList.toggle("stroke-mode", tool === "stroke-eraser");
  eraserPreview.style.width = `${size}px`;
  eraserPreview.style.height = `${size}px`;
  eraserPreview.style.left = `${event.clientX}px`;
  eraserPreview.style.top = `${event.clientY}px`;
  eraserPreview.classList.add("visible");
}

function hideEraserPreview() {
  eraserPreview.classList.remove("visible", "stroke-mode");
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
  const movingStrokeIndexes = currentStroke?.type === "move-selection" && currentStroke.pageId === pageId
    ? new Set(currentStroke.items.map((item) => item.index))
    : null;
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < page.strokes.length; index += 1) {
    if (movingStrokeIndexes?.has(index)) {
      continue;
    }

    const stroke = page.strokes[index];
    drawStroke(stroke, context);
  }

  if (currentStroke?.type === "draw" && currentStroke.pageId === pageId) {
    drawStroke(currentStroke.stroke, context);
  }

  if (currentStroke?.type === "lasso" && currentStroke.pageId === pageId) {
    drawLassoPath(currentStroke.points, context, false);
  }

  if (currentStroke?.type === "move-selection" && currentStroke.pageId === pageId) {
    for (const item of currentStroke.items) {
      const stroke = page.strokes[item.index];
      if (stroke) {
        drawStroke(stroke, context);
      }
    }
  }

  if (lassoSelection?.pageId === pageId) {
    drawLassoSelection(lassoSelection, context);
  }
}

function updatePaperPatterns() {
  for (const canvas of getPageCanvases()) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }

    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const ruleStep = Math.max(8, Math.round(notebookRuleSpacing * scaleY));
    const topMargin = Math.max(ruleStep, Math.round(notebookTopMargin * scaleY));
    const leftMargin = Math.max(18, Math.round(notebookLeftMargin * scaleX));
    const rightMargin = Math.max(18, Math.round(notebookRightMargin * scaleX));
    const bottomMargin = Math.max(ruleStep, Math.round(notebookBottomMargin * scaleY));
    const dotStep = Math.max(18, Math.round(notebookDotSpacing * scaleX));
    const dotRadius = Math.max(1.2, roundToTenth(notebookDotRadius * scaleY));
    const dateLineWidth = Math.max(ruleStep * 3, Math.round(notebookDateLineWidth * scaleX));
    const dateLineTop = Math.max(ruleStep, Math.round(notebookDateLineTop * scaleY));

    canvas.style.setProperty("--notebook-rule-step", `${ruleStep}px`);
    canvas.style.setProperty("--notebook-top-margin", `${topMargin}px`);
    canvas.style.setProperty("--notebook-left-margin", `${leftMargin}px`);
    canvas.style.setProperty("--notebook-right-margin", `${rightMargin}px`);
    canvas.style.setProperty("--notebook-bottom-margin", `${bottomMargin}px`);
    canvas.style.setProperty("--notebook-dot-step", `${dotStep}px`);
    canvas.style.setProperty("--notebook-dot-radius", `${dotRadius}px`);
    canvas.style.setProperty("--notebook-date-line-width", `${dateLineWidth}px`);
    canvas.style.setProperty("--notebook-date-line-top", `${dateLineTop}px`);
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

function drawLassoSelection(selection, targetContext) {
  drawLassoPath(selection.polygon, targetContext, true);
}

function drawLassoPath(points, targetContext, closed) {
  if (points.length < 2) {
    return;
  }

  targetContext.save();
  targetContext.lineWidth = 3;
  targetContext.lineCap = "round";
  targetContext.lineJoin = "round";
  targetContext.strokeStyle = "rgba(47, 111, 115, 0.88)";
  targetContext.fillStyle = "rgba(47, 111, 115, 0.08)";
  targetContext.beginPath();
  targetContext.moveTo(points[0].x, points[0].y);

  for (const point of points.slice(1)) {
    targetContext.lineTo(point.x, point.y);
  }

  if (closed) {
    targetContext.closePath();
    targetContext.fill();
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
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
