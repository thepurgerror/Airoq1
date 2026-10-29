// =====================================================================
// AIROQ1 — multi-model AI chat (Groq) with Firebase Auth + Firestore
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
  query, orderBy, onSnapshot, serverTimestamp, writeBatch, increment, limit, startAfter,
  enableMultiTabIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCG4Lk2n7v-ygx9cH85r2VWex6BX9yN54s",
  authDomain: "airoq1.firebaseapp.com",
  projectId: "airoq1",
  storageBucket: "airoq1.firebasestorage.app",
  messagingSenderId: "1052517891186",
  appId: "1:1052517891186:web:39b0baf7342f25e212d6eb",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// Offline support: lets you keep reading cached chats with no connection,
// with writes queued locally until you're back online. Multi-tab variant
// so it doesn't break when more than one tab of the app is open at once.
// Best-effort — some browser contexts (private browsing, multiple
// same-origin persistence attempts) can reject this, which is fine; the
// app just falls back to network-only behavior in that case.
try {
  await enableMultiTabIndexedDbPersistence(db);
} catch (err) {
  console.warn("Offline persistence not enabled:", err?.code || err);
}

// ---------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------
const MODELS = [
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", sub: "Reasoning", vision: false, reasoning: true },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", sub: "Reasoning", vision: false, reasoning: true },
  { id: "qwen/qwen3.6-27b", label: "Qwen3.6 27B", sub: "Vision", vision: true },
  { id: "groq/compound", label: "Compound", sub: "Web + Code", vision: false, agentic: true },
  { id: "groq/compound-mini", label: "Compound Mini", sub: "Web + Code", vision: false, agentic: true },
  // Temporary — Groq deprecated these on June 17, 2026 but the actual
  // shutdown isn't until 08/16/26, so they still work for now. Brought
  // back on request as rate-limit fallback headroom. Remove both of these
  // (and their MODEL_TINT entries below) once that date passes, or sooner
  // if Groq cuts them off early.
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", sub: "Legacy · until Aug 16", vision: false, legacy: true },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", sub: "Legacy · until Aug 16", vision: false, legacy: true },
];
const VISION_MODEL_ID = "qwen/qwen3.6-27b";
// Deliberately not gpt-oss-20b: it's flagged reasoning:true, and without
// reasoning_format handling in the raw fetch calls that use this constant
// (autoTitleChat, runAutoSummarize), a reasoning model risks leaking
// <think>-style content into what's supposed to be a clean title/summary
// — exactly the failure mode we already hit once with Compound. Qwen
// sidesteps that risk entirely for this narrow, tightly-scoped use.
const TITLER_MODEL_ID = "qwen/qwen3.6-27b";
const MAX_IMAGES = 6;
const MAX_FILES = 4;
const MAX_FILE_CHARS = 30000;
const MESSAGES_PAGE_SIZE = 50;
const MEMORY_KEEP_RECENT = 6;
const MEMORY_RESUMMARIZE_EVERY = 6;
const MEMORY_TRIGGER_MIN_MESSAGES = MEMORY_KEEP_RECENT + 2;
// A handful of very long messages (someone pasting a big doc, long code,
// etc.) can balloon context well before the message-count trigger fires.
// This catches that case independently, by character volume instead of turn count.
const MEMORY_TRIGGER_CHARS = 12000;
// Images and file text are the real cost driver, not plain text — a single
// attached image's base64 data URL alone can run tens of thousands of
// characters, and a file can carry up to MAX_FILE_CHARS on its own. Only
// the last couple of messages keep their full media payload; anything
// older gets it stripped to a lightweight text note instead, even though
// its surrounding conversation text is still sent normally.
const MEMORY_KEEP_MEDIA_RECENT = 2;

// Subtle per-model avatar tint so a long multi-model chat is easier to scan.
const MODEL_TINT = {
  "openai/gpt-oss-120b": "violet",
  "openai/gpt-oss-20b": "violet",
  "qwen/qwen3.6-27b": "teal",
  "groq/compound": "green",
  "groq/compound-mini": "green",
  "llama-3.1-8b-instant": "amber",
  "llama-3.3-70b-versatile": "amber",
};

const SYSTEM_PROMPT =
  "You are Airoq1, a helpful, precise AI assistant. Format every response in clean Markdown " +
  "(headings, lists, tables, fenced code blocks with a language tag). For any mathematical " +
  "notation, use LaTeX delimiters: $...$ for inline math and $$...$$ for display math. " +
  "Be accurate and direct; give depth when the question calls for it, brevity otherwise.";

const MAX_CONTEXT_CHARS = 24000;

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const initialLoader = $("initialLoader");
const authGate = $("authGate");
const appEl = $("app");
const googleSignInBtn = $("googleSignInBtn");

const shareViewEl = $("shareView");
const shareTitleEl = $("shareTitle");
const shareMessagesEl = $("shareMessages");
const shareSignInCta = $("shareSignInCta");

const sidebar = $("sidebar");
const sidebarBackdrop = $("sidebarBackdrop");
const sidebarCollapseBtn = $("sidebarCollapseBtn");
const menuToggleBtn = $("menuToggleBtn");
const newChatBtn = $("newChatBtn");
const chatListEl = $("chatList");
const chatSearchInput = $("chatSearchInput");

const userAvatar = $("userAvatar");
const userName = $("userName");
const settingsBtn = $("settingsBtn");
const usageBtn = $("usageBtn");

const chatTitleEl = $("chatTitle");
const mobileModelBtn = $("mobileModelBtn");
const mobileModelLabelEl = $("mobileModelLabel");
const modelSelectBtn = $("modelSelectBtn");
const modelSelectLabelEl = $("modelSelectLabel");
const modelSelectSubEl = $("modelSelectSub");
const modelDropdown = $("modelDropdown");
const advancedBtn = $("advancedBtn");
const compareBtn = $("compareBtn");
const compareBanner = $("compareBanner");
const compareModelSelector = $("compareModelSelector");
const compareExitBtn = $("compareExitBtn");
const comparePickerOverlay = $("comparePickerOverlay");
const comparePickerList = $("comparePickerList");
const comparePickerCancel = $("comparePickerCancel");
const comparePickerStart = $("comparePickerStart");
const compareColumnsEl = $("compareColumns");
const webSearchToggle = $("webSearchToggle");
const cmdPaletteModal = $("cmdPaletteModal");
const cmdInput = $("cmdInput");
const cmdResults = $("cmdResults");
const messagesEl = $("messages");

const imagePreview = $("imagePreview");
const composerForm = $("composerForm");
const attachBtn = $("attachBtn");
const fileInput = $("fileInput");
const promptInput = $("promptInput");
const sendBtn = $("sendBtn");

const settingsModal = $("settingsModal");
const apiKeyInput = $("apiKeyInput");
const toggleKeyBtn = $("toggleKeyBtn");
const themeChips = document.querySelectorAll(".theme-chip");
const saveSettingsBtn = $("saveSettingsBtn");
const signOutBtn = $("signOutBtn");

const advancedModal = $("advancedModal");
const tempSlider = $("tempSlider");
const tempValueEl = $("tempValue");
const maxTokensInput = $("maxTokensInput");
const systemPromptInput = $("systemPromptInput");
const resetAdvancedBtn = $("resetAdvancedBtn");
const saveAdvancedBtn = $("saveAdvancedBtn");

const usageModal = $("usageModal");
const usageModalBody = $("usageModalBody");

const confirmModal = $("confirmModal");
const confirmMessageEl = $("confirmMessage");
const confirmCancelBtn = $("confirmCancelBtn");
const confirmOkBtn = $("confirmOkBtn");

const promptModal = $("promptModal");
const promptModalLabelEl = $("promptModalLabel");
const promptModalInput = $("promptModalInput");
const promptCancelBtn = $("promptCancelBtn");
const promptOkBtn = $("promptOkBtn");

const chatMenuEl = $("chatMenu");
const modelSheetOverlay = $("modelSheetOverlay");
const modelSheetList = $("modelSheetList");

const imageLightbox = $("imageLightbox");
const lightboxImg = $("lightboxImg");
const lightboxCloseBtn = $("lightboxClose");

const printAreaEl = $("printArea");
const toastContainer = $("toastContainer");
const offlineBanner = $("offlineBanner");
const jumpToBottomBtn = $("jumpToBottomBtn");
const jumpToBottomLabelEl = $("jumpToBottomLabel");
const filePreview = $("filePreview");
const sidebarResizeHandle = $("sidebarResizeHandle");
const memoryStatusBox = $("memoryStatusBox");
const memoryActiveBadge = $("memoryActiveBadge");

// Browser tab title mirrors whatever's open: "Airoq1 — {chat title}" while
// a chat is active, falling back to the page's own default title (read
// straight from <title> rather than duplicated as a string here, so the
// two can never drift out of sync) when signed out or on the auth gate.
const DEFAULT_TAB_TITLE = document.title;
function setChatTitle(title) {
  const t = (title || "New chat").trim() || "New chat";
  chatTitleEl.textContent = t;
  document.title = `Airoq1 — ${t}`;
}
function resetTabTitle() { document.title = DEFAULT_TAB_TITLE; }

const SEND_SVG = `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 11l18-8-8 18-2-8-8-2z"/></svg>`;
const STOP_SVG = `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>`;
const SPARK_SVG = `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let currentUser = null;
let currentChatId = null;
let currentMessages = []; // {docId, role, content, images, model, finishReason}
let selectedModel = MODELS[0].id;
let attachedImages = []; // [{dataUrl}]
let isStreaming = false;
let abortController = null;
let activePlaceholderEl = null;
let streamingBuffer = "";
let streamingReasoningBuffer = "";
let draftSaveTimer = null;
let unsubChats = null;
let unsubMessages = null;
let allChatsCache = [];
let chatContentCache = new Map();
let collapsedSections = new Set();
let openMenuAnchor = null;
let confirmResolve = null;
let promptResolve = null;
let hasAutoOpened = false;
let searchDebounceTimer = null;
let chatSettings = { temperature: 0.7, maxTokens: 4096, systemPrompt: null };
let isShareMode = false;

// Windowed message loading
let oldestLoadedDoc = null;
let hasMoreOlderMessages = false;

// Respectful auto-scroll
let isNearBottom = true;
let scrollSaveTimer = null;

// File attachments (PDF/txt/md/csv alongside images)
let attachedFiles = []; // [{name, text, charCount}]
let pdfjsReadyPromise = null;
let renderLibsReadyPromise = null;

// Rolling context memory note (token-usage optimization for long chats)
let memoryNote = null;
let memoryCoversUntilDocId = null;
let memoryLastSavedTokens = 0;

// Web search tool (for non-agentic models)
let webSearchEnabled = false;

// Compare mode — ephemeral, in-memory only, never persisted to Firestore
let isCompareMode = false;
let compareModels = [];
let compareColumnsState = new Map(); // modelId -> {history, el, controller, buffer, reasoningBuffer, startTime}
let comparePickerSelection = new Set();

// Command palette
let cmdActiveIndex = 0;
let cmdCurrentItems = [];

// ---------------------------------------------------------------------
// Share-link mode (no auth) — set this synchronously before anything else
// ---------------------------------------------------------------------
const shareParam = new URLSearchParams(location.search).get("share");
if (shareParam) {
  isShareMode = true;
  loadSharedChat(shareParam);
}
shareSignInCta.addEventListener("click", () => {
  location.href = location.pathname;
});

async function loadSharedChat(shareId) {
  await ensureRenderLibsLoaded().catch(() => {});
  try {
    const snap = await getDoc(doc(db, "sharedChats", shareId));
    if (!snap.exists()) {
      shareMessagesEl.innerHTML = `<p class="chat-list-empty">This share link is no longer available.</p>`;
    } else {
      const data = snap.data();
      shareTitleEl.textContent = data.title || "Shared chat";
      document.title = `Airoq1 — ${data.title || "Shared chat"}`;
      shareMessagesEl.innerHTML = "";
      (data.messages || []).forEach((m, i) =>
        shareMessagesEl.appendChild(buildMessageEl({ ...m, _readonly: true }, i))
      );
    }
  } catch (err) {
    shareMessagesEl.innerHTML = `<p class="chat-list-empty">Could not load this chat: ${escapeHtml(err.message)}</p>`;
  }
  shareViewEl.hidden = false;
  hideInitialLoader();
}

shareMessagesEl.addEventListener("click", (e) => {
  const img = e.target.closest(".msg-image");
  if (img) { openLightbox(img.src); return; }
  const copyBtn = e.target.closest(".act-copy");
  if (copyBtn) {
    const text = copyBtn.closest(".bubble").querySelector(".content").textContent;
    navigator.clipboard.writeText(text);
    toastCopied();
  }
});

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
applyTheme(localStorage.getItem("flint_theme") || "dark");
function applyTheme(theme) {
  // Add the transition class briefly so the colour swap eases in rather
  // than snapping, then remove it so it never adds overhead at other times.
  document.documentElement.classList.add("theme-transitioning");
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("flint_theme", theme);
  themeChips.forEach((c) => c.classList.toggle("active", c.dataset.themeChoice === theme));
  setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 350);
}
themeChips.forEach((chip) => chip.addEventListener("click", () => applyTheme(chip.dataset.themeChoice)));

// ---------------------------------------------------------------------
// Offline detection — show/hide a sticky banner at the top of the page
// ---------------------------------------------------------------------
function setOfflineState(offline) {
  offlineBanner.classList.toggle("show", offline);
}
window.addEventListener("online", () => setOfflineState(false));
window.addEventListener("offline", () => setOfflineState(true));
if (!navigator.onLine) setOfflineState(true);

function hideInitialLoader() {
  initialLoader.classList.add("fade-out");
  setTimeout(() => { initialLoader.hidden = true; }, 360);
}

// ---------------------------------------------------------------------
// Mobile viewport fix — "the 100vh problem". Mobile browsers resize the
// visible area when the toolbar collapses or the keyboard opens, but the
// vh unit doesn't track that. We use 100dvh as a CSS baseline and this
// visualViewport listener as a precise live fallback for the keyboard case.
// ---------------------------------------------------------------------
function setupViewportHeightFix() {
  if (!window.visualViewport) return;
  const setVh = () => {
    document.documentElement.style.setProperty("--app-vh", `${window.visualViewport.height}px`);
  };
  setVh();
  window.visualViewport.addEventListener("resize", setVh);
  window.visualViewport.addEventListener("scroll", setVh);
}
setupViewportHeightFix();

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
onAuthStateChanged(auth, (user) => {
  if (isShareMode) { hideInitialLoader(); return; }
  hideInitialLoader();
  if (user) {
    currentUser = user;
    authGate.hidden = true;
    appEl.hidden = false;
    userAvatar.src = user.photoURL || "";
    userName.textContent = user.displayName || user.email || "Account";
    updateModelSelectorUI();
    updateWebSearchToggleUI();
    showEmptyState();
    resetTabTitle();
    hasAutoOpened = false;
    listenChatList();
    ensureRenderLibsLoaded().catch(() => {}); // best-effort prefetch, errors handled at point of use
  } else {
    currentUser = null;
    appEl.hidden = true;
    authGate.hidden = false;
    resetTabTitle();
    if (unsubChats) { unsubChats(); unsubChats = null; }
    if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  }
});

googleSignInBtn.addEventListener("click", async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { toast("Sign-in failed: " + err.message, "error"); }
});
signOutBtn.addEventListener("click", async () => { await signOut(auth); closeSettings(); });

// ---------------------------------------------------------------------
// Generic modal helpers
// ---------------------------------------------------------------------
document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", () => { closeModal(btn.closest(".modal-overlay")); });
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(overlay); });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-overlay:not([hidden])").forEach((m) => closeModal(m));
  if (!chatMenuEl.hidden) closeChatMenu();
  if (!imageLightbox.hidden) closeLightbox();
  if (!modelDropdown.hidden) closeModelDropdown();
});

// ---------------------------------------------------------------------
// Focus trapping — while any modal/lightbox is open, Tab should never
// escape to whatever's behind it. A MutationObserver watches every one
// of them for its `hidden` attribute changing, so this covers every
// current modal (and any added later) from a single place rather than
// needing each one's own open/close code to remember to wire it up.
// ---------------------------------------------------------------------
let focusTrapCleanup = null;
let focusTrapReturnEl = null;

function getFocusableEls(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((el) => el.offsetParent !== null);
}

function trapFocus(container) {
  releaseFocusTrap();
  focusTrapReturnEl = document.activeElement;
  const focusables = getFocusableEls(container);
  (focusables[0] || container).focus({ preventScroll: true });

  const handler = (e) => {
    if (e.key !== "Tab") return;
    const els = getFocusableEls(container);
    if (els.length === 0) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener("keydown", handler);
  focusTrapCleanup = () => container.removeEventListener("keydown", handler);
}
function releaseFocusTrap() {
  if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
  if (focusTrapReturnEl && document.body.contains(focusTrapReturnEl)) {
    focusTrapReturnEl.focus({ preventScroll: true });
  }
  focusTrapReturnEl = null;
}
document.querySelectorAll(".modal-overlay, .lightbox").forEach((container) => {
  new MutationObserver(() => {
    if (!container.hidden) trapFocus(container);
    else releaseFocusTrap();
  }).observe(container, { attributes: true, attributeFilter: ["hidden"] });
});

// ---------------------------------------------------------------------
// Animated modal open/close. Entrance is pure CSS — a @keyframes
// animation runs automatically the instant `hidden` is removed, no JS
// needed. Exit can't work that way (removing the element from the render
// tree gives it no chance to animate out), so this adds `.modal-closing`
// first, lets the matching CSS exit keyframe play, then applies `hidden`
// once it's actually finished. 180ms covers the longest exit animation
// in use (the bottom sheet's slide-down) with a little headroom.
//
// modalCloseTimers tracks each element's pending close timeout, so a
// close immediately followed by a reopen (e.g. a fast double-click)
// cancels the in-flight close instead of it silently firing later and
// hiding a modal the user just reopened.
// ---------------------------------------------------------------------
const MODAL_CLOSE_MS = 180;
const modalCloseTimers = new WeakMap();
function openModal(el) {
  if (!el) return;
  const pending = modalCloseTimers.get(el);
  if (pending) { clearTimeout(pending); modalCloseTimers.delete(el); }
  el.classList.remove("modal-closing");
  if (!el.hidden) return;
  el.hidden = false;
}
function closeModal(el) {
  if (!el || el.hidden || el.classList.contains("modal-closing")) return;
  el.classList.add("modal-closing");
  const timer = setTimeout(() => {
    el.hidden = true;
    el.classList.remove("modal-closing");
    modalCloseTimers.delete(el);
  }, MODAL_CLOSE_MS);
  modalCloseTimers.set(el, timer);
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (isShareMode) return;
    if (cmdPaletteModal.hidden) openCmdPalette(); else closeCmdPalette();
  }
});

// ---------------------------------------------------------------------
// Command palette (Ctrl/Cmd+K) — jump to a chat, switch model, or run a
// quick action, all from the keyboard.
// ---------------------------------------------------------------------
function openCmdPalette() {
  openModal(cmdPaletteModal);
  cmdInput.value = "";
  cmdActiveIndex = 0;
  renderCmdResults("");
  setTimeout(() => cmdInput.focus(), 30);
}
function closeCmdPalette() { closeModal(cmdPaletteModal); }

function getCmdActions() {
  const actions = [
    { icon: "plus", label: "New chat", run: () => { startNewChatLocal(); closeMobileSidebar(); } },
    { icon: "theme", label: "Toggle theme", run: () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark") },
    { icon: "gear", label: "Open settings", run: openSettings },
    { icon: "usage", label: "Open usage dashboard", run: openUsageModal },
    { icon: "compare", label: "Compare models…", run: openComparePicker },
    { icon: "sidebar", label: "Toggle sidebar", run: () => sidebar.classList.toggle("collapsed") },
  ];
  if (currentChatId) {
    actions.push(
      { icon: "settings2", label: "This chat's settings…", run: () => advancedBtn.click() },
      { icon: "export", label: "Export this chat as Markdown", run: () => exportChat(currentChatId, "md") },
      { icon: "export", label: "Export this chat as JSON", run: () => exportChat(currentChatId, "json") },
      { icon: "share", label: "Copy share link for this chat", run: () => shareChat(currentChatId) },
      { icon: "trash", label: "Clear all messages in this chat", run: async () => { const ok = await showConfirmModal("Clear all messages in this chat?"); if (ok) { const removed = truncateFromIndexLocal(0); await deleteMessagesBatch(removed); } } },
      { icon: "spark", label: "Re-summarize context now", run: () => currentChatId && runAutoSummarize(currentChatId) },
    );
  }
  return actions;
}
const CMD_ICONS = {
  plus: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>`,
  theme: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.4 5.4 0 0 1-7.54-7.54A9 9 0 0 0 12 3z"/></svg>`,
  gear: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94a7 7 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L1.78 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7 7 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.4.32.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.47 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>`,
  usage: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z"/></svg>`,
  compare: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h6v16H4V4zm10 0h6v16h-6V4z"/></svg>`,
  sidebar: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M3 4h18v16H3V4zm2 2v12h4V6H5zm6 0v12h8V6h-8z"/></svg>`,
  settings2: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>`,
  export: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6z"/></svg>`,
  share: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M3.9 12a4.1 4.1 0 0 1 4.1-4.1h3V6.1H8a6 6 0 0 0 0 12h3v-1.8H8A4.1 4.1 0 0 1 3.9 12z"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z"/></svg>`,
  spark: SPARK_SVG,
  chat: `<svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg>`,
  model: SPARK_SVG,
};

function renderCmdResults(term) {
  const q = term.trim().toLowerCase();
  cmdCurrentItems = [];

  const chatMatches = (q ? allChatsCache.filter((c) => (c.title || "").toLowerCase().includes(q)) : allChatsCache.slice(0, 6))
    .slice(0, 8)
    .map((c) => ({ section: "Chats", icon: "chat", label: c.title || "New chat", run: () => { openChat(c.id); closeCmdPalette(); } }));

  const modelMatches = MODELS.filter((m) => !q || m.label.toLowerCase().includes(q) || m.sub.toLowerCase().includes(q))
    .map((m) => ({ section: "Models", icon: "model", label: `Switch to ${m.label}`, run: () => { selectModel(m.id); closeCmdPalette(); } }));

  const actionMatches = getCmdActions()
    .filter((a) => !q || a.label.toLowerCase().includes(q))
    .map((a) => ({ section: "Actions", icon: a.icon, label: a.label, run: () => { a.run(); closeCmdPalette(); } }));

  cmdCurrentItems = [...actionMatches, ...chatMatches, ...(q ? modelMatches : modelMatches.slice(0, 3))];

  if (cmdCurrentItems.length === 0) {
    cmdResults.innerHTML = `<div class="cmd-empty">No matches for "${escapeHtml(term)}"</div>`;
    return;
  }

  let html = "";
  let lastSection = null;
  cmdCurrentItems.forEach((item, i) => {
    if (item.section !== lastSection) { html += `<div class="cmd-section-label">${item.section}</div>`; lastSection = item.section; }
    html += `<div class="cmd-item ${i === cmdActiveIndex ? "active" : ""}" data-i="${i}">${CMD_ICONS[item.icon] || ""}<span class="cmd-item-label">${escapeHtml(item.label)}</span></div>`;
  });
  cmdResults.innerHTML = html;
}

cmdInput.addEventListener("input", () => { cmdActiveIndex = 0; renderCmdResults(cmdInput.value); });
cmdInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); cmdActiveIndex = Math.min(cmdActiveIndex + 1, cmdCurrentItems.length - 1); renderCmdResults(cmdInput.value); }
  else if (e.key === "ArrowUp") { e.preventDefault(); cmdActiveIndex = Math.max(cmdActiveIndex - 1, 0); renderCmdResults(cmdInput.value); }
  else if (e.key === "Enter") { e.preventDefault(); cmdCurrentItems[cmdActiveIndex]?.run(); }
});
cmdResults.addEventListener("click", (e) => {
  const item = e.target.closest(".cmd-item");
  if (!item) return;
  cmdCurrentItems[Number(item.dataset.i)]?.run();
});
cmdResults.addEventListener("mousemove", (e) => {
  const item = e.target.closest(".cmd-item");
  if (!item) return;
  const i = Number(item.dataset.i);
  if (i !== cmdActiveIndex) { cmdActiveIndex = i; renderCmdResults(cmdInput.value); }
});

function showConfirmModal(message) {
  confirmMessageEl.textContent = message;
  openModal(confirmModal);
  return new Promise((resolve) => { confirmResolve = resolve; });
}
confirmOkBtn.addEventListener("click", () => { closeModal(confirmModal); confirmResolve?.(true); confirmResolve = null; });
confirmCancelBtn.addEventListener("click", () => { closeModal(confirmModal); confirmResolve?.(false); confirmResolve = null; });

function showPromptModal(label, placeholder, defaultValue) {
  promptModalLabelEl.textContent = label;
  promptModalInput.placeholder = placeholder || "";
  promptModalInput.value = defaultValue || "";
  openModal(promptModal);
  setTimeout(() => promptModalInput.focus(), 50);
  return new Promise((resolve) => { promptResolve = resolve; });
}
promptOkBtn.addEventListener("click", () => {
  const v = promptModalInput.value;
  closeModal(promptModal); promptResolve?.(v); promptResolve = null;
});
promptCancelBtn.addEventListener("click", () => { closeModal(promptModal); promptResolve?.(null); promptResolve = null; });
promptModalInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); promptOkBtn.click(); } });

// ---------------------------------------------------------------------
// Model selector — mobile bottom sheet (unchanged) + desktop anchored dropdown
// ---------------------------------------------------------------------
function updateModelSelectorUI() {
  const label = modelLabel(selectedModel);
  const sub = MODELS.find((m) => m.id === selectedModel)?.sub || "";
  mobileModelLabelEl.textContent = label;
  modelSelectLabelEl.textContent = label;
  modelSelectSubEl.textContent = sub;
}
mobileModelBtn.addEventListener("click", () => {
  modelSheetList.innerHTML = MODELS.map(
    (m) => `<div class="model-sheet-item ${m.id === selectedModel ? "active" : ""} ${m.legacy ? "legacy" : ""}" data-model="${m.id}">
      <span><span class="msi-label">${m.label}</span><div class="msi-sub">${m.sub}</div></span></div>`
  ).join("");
  openModal(modelSheetOverlay);
});
modelSheetList.addEventListener("click", (e) => {
  const item = e.target.closest(".model-sheet-item");
  if (!item) return;
  selectModel(item.dataset.model);
  closeModal(modelSheetOverlay);
});

function renderModelDropdownList() {
  modelDropdown.innerHTML = MODELS.map((m) => {
    const active = m.id === selectedModel;
    return `<button type="button" class="model-dropdown-item ${active ? "active" : ""} ${m.legacy ? "legacy" : ""}" role="option" aria-selected="${active}" data-model="${m.id}">
      <span><span class="mdi-label">${m.label}</span><div class="mdi-sub">${m.sub}</div></span>
      <svg class="mdi-check" width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
    </button>`;
  }).join("");
}
function openModelDropdown() {
  renderModelDropdownList();
  openModal(modelDropdown);
  modelSelectBtn.setAttribute("aria-expanded", "true");
  const rect = modelSelectBtn.getBoundingClientRect();
  const menuWidth = modelDropdown.offsetWidth || 250;
  const menuHeight = modelDropdown.offsetHeight || 320;
  let left = rect.right - menuWidth;
  let top = rect.bottom + 6;
  if (left < 8) left = 8;
  if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 6);
  modelDropdown.style.left = `${left}px`;
  modelDropdown.style.top = `${top}px`;
}
function closeModelDropdown() {
  closeModal(modelDropdown);
  modelSelectBtn.setAttribute("aria-expanded", "false");
}
modelSelectBtn.addEventListener("click", () => {
  if (modelDropdown.hidden) openModelDropdown(); else closeModelDropdown();
});
modelDropdown.addEventListener("click", (e) => {
  const item = e.target.closest(".model-dropdown-item");
  if (!item) return;
  selectModel(item.dataset.model);
  closeModelDropdown();
});
document.addEventListener("click", (e) => {
  if (modelDropdown.hidden) return;
  if (modelDropdown.contains(e.target) || modelSelectBtn.contains(e.target)) return;
  closeModelDropdown();
});

function selectModel(id) {
  selectedModel = id;
  updateModelSelectorUI();
  updateWebSearchToggleUI();
  if (currentChatId) {
    updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), { model: id }).catch(() => {});
  }
}
function modelLabel(id) { return MODELS.find((m) => m.id === id)?.label || id; }
function sanitizeModelKey(id) { return (id || "unknown").replace(/[.\/]/g, "_"); }

// ---------------------------------------------------------------------
// Chat list: live, grouped (pinned / folders / unfiled), searchable
// ---------------------------------------------------------------------
function listenChatList() {
  if (unsubChats) unsubChats();
  renderChatListSkeleton();
  const q = query(collection(db, "users", currentUser.uid, "chats"), orderBy("updatedAt", "desc"));
  unsubChats = onSnapshot(
    q,
    (snap) => {
      allChatsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderChatListView();
      if (!hasAutoOpened) {
        hasAutoOpened = true;
        if (allChatsCache.length && !currentChatId) openChat(allChatsCache[0].id);
      }
    },
    (err) => console.warn("chat list listener error", err)
  );
}

function renderChatListSkeleton() {
  chatListEl.innerHTML = Array.from({ length: 5 }).map(() => `<div class="skeleton skeleton-row"></div>`).join("");
}

function renderChatListView() {
  const term = chatSearchInput.value.trim().toLowerCase();
  if (term) runSearch(term);
  else renderChatListGrouped(allChatsCache);
}

// ---------------------------------------------------------------------
// Keyed-diff reconciliation for the chat list.
//
// The chat list used to be a full innerHTML rebuild on every Firestore
// snapshot — meaning ANY change to ANY chat (a title edit, a pin toggle, a
// new message elsewhere bumping updatedAt and re-sorting) tore down and
// recreated every row in the sidebar, even ones that didn't change. That's
// wasteful, causes visible flicker, and is exactly the shape of bug class
// that produced the double-render issue fixed earlier — full rebuilds make
// it easy for a stray re-render to race with something else.
//
// This keeps a persistent DOM node per chat (and per section header),
// keyed by a stable id, and only patches what actually changed: text
// content, an active/collapsed class, a pin-dot's visibility. Nodes are
// created once and reordered via insertBefore rather than recreated.
// ---------------------------------------------------------------------
function reconcileChildren(container, rows, buildEl, patchEl) {
  const existing = new Map();
  for (const child of container.children) {
    if (child.dataset.rowKey) existing.set(child.dataset.rowKey, child);
  }
  let cursor = container.firstChild;
  for (const row of rows) {
    let el = existing.get(row.key);
    if (el) {
      existing.delete(row.key);
      patchEl(el, row);
    } else {
      el = buildEl(row);
      el.dataset.rowKey = row.key;
    }
    if (cursor !== el) container.insertBefore(el, cursor);
    cursor = el.nextSibling;
  }
  // Anything left in `existing` is a key that no longer appears — remove it.
  for (const leftover of existing.values()) leftover.remove();
}

function buildChatRowEl(row) {
  if (row.type === "header") {
    const el = document.createElement("div");
    el.className = "chat-section-header";
    el.dataset.section = row.sectionKey;
    patchChatRowEl(el, row);
    return el;
  }
  const el = document.createElement("div");
  el.className = "chat-item";
  el.dataset.id = row.chat.id;
  el.innerHTML = `
    <span class="chat-item-pin-dot" hidden><svg width="11" height="11" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></span>
    <span class="chat-item-title"></span>
    <button class="chat-item-menu-btn" type="button" aria-label="Chat options">
      <svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
    </button>`;
  el.querySelector(".chat-item-menu-btn").dataset.id = row.chat.id;
  patchChatRowEl(el, row);
  return el;
}

function patchChatRowEl(el, row) {
  if (row.type === "header") {
    el.classList.toggle("collapsed", row.collapsed);
    // Rebuilt lazily only if content actually differs, to avoid touching
    // the DOM (and thus triggering a reflow) for headers whose count hasn't moved.
    const wantHtml = `<svg width="11" height="11" viewBox="0 0 24 24"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>${escapeHtml(row.label)}<span class="chat-section-count">${row.count}</span>`;
    if (el.dataset.renderedHtml !== wantHtml) { el.innerHTML = wantHtml; el.dataset.renderedHtml = wantHtml; }
    return;
  }
  const active = row.chat.id === currentChatId;
  el.classList.toggle("active", active);
  const titleEl = el.querySelector(".chat-item-title");
  const wantTitle = row.chat.title || "New chat";
  if (titleEl.textContent !== wantTitle) titleEl.textContent = wantTitle;
  el.querySelector(".chat-item-pin-dot").hidden = !row.chat.pinned;
}

const DATE_BUCKET_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
function relativeDateBucket(updatedAtSeconds) {
  // Missing timestamp almost always means a just-created chat whose
  // serverTimestamp() hasn't round-tripped back yet — "Today" is a far
  // more sensible default than "Older" for that transient split second.
  if (!updatedAtSeconds) return "Today";
  const date = new Date(updatedAtSeconds * 1000);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(startOfToday); startOfMonth.setDate(startOfMonth.getDate() - 30);
  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  if (date >= startOfWeek) return "Previous 7 days";
  if (date >= startOfMonth) return "Previous 30 days";
  return "Older";
}
function groupByDateBucket(chats) {
  const buckets = new Map();
  for (const c of chats) {
    const b = relativeDateBucket(c.updatedAt?.seconds);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(c);
  }
  return buckets;
}

function buildChatListRows(chats) {
  const pinned = chats.filter((c) => c.pinned);
  const rest = chats.filter((c) => !c.pinned);
  const folderMap = new Map();
  const unfiled = [];
  rest.forEach((c) => {
    if (c.folder) {
      if (!folderMap.has(c.folder)) folderMap.set(c.folder, []);
      folderMap.get(c.folder).push(c);
    } else unfiled.push(c);
  });
  const folderNames = Array.from(folderMap.keys()).sort((a, b) => a.localeCompare(b));

  const rows = [];
  const addSection = (sectionKey, label, sectionChats) => {
    if (sectionChats.length === 0) return;
    if (label) {
      rows.push({ type: "header", key: `header:${sectionKey}`, sectionKey, label, count: sectionChats.length, collapsed: collapsedSections.has(sectionKey) });
    }
    if (label && collapsedSections.has(sectionKey)) return; // collapsed — hide its items
    sectionChats.forEach((c) => rows.push({ type: "item", key: `item:${c.id}`, chat: c }));
  };
  addSection("pinned", "Pinned", pinned);
  folderNames.forEach((name) => addSection(`folder:${name}`, name, folderMap.get(name)));
  if (unfiled.length) {
    const dateBuckets = groupByDateBucket(unfiled);
    for (const bucketName of DATE_BUCKET_ORDER) {
      const bucketChats = dateBuckets.get(bucketName);
      if (bucketChats?.length) addSection(`date:${bucketName}`, bucketName, bucketChats);
    }
  }
  return rows;
}

function renderChatListGrouped(chats) {
  if (chats.length === 0) {
    chatListEl.innerHTML = `<p class="chat-list-empty">No chats yet — start one below.</p>`;
    return;
  }
  // Coming from the empty-state paragraph (or a fresh skeleton) — clear it
  // so the reconciler starts from a clean keyed slate.
  if (chatListEl.querySelector(".chat-list-empty, .skeleton-row")) chatListEl.innerHTML = "";
  const rows = buildChatListRows(chats);
  reconcileChildren(chatListEl, rows, buildChatRowEl, patchChatRowEl);
}

chatListEl.addEventListener("click", (e) => {
  const sectionHeader = e.target.closest(".chat-section-header");
  if (sectionHeader) {
    const key = sectionHeader.dataset.section;
    if (collapsedSections.has(key)) collapsedSections.delete(key); else collapsedSections.add(key);
    renderChatListView();
    return;
  }
  const menuBtn = e.target.closest(".chat-item-menu-btn");
  if (menuBtn) { e.stopPropagation(); openChatMenu(menuBtn.dataset.id, menuBtn); return; }
  const item = e.target.closest(".chat-item");
  if (item) openChat(item.dataset.id);
});

chatSearchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderChatListView, 250);
});

async function runSearch(term) {
  let matches = allChatsCache.filter((c) => (c.title || "").toLowerCase().includes(term));
  const matchedIds = new Set(matches.map((c) => c.id));
  const candidates = allChatsCache.filter((c) => !matchedIds.has(c.id));
  await Promise.all(
    candidates.map(async (c) => {
      if (!chatContentCache.has(c.id)) {
        try {
          const snap = await getDocs(collection(db, "users", currentUser.uid, "chats", c.id, "messages"));
          chatContentCache.set(c.id, snap.docs.map((d) => d.data().content || "").join(" ").toLowerCase());
        } catch { chatContentCache.set(c.id, ""); }
      }
    })
  );
  candidates.forEach((c) => { if (chatContentCache.get(c.id)?.includes(term)) matches.push(c); });
  matches.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  if (chatSearchInput.value.trim().toLowerCase() !== term) return; // stale result, user kept typing
  if (matches.length === 0) {
    chatListEl.innerHTML = `<p class="chat-list-empty">No chats match "${escapeHtml(term)}".</p>`;
    return;
  }
  if (chatListEl.querySelector(".chat-list-empty, .skeleton-row")) chatListEl.innerHTML = "";
  const rows = matches.map((c) => ({ type: "item", key: `item:${c.id}`, chat: c }));
  reconcileChildren(chatListEl, rows, buildChatRowEl, patchChatRowEl);
}

// ---------------------------------------------------------------------
// Chat item context menu
// ---------------------------------------------------------------------
function openChatMenu(chatId, anchorEl) {
  const chat = allChatsCache.find((c) => c.id === chatId);
  chatMenuEl.dataset.chatId = chatId;
  chatMenuEl.querySelector("[data-pin-label]").textContent = chat?.pinned ? "Unpin chat" : "Pin chat";
  openModal(chatMenuEl);
  const rect = anchorEl.getBoundingClientRect();
  const menuWidth = chatMenuEl.offsetWidth || 210;
  const menuHeight = chatMenuEl.offsetHeight || 300;
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight);
  chatMenuEl.style.left = `${Math.max(8, left)}px`;
  chatMenuEl.style.top = `${Math.max(8, top)}px`;
  anchorEl.classList.add("menu-open");
  openMenuAnchor = anchorEl;
}
function closeChatMenu() {
  closeModal(chatMenuEl);
  openMenuAnchor?.classList.remove("menu-open");
  openMenuAnchor = null;
}
document.addEventListener("click", (e) => {
  if (!chatMenuEl.hidden && !chatMenuEl.contains(e.target) && !e.target.closest(".chat-item-menu-btn")) closeChatMenu();
});

// Applies a patch to a cached chat immediately (so the sidebar reflects it
// with zero perceived latency), fires the real write in the background,
// and rolls back + surfaces an error only if that write actually fails.
function applyOptimisticChatPatch(chatId, patch, errorMessage) {
  const chat = allChatsCache.find((c) => c.id === chatId);
  if (!chat) return;
  const previous = {};
  for (const key of Object.keys(patch)) previous[key] = chat[key];
  Object.assign(chat, patch);
  renderChatListView();
  updateDoc(doc(db, "users", currentUser.uid, "chats", chatId), patch).catch((err) => {
    Object.assign(chat, previous);
    renderChatListView();
    toast(errorMessage + ": " + err.message, "error");
  });
}

chatMenuEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".chat-menu-item");
  if (!btn) return;
  const chatId = chatMenuEl.dataset.chatId;
  const action = btn.dataset.action;
  closeChatMenu();
  const chat = allChatsCache.find((c) => c.id === chatId);

  if (action === "pin") {
    applyOptimisticChatPatch(chatId, { pinned: !chat?.pinned }, "Could not update pin");
  } else if (action === "folder") {
    const name = await showPromptModal("Move to folder", "e.g. Research, Personal…", chat?.folder || "");
    if (name === null) return;
    applyOptimisticChatPatch(chatId, { folder: name.trim() || null }, "Could not move chat");
  } else if (action === "export-md") {
    exportChat(chatId, "md");
  } else if (action === "export-json") {
    exportChat(chatId, "json");
  } else if (action === "print") {
    exportChat(chatId, "print");
  } else if (action === "share") {
    shareChat(chatId);
  } else if (action === "delete") {
    const ok = await showConfirmModal("Delete this chat? This can't be undone.");
    if (ok) deleteChatCompletely(chatId);
  }
});

function getChatMessages(chatId) {
  return getDocs(query(collection(db, "users", currentUser.uid, "chats", chatId, "messages"), orderBy("createdAt", "asc"))).then(
    (snap) => snap.docs.map((d) => ({ docId: d.id, ...d.data() }))
  );
}

async function exportChat(chatId, format) {
  const chat = allChatsCache.find((c) => c.id === chatId) || {};
  let msgs;
  try { msgs = await getChatMessages(chatId); }
  catch (err) { toast("Could not load chat: " + err.message, "error"); return; }

  if (format === "json") {
    const payload = {
      title: chat.title || "Chat",
      model: chat.model,
      messages: msgs.map((m) => ({ role: m.role, content: m.content, model: m.model || null, images: getMsgImages(m), files: getMsgFiles(m) })),
    };
    downloadFile(`${slugify(chat.title)}.json`, JSON.stringify(payload, null, 2), "application/json");
  } else if (format === "md") {
    let md = `# ${chat.title || "Chat"}\n\n`;
    msgs.forEach((m) => { md += `**${m.role === "user" ? "You" : "Assistant"}:**\n\n${m.content}\n\n---\n\n`; });
    downloadFile(`${slugify(chat.title)}.md`, md, "text/markdown");
  } else if (format === "print") {
    let html = `<h1>${escapeHtml(chat.title || "Chat")}</h1>`;
    msgs.forEach((m) => {
      html += `<div class="print-msg"><div class="print-role">${m.role === "user" ? "You" : "Assistant"}</div>${renderMessageContent(m.content)}</div>`;
    });
    printAreaEl.innerHTML = html;
    requestAnimationFrame(() => window.print());
  }
}

async function shareChat(chatId) {
  toast("Creating share link…", "info");
  try {
    const chat = allChatsCache.find((c) => c.id === chatId) || {};
    const msgs = await getChatMessages(chatId);
    const shareRef = await addDoc(collection(db, "sharedChats"), {
      title: chat.title || "Shared chat",
      ownerUid: currentUser.uid,
      messages: msgs.map((m) => ({ role: m.role, content: m.content, images: getMsgImages(m) })),
      createdAt: serverTimestamp(),
    });
    const url = `${location.origin}${location.pathname}?share=${shareRef.id}`;
    await navigator.clipboard.writeText(url);
    toast("Share link copied to clipboard.", "success");
  } catch (err) {
    toast("Could not create share link: " + err.message, "error");
  }
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function slugify(str) {
  return (str || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "chat";
}

async function deleteChatCompletely(chatId) {
  try {
    const msgsSnap = await getDocs(collection(db, "users", currentUser.uid, "chats", chatId, "messages"));
    const batch = writeBatch(db);
    msgsSnap.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "users", currentUser.uid, "chats", chatId));
    await batch.commit();
  } catch (err) {
    toast("Could not delete chat: " + err.message, "error");
    return;
  }
  if (chatId === currentChatId) startNewChatLocal();
}

// ---------------------------------------------------------------------
// New chat / open chat / live message sync
// ---------------------------------------------------------------------
newChatBtn.addEventListener("click", () => { startNewChatLocal(); closeMobileSidebar(); });

function startNewChatLocal() {
  saveScrollPositionNow();
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (isStreaming) { abortController?.abort(); }
  isStreaming = false; activePlaceholderEl = null; setComposerStreamingState(false);
  currentChatId = null;
  currentMessages = [];
  oldestLoadedDoc = null;
  hasMoreOlderMessages = false;
  isNearBottom = true;
  hideJumpToBottom();
  chatSettings = { temperature: 0.7, maxTokens: 4096, systemPrompt: null };
  memoryNote = null;
  memoryCoversUntilDocId = null;
  memoryLastSavedTokens = 0;
  renderMemoryStatus();
  showEmptyState();
  setChatTitle("New chat");
  clearAttachedImages();
  clearAttachedFiles();
  promptInput.value = localStorage.getItem(draftKey(null)) || "";
  autoResize();
  renderChatListView();
  promptInput.focus();
}

async function openChat(chatId) {
  if (chatId === currentChatId) { closeMobileSidebar(); return; }
  saveScrollPositionNow();
  if (isStreaming) { abortController?.abort(); }
  isStreaming = false; activePlaceholderEl = null; setComposerStreamingState(false);
  currentChatId = chatId;
  renderChatListView();
  clearAttachedImages();
  clearAttachedFiles();
  promptInput.value = localStorage.getItem(draftKey(chatId)) || "";
  autoResize();

  try {
    const chatSnap = await getDoc(doc(db, "users", currentUser.uid, "chats", chatId));
    const data = chatSnap.data() || {};
    setChatTitle(data.title || "New chat");
    if (data.model && MODELS.some((m) => m.id === data.model)) selectModel(data.model);
    chatSettings = {
      temperature: typeof data.temperature === "number" ? data.temperature : 0.7,
      maxTokens: typeof data.maxTokens === "number" ? data.maxTokens : 4096,
      systemPrompt: data.systemPrompt || null,
    };
    memoryNote = data.memoryNote || null;
    memoryCoversUntilDocId = data.memoryCoversUntilDocId || null;
    memoryLastSavedTokens = data.memoryLastSavedTokens || 0;
    renderMemoryStatus();
  } catch (err) {
    toast("Could not load that chat: " + err.message, "error");
  }

  subscribeMessages(chatId);
  closeMobileSidebar();
}

// Loads the most recent MESSAGES_PAGE_SIZE messages up front (so opening a
// chat with hundreds of messages stays fast), then live-subscribes only to
// anything newer than that. Older history pages in on demand via the
// "Load earlier messages" button, see loadEarlierMessages().
async function subscribeMessages(chatId) {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  currentMessages = [];
  oldestLoadedDoc = null;
  hasMoreOlderMessages = false;
  messagesEl.innerHTML = renderMessageSkeletons();

  let initialDocs;
  try {
    const initialSnap = await getDocs(
      query(collection(db, "users", currentUser.uid, "chats", chatId, "messages"), orderBy("createdAt", "desc"), limit(MESSAGES_PAGE_SIZE))
    );
    initialDocs = initialSnap.docs.slice().reverse();
  } catch (err) {
    if (chatId !== currentChatId) return;
    messagesEl.innerHTML = `<p class="chat-list-empty">Could not load messages: ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (chatId !== currentChatId) return; // user navigated away while this was loading

  currentMessages = initialDocs.map((d) => ({ docId: d.id, ...d.data() }));
  oldestLoadedDoc = initialDocs[0] || null;
  hasMoreOlderMessages = initialDocs.length === MESSAGES_PAGE_SIZE;

  await ensureRenderLibsLoaded().catch(() => {});
  if (chatId !== currentChatId) return;
  renderMessages({ preserveScroll: true });
  restoreScrollPosition(chatId);

  // Live updates for anything newer than the window we just loaded — new
  // sends, replies finishing, or another tab posting into this same chat.
  const baseCol = collection(db, "users", currentUser.uid, "chats", chatId, "messages");
  const liveQuery = initialDocs.length > 0
    ? query(baseCol, orderBy("createdAt", "asc"), startAfter(initialDocs[initialDocs.length - 1]))
    : query(baseCol, orderBy("createdAt", "asc"));

  unsubMessages = onSnapshot(
    liveQuery,
    (snap) => {
      snap.docChanges().forEach((change) => {
        const data = { docId: change.doc.id, ...change.doc.data() };
        if (change.type === "added") {
          if (!currentMessages.some((m) => m.docId === data.docId)) {
            currentMessages.push(data);
            hideEmptyState();
            messagesEl.appendChild(buildMessageEl(data, currentMessages.length - 1));
            maybeAutoScroll();
          }
        } else if (change.type === "removed") {
          if (currentMessages.some((m) => m.docId === data.docId)) {
            currentMessages = currentMessages.filter((m) => m.docId !== data.docId);
            messagesEl.querySelector(`.message[data-doc-id="${data.docId}"]`)?.remove();
            if (currentMessages.length === 0) showEmptyState();
          }
        }
      });
    },
    (err) => console.warn("messages listener error", err)
  );
}

async function loadEarlierMessages() {
  if (!currentChatId || !oldestLoadedDoc || !hasMoreOlderMessages) return;
  const chatId = currentChatId;
  const btn = messagesEl.querySelector(".load-earlier-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
  let olderDocs;
  try {
    const snap = await getDocs(
      query(collection(db, "users", currentUser.uid, "chats", chatId, "messages"), orderBy("createdAt", "desc"), startAfter(oldestLoadedDoc), limit(MESSAGES_PAGE_SIZE))
    );
    olderDocs = snap.docs.slice().reverse();
  } catch (err) {
    toast("Could not load earlier messages: " + err.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Load earlier messages"; }
    return;
  }
  if (chatId !== currentChatId) return;
  if (olderDocs.length > 0) oldestLoadedDoc = olderDocs[0];
  hasMoreOlderMessages = olderDocs.length === MESSAGES_PAGE_SIZE;
  const olderMsgs = olderDocs.map((d) => ({ docId: d.id, ...d.data() }));
  currentMessages = [...olderMsgs, ...currentMessages];

  // Surgical prepend: build DOM only for the newly-loaded older messages
  // and splice them in at the top, rather than re-rendering (and
  // re-running markdown/KaTeX/syntax-highlighting on) every message
  // that's already on screen. Scroll position is preserved by measuring
  // the height added and offsetting by exactly that.
  const prevScrollHeight = messagesEl.scrollHeight;
  const loadEarlierRow = messagesEl.querySelector(".load-earlier-row");
  const insertBeforeNode = loadEarlierRow ? loadEarlierRow.nextSibling : messagesEl.firstChild;
  const frag = document.createDocumentFragment();
  olderMsgs.forEach((m, i) => frag.appendChild(buildMessageEl(m, i)));
  messagesEl.insertBefore(frag, insertBeforeNode);

  if (loadEarlierRow) {
    if (hasMoreOlderMessages) {
      const newBtn = loadEarlierRow.querySelector(".load-earlier-btn");
      newBtn.disabled = false;
      newBtn.textContent = "Load earlier messages";
    } else {
      loadEarlierRow.remove();
    }
  }
  messagesEl.scrollTop = messagesEl.scrollHeight - prevScrollHeight;
}

function renderMessageSkeletons() {
  return Array.from({ length: 3 })
    .map(() => `<div class="skeleton-msg"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:70%"></div></div>`)
    .join("");
}

async function ensureChatDoc() {
  if (currentChatId) return currentChatId;
  const ref = await addDoc(collection(db, "users", currentUser.uid, "chats"), {
    title: "New chat",
    model: selectedModel,
    temperature: chatSettings.temperature,
    maxTokens: chatSettings.maxTokens,
    systemPrompt: chatSettings.systemPrompt,
    pinned: false,
    folder: null,
    memoryNote: null,
    memoryCoversUntilDocId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  currentChatId = ref.id;
  return currentChatId;
}

// editable chat title
chatTitleEl.addEventListener("blur", async () => {
  if (!currentChatId) return;
  const newTitle = chatTitleEl.textContent.trim() || "New chat";
  setChatTitle(newTitle);
  try { await updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), { title: newTitle }); }
  catch (err) { console.warn("rename failed", err); }
});
chatTitleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); chatTitleEl.blur(); } });

// ---------------------------------------------------------------------
// Local truncate + batch delete helpers (used by edit/regenerate/continue/clear)
// ---------------------------------------------------------------------
function truncateFromIndexLocal(index) {
  const removed = currentMessages.slice(index);
  currentMessages = currentMessages.slice(0, index);
  removed.forEach((m) => { if (m.docId) messagesEl.querySelector(`.message[data-doc-id="${m.docId}"]`)?.remove(); });
  if (currentMessages.length === 0) showEmptyState();
  return removed;
}
async function deleteMessagesBatch(msgs) {
  const withDocId = msgs.filter((m) => m.docId);
  if (withDocId.length === 0) return;
  const batch = writeBatch(db);
  withDocId.forEach((m) => batch.delete(doc(db, "users", currentUser.uid, "chats", currentChatId, "messages", m.docId)));
  await batch.commit();
}

// ---------------------------------------------------------------------
// Advanced (per-chat) settings
// ---------------------------------------------------------------------
advancedBtn.addEventListener("click", () => {
  tempSlider.value = chatSettings.temperature;
  tempValueEl.textContent = Number(chatSettings.temperature).toFixed(1);
  maxTokensInput.value = chatSettings.maxTokens;
  systemPromptInput.value = chatSettings.systemPrompt || "";
  openModal(advancedModal);
});
tempSlider.addEventListener("input", () => { tempValueEl.textContent = Number(tempSlider.value).toFixed(1); });
resetAdvancedBtn.addEventListener("click", () => {
  tempSlider.value = 0.7; tempValueEl.textContent = "0.7";
  maxTokensInput.value = 4096; systemPromptInput.value = "";
});
saveAdvancedBtn.addEventListener("click", async () => {
  chatSettings.temperature = parseFloat(tempSlider.value) || 0.7;
  chatSettings.maxTokens = Math.max(256, parseInt(maxTokensInput.value, 10) || 4096);
  chatSettings.systemPrompt = systemPromptInput.value.trim() || null;
  closeModal(advancedModal);
  toast("Chat settings saved.", "success");
  if (currentChatId) {
    try {
      await updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), {
        temperature: chatSettings.temperature,
        maxTokens: chatSettings.maxTokens,
        systemPrompt: chatSettings.systemPrompt,
      });
    } catch (err) { console.warn("save advanced failed", err); }
  }
});

// ---------------------------------------------------------------------
// Lazy-loaded rendering libraries (marked, DOMPurify, KaTeX, highlight.js)
// ---------------------------------------------------------------------
// These are heavy (several hundred KB combined) and aren't needed until
// the first message actually renders, so they're injected as non-blocking
// <script> tags instead of sitting in <head>/<body> as render-blocking
// includes. We kick off the load proactively right after sign-in (in
// parallel with the Firestore round-trip to fetch chats), so by the time
// there's real content to render, they're very likely already in place —
// this speeds up the initial interactive paint without actually delaying
// when markdown/math/code show up in practice.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function ensureRenderLibsLoaded() {
  if (renderLibsReadyPromise) return renderLibsReadyPromise;
  renderLibsReadyPromise = Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/highlight.min.js"),
  ]).then(setupMarkedRenderer).catch((err) => {
    console.warn("Render libraries failed to load:", err);
    renderLibsReadyPromise = null; // allow a retry on next call
    throw err;
  });
  return renderLibsReadyPromise;
}

function setupMarkedRenderer() {
  const renderer = new marked.Renderer();
  renderer.code = function (code, infostring) {
    const lang = (infostring || "").trim().split(/\s+/)[0];
    let highlighted;
    try {
      highlighted = lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
    } catch { highlighted = escapeHtml(code); }
    return `<div class="code-block"><div class="code-block-header"><span>${escapeHtml(lang || "text")}</span><button class="copy-btn" type="button">Copy</button></div><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };
  marked.setOptions({ renderer, breaks: true, gfm: true });
}

function escapeMathAndTokenize(raw) {
  const store = [];
  const place = (tex, display) => { const idx = store.length; store.push({ tex, display }); return `\u0000MATH${idx}\u0000`; };
  let text = raw;
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => place(t.trim(), true));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => place(t.trim(), true));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => place(t.trim(), false));
  text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, t) => place(t.trim(), false));
  return { text, store };
}
function renderMathStore(html, store) {
  return html.replace(/\u0000MATH(\d+)\u0000/g, (_, i) => {
    const item = store[Number(i)];
    if (!item) return "";
    try { return katex.renderToString(item.tex, { displayMode: item.display, throwOnError: false }); }
    catch { return `<code>${escapeHtml(item.tex)}</code>`; }
  });
}
function renderMessageContent(raw) {
  if (!raw) return "";
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined" || typeof katex === "undefined") {
    // Libraries still loading (rare — only possible in the first instant
    // after sign-in on a slow connection). Show safely escaped plain text;
    // the next re-render (streaming tick, or the libs-ready re-render pass)
    // will swap in fully-formatted markdown.
    return `<span class="content-plain">${escapeHtml(raw)}</span>`;
  }
  const { text, store } = escapeMathAndTokenize(raw);
  let html = marked.parse(text);
  html = renderMathStore(html, store);
  html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true }, ADD_ATTR: ["target", "rel"] });
  return html;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function getMsgImages(m) {
  if (Array.isArray(m.images)) return m.images;
  if (m.image) return [m.image];
  return [];
}
function getMsgFiles(m) {
  return Array.isArray(m.files) ? m.files : [];
}
function formatFileSize(chars) {
  if (chars < 1000) return `${chars} chars`;
  return `${(chars / 1000).toFixed(1)}k chars`;
}

// Best-effort extraction of web-search citations from a Compound model's
// executed_tools payload. Groq's streaming docs don't fully pin down the
// exact shape this arrives in, so this tries several plausible field names
// and simply renders nothing if it can't find recognizable URLs — the
// "used N tools" badge remains the always-safe fallback either way.
function extractCitations(executedTools) {
  if (!Array.isArray(executedTools)) return [];
  const out = [];
  const seen = new Set();
  for (const tool of executedTools) {
    const candidates = tool?.search_results?.results || tool?.results || tool?.output?.results || tool?.search_results || [];
    const list = Array.isArray(candidates) ? candidates : [];
    for (const item of list) {
      const url = item?.url || item?.link;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: item?.title || item?.name || url, snippet: item?.content || item?.snippet || "" });
      if (out.length >= 6) return out;
    }
  }
  return out;
}
function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
function getCitations(msg) {
  if (Array.isArray(msg.citations) && msg.citations.length) return msg.citations;
  return extractCitations(msg.executedTools);
}

// Renders a message exactly once, no matter whether this call or the live
// Firestore listener gets there first (both paths funnel through here).
function pushAndRenderMessage(msg, { forceScroll = false } = {}) {
  if (msg.docId && currentMessages.some((m) => m.docId === msg.docId)) return false;
  currentMessages.push(msg);
  hideEmptyState();
  messagesEl.appendChild(buildMessageEl(msg, currentMessages.length - 1));
  if (forceScroll) scrollToBottom();
  else maybeAutoScroll();
  return true;
}

// ---------------------------------------------------------------------
// Message DOM building
// ---------------------------------------------------------------------
function buildMessageEl(msg, index) {
  const wrap = document.createElement("div");
  wrap.className = `message ${msg.role}`;
  wrap.dataset.index = index;
  if (msg.docId) wrap.dataset.docId = msg.docId;

  if (msg.role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (msg.model && MODEL_TINT[msg.model]) avatar.dataset.modelTint = MODEL_TINT[msg.model];
    avatar.innerHTML = SPARK_SVG;
    wrap.appendChild(avatar);
  }

  const inner = document.createElement("div");
  inner.className = "message-inner";
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const imgs = getMsgImages(msg);
  if (imgs.length) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "msg-images";
    imgs.forEach((src) => {
      const img = document.createElement("img");
      img.src = src; img.className = "msg-image"; img.alt = "Attached image";
      img.loading = "lazy"; img.decoding = "async";
      imgWrap.appendChild(img);
    });
    bubble.appendChild(imgWrap);
  }

  const files = getMsgFiles(msg);
  if (files.length) {
    const fileWrap = document.createElement("div");
    fileWrap.className = "msg-files";
    fileWrap.innerHTML = files.map((f) => `
      <div class="file-chip" title="${escapeHtml(f.name)}">
        <span class="file-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5z"/></svg></span>
        <span class="file-chip-info"><span class="file-chip-name">${escapeHtml(f.name)}</span><span class="file-chip-meta">${formatFileSize(f.charCount || (f.text || "").length)}</span></span>
      </div>`).join("");
    bubble.appendChild(fileWrap);
  }

  const content = document.createElement("div");
  content.className = "content";
  let contentHtml = "";
  if (msg.reasoning) {
    contentHtml += `<details class="think-block"><summary>Thought process</summary><div class="think-content">${renderMessageContent(msg.reasoning)}</div></details>`;
  }
  contentHtml += renderMessageContent(msg.content);
  content.innerHTML = contentHtml;
  bubble.appendChild(content);

  const citations = getCitations(msg);
  if (citations.length) {
    const citeBlock = document.createElement("div");
    citeBlock.className = "citations-block";
    citeBlock.innerHTML = `<span class="citations-title">Sources</span>` + citations.map((c, i) => `
      <a class="citation-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">
        <span class="citation-index">[${i + 1}]</span>
        <span class="citation-domain">${escapeHtml(domainFromUrl(c.url))}</span>
        <span class="citation-snippet">${escapeHtml(c.title)}</span>
      </a>`).join("");
    bubble.appendChild(citeBlock);
  }

  const readonly = !!msg._readonly;
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  let html = `<button class="action-btn act-copy" type="button">Copy</button>`;
  if (!readonly) {
    if (msg.role === "user") html += `<button class="action-btn act-edit" type="button">Edit</button>`;
    if (msg.role === "assistant") {
      html += `<button class="action-btn act-regen" type="button">Regenerate</button>`;
      if (msg.finishReason === "length" && index === currentMessages.length - 1) {
        html += `<button class="action-btn act-continue" type="button">Continue</button>`;
      }
    }
    html += `<button class="action-btn act-fork" type="button">Fork</button>`;
  }
  if (msg.executedTools && msg.executedTools.length) {
    html += `<span class="tool-tag">🔍 used ${msg.executedTools.length} tool${msg.executedTools.length > 1 ? "s" : ""}</span>`;
  }
  if (msg.model) html += `<span class="model-tag">${escapeHtml(modelLabel(msg.model))}</span>`;
  actions.innerHTML = html;
  bubble.appendChild(actions);

  const ts = formatTimestamp(msg.createdAt);
  if (ts) {
    const tsEl = document.createElement("div");
    tsEl.className = "msg-timestamp";
    tsEl.textContent = ts;
    bubble.appendChild(tsEl);
  }

  inner.appendChild(bubble);
  wrap.appendChild(inner);
  return wrap;
}

function formatTimestamp(createdAt) {
  let date;
  if (createdAt?.toDate) date = createdAt.toDate();
  else if (createdAt?.seconds) date = new Date(createdAt.seconds * 1000);
  else return null;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return timeStr;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${timeStr}`;
}

function renderMessages(opts = {}) {
  messagesEl.innerHTML = "";
  if (currentMessages.length === 0) {
    if (!hasMoreOlderMessages) { showEmptyState(); return; }
  }
  if (hasMoreOlderMessages) {
    const row = document.createElement("div");
    row.className = "load-earlier-row";
    row.innerHTML = `<button class="load-earlier-btn" type="button">Load earlier messages</button>`;
    messagesEl.appendChild(row);
  }
  currentMessages.forEach((m, i) => messagesEl.appendChild(buildMessageEl(m, i)));
  if (!opts.preserveScroll) scrollToBottom(false);
}

const EMPTY_STATE_VARIANTS = [
  {
    heading: "What should we dig into?",
    sub: "Pick a model up top, attach images or files, or try <code>/help</code> for commands.",
    chips: [
      "Explain the Monty Hall problem with math",
      "Write a binary search function in Python",
      "Derive the quadratic formula",
      "Plan a 3-day trip to Kyoto",
    ],
  },
  {
    heading: "Where do you want to start?",
    sub: "Six models, one box. Compound can search the live web on its own.",
    chips: [
      "What happened in tech news this week?",
      "Refactor this function for readability",
      "Explain transformers like I'm new to ML",
      "Draft a polite email declining a meeting",
    ],
  },
  {
    heading: "Ready when you are.",
    sub: "Drop in a PDF, paste an image, or just start typing.",
    chips: [
      "Summarize the attached document",
      "Debug this stack trace",
      "Compare SQL vs NoSQL for a chat app",
      "Write a haiku about compilers",
    ],
  },
  {
    heading: "Let's build something.",
    sub: "Try Compare mode to pit two or three models against the same prompt.",
    chips: [
      "Design a REST API for a bookstore",
      "Explain Big-O with everyday examples",
      "Outline a study plan for JEE physics",
      "Convert this CSV into a summary table",
    ],
  },
];
function showEmptyState() {
  const v = EMPTY_STATE_VARIANTS[Math.floor(Math.random() * EMPTY_STATE_VARIANTS.length)];
  messagesEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-mark">${SPARK_SVG}</div>
      <h2>${v.heading}</h2>
      <p>${v.sub}</p>
      <div class="suggestion-chips">
        ${v.chips.map((c) => `<button class="chip" type="button">${escapeHtml(c)}</button>`).join("")}
      </div>
    </div>`;
}
function hideEmptyState() { messagesEl.querySelector(".empty-state")?.remove(); }

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
  isNearBottom = true;
  hideJumpToBottom();
}

// ---------------------------------------------------------------------
// Respectful auto-scroll: only snap to the bottom automatically if the
// person is already there. If they've scrolled up to reread something
// while a reply streams in, leave them alone and surface a pill instead.
// ---------------------------------------------------------------------
function maybeAutoScroll() {
  if (isNearBottom) scrollToBottom(false);
  else showJumpToBottom(true);
}
function showJumpToBottom(hasNew) {
  jumpToBottomBtn.classList.add("show");
  jumpToBottomBtn.classList.toggle("has-new", !!hasNew);
  jumpToBottomLabelEl.textContent = hasNew ? "New message ↓" : "Jump to bottom";
}
function hideJumpToBottom() {
  jumpToBottomBtn.classList.remove("show", "has-new");
}
jumpToBottomBtn.addEventListener("click", () => scrollToBottom());

// ---------------------------------------------------------------------
// Scroll-position memory per chat — reopening a chat restores where you
// left off instead of always jumping to the bottom.
// ---------------------------------------------------------------------
function scrollKey(chatId) { return `flint_scrollpos_${chatId || "new"}`; }
function saveScrollPositionNow() {
  if (currentChatId) localStorage.setItem(scrollKey(currentChatId), String(messagesEl.scrollTop));
}
function restoreScrollPosition(chatId) {
  const saved = localStorage.getItem(scrollKey(chatId));
  if (saved != null && currentMessages.length > 0) {
    messagesEl.scrollTop = parseInt(saved, 10) || 0;
    updateNearBottomState();
  } else {
    scrollToBottom(false);
  }
}
function updateNearBottomState() {
  const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  isNearBottom = distance < 80;
  if (isNearBottom) hideJumpToBottom();
}
messagesEl.addEventListener("scroll", () => {
  updateNearBottomState();
  if (!isNearBottom && !jumpToBottomBtn.classList.contains("has-new")) showJumpToBottom(false);
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveScrollPositionNow, 300);
});

// click delegation: chips, code copy, image lightbox, message actions
messagesEl.addEventListener("click", (e) => {
  const loadEarlierBtn = e.target.closest(".load-earlier-btn");
  if (loadEarlierBtn) { loadEarlierMessages(); return; }

  const chip = e.target.closest(".chip");
  if (chip) { promptInput.value = chip.textContent; autoResize(); promptInput.focus(); return; }

  const img = e.target.closest(".msg-image");
  if (img) { openLightbox(img.src); return; }

  const copyCodeBtn = e.target.closest(".copy-btn");
  if (copyCodeBtn) {
    const codeEl = copyCodeBtn.closest(".code-block").querySelector("code");
    navigator.clipboard.writeText(codeEl.textContent).then(() => {
      const old = copyCodeBtn.textContent;
      copyCodeBtn.textContent = "Copied";
      setTimeout(() => (copyCodeBtn.textContent = old), 1400);
    });
    return;
  }

  const msgEl = e.target.closest(".message");
  // Resolve the array index fresh from the message's stable docId rather
  // than trusting a baked-in data-index attribute — that attribute can go
  // stale the moment older messages get prepended (via "load earlier"),
  // since every existing message's true array position shifts but their
  // already-rendered DOM nodes don't get retroactively re-numbered.
  const docId = msgEl?.dataset.docId;
  const index = docId ? currentMessages.findIndex((m) => m.docId === docId) : (msgEl ? Number(msgEl.dataset.index) : -1);

  if (e.target.closest(".act-copy")) {
    const text = msgEl.querySelector(".content").textContent;
    navigator.clipboard.writeText(text);
    toastCopied();
    return;
  }
  if (e.target.closest(".act-edit")) { startEditMessage(index, msgEl); return; }
  if (e.target.closest(".act-regen")) { regenerateMessage(index); return; }
  if (e.target.closest(".act-continue")) { continueGeneration(index); return; }
  if (e.target.closest(".act-fork")) { forkFromMessage(index); return; }
  if (e.target.closest(".act-retry")) { msgEl?.remove(); if (currentChatId) generateAssistantReply(currentChatId); return; }
});

function startEditMessage(index, msgEl) {
  if (isStreaming) return;
  const msg = currentMessages[index];
  if (!msg || msg.role !== "user") return;
  if (!msgEl) return;
  const bubble = msgEl.querySelector(".bubble");
  const contentEl = bubble.querySelector(".content");
  const actionsEl = bubble.querySelector(".msg-actions");
  contentEl.style.display = "none";
  actionsEl.style.display = "none";

  const editArea = document.createElement("div");
  editArea.className = "edit-area";
  const ta = document.createElement("textarea");
  ta.className = "edit-textarea";
  ta.value = msg.content;
  editArea.appendChild(ta);
  const editActions = document.createElement("div");
  editActions.className = "edit-actions";
  editActions.innerHTML = `<button class="action-btn edit-cancel" type="button">Cancel</button><button class="action-btn edit-save" type="button">Save &amp; regenerate</button>`;
  editArea.appendChild(editActions);
  bubble.appendChild(editArea);

  ta.focus();
  ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px";
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; });

  editArea.querySelector(".edit-cancel").addEventListener("click", () => {
    editArea.remove(); contentEl.style.display = ""; actionsEl.style.display = "";
  });
  editArea.querySelector(".edit-save").addEventListener("click", async () => {
    const newText = ta.value.trim();
    if (!newText) { toast("Message can't be empty.", "warn"); return; }
    editArea.remove(); contentEl.style.display = ""; actionsEl.style.display = "";
    await editMessage(index, newText);
  });
}

async function editMessage(index, newText) {
  if (isStreaming || !currentChatId) return;
  const msg = currentMessages[index];
  if (!msg || msg.role !== "user") return;
  const removed = truncateFromIndexLocal(index);
  deleteMessagesBatch(removed).catch((err) => console.warn("cleanup delete failed", err));

  const images = getMsgImages(msg);
  let newMsg = { role: "user", content: newText, images: images.length ? images : null, model: msg.model };
  try {
    const ref = await saveMessage(currentChatId, "user", newText, msg.model, images);
    newMsg.docId = ref.id;
  } catch (err) { toast("Could not save edit: " + err.message, "error"); return; }
  pushAndRenderMessage(newMsg, { forceScroll: true });

  const chatId = currentChatId;
  const finalText = await generateAssistantReply(chatId);
  if (finalText) maybeAutoSummarize(chatId);
}

async function regenerateMessage(index) {
  if (isStreaming || !currentChatId) return;
  const msg = currentMessages[index];
  if (!msg || msg.role !== "assistant") return;
  const removed = truncateFromIndexLocal(index);
  deleteMessagesBatch(removed).catch((err) => console.warn("cleanup delete failed", err));
  const chatId = currentChatId;
  const finalText = await generateAssistantReply(chatId);
  if (finalText) maybeAutoSummarize(chatId);
}

async function forkFromMessage(index) {
  if (!currentChatId) { toast("Nothing to fork yet.", "warn"); return; }
  const upTo = currentMessages.slice(0, index + 1);
  if (upTo.length === 0) return;
  toast("Forking chat…", "info");
  try {
    const origSnap = await getDoc(doc(db, "users", currentUser.uid, "chats", currentChatId));
    const origData = origSnap.data() || {};
    const newChatRef = await addDoc(collection(db, "users", currentUser.uid, "chats"), {
      title: `${origData.title || "Chat"} (branch)`,
      model: origData.model || selectedModel,
      systemPrompt: origData.systemPrompt || null,
      temperature: typeof origData.temperature === "number" ? origData.temperature : 0.7,
      maxTokens: typeof origData.maxTokens === "number" ? origData.maxTokens : 4096,
      pinned: false,
      folder: origData.folder || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    for (const m of upTo) {
      const imgs = getMsgImages(m);
      const mFiles = getMsgFiles(m);
      await addDoc(collection(db, "users", currentUser.uid, "chats", newChatRef.id, "messages"), {
        role: m.role, content: m.content, model: m.model || null,
        images: imgs.length ? imgs : null,
        files: mFiles.length ? mFiles : null,
        finishReason: m.finishReason || null,
        reasoning: m.reasoning || null, executedTools: m.executedTools || null,
        createdAt: serverTimestamp(),
      });
    }
    toast("Forked into a new chat.", "success");
    await openChat(newChatRef.id);
  } catch (err) {
    toast("Fork failed: " + err.message, "error");
  }
}

// ---------------------------------------------------------------------
// Groq streaming
// ---------------------------------------------------------------------
async function streamCompletion(apiMessages, model, settings, onDelta, signal, extraOpts = {}) {
  const apiKey = localStorage.getItem("flint_groq_key");
  if (!apiKey) { openSettings(); throw new Error("Add your Groq API key in Settings to start chatting."); }

  const modelInfo = MODELS.find((m) => m.id === model);

  // Agentic (Compound) models run their own internal multi-step pipeline
  // and reject several params plain chat models accept — sending
  // stream_options/reasoning_format to them was causing the request to
  // come back with an empty stream (no error, just nothing). They get a
  // deliberately minimal body; everything else keeps the full param set.
  const body = modelInfo?.agentic
    ? { model, messages: apiMessages, stream: true }
    : {
        model, messages: apiMessages, stream: true,
        temperature: settings.temperature, max_tokens: settings.maxTokens,
        stream_options: { include_usage: true },
      };
  if (modelInfo?.reasoning) body.reasoning_format = "parsed";
  // Built-in tools (browser_search / code_interpreter) for GPT-OSS models —
  // these are server-executed, no tool_choice or client-side handling
  // needed; the model decides on its own whether to use them.
  if (extraOpts.tools) body.tools = extraOpts.tools;

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  // Every official Compound example in Groq's docs includes this header.
  // Omitting it was a likely cause of the empty-response bug — without it,
  // requests may fall back to an older/default Compound revision.
  if (modelInfo?.agentic) headers["Groq-Model-Version"] = "latest";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let msg = `Groq API error (${res.status})`;
    try { const j = JSON.parse(errText); if (j.error?.message) msg = j.error.message; } catch {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "", fullReasoning = "", finishReason = null, usage = null, executedTools = null, fallbackMessageContent = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          const delta = choice?.delta?.content;
          const deltaReasoning = choice?.delta?.reasoning;
          if (delta) full += delta;
          if (deltaReasoning) fullReasoning += deltaReasoning;
          if (delta || deltaReasoning) onDelta(full, fullReasoning);
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (json.usage) usage = json.usage;
          // Compound tool-use metadata can show up on the delta, or on a
          // final non-delta message object depending on where in the
          // stream it lands — check both rather than assume one shape.
          const foundTools = choice?.delta?.executed_tools || choice?.message?.executed_tools || json?.executed_tools;
          if (foundTools) executedTools = foundTools;
          // Defensive fallback: if a tool-using turn ever delivers its final
          // answer as a complete non-delta message object instead of
          // incremental deltas (undocumented, but plausible for Compound),
          // don't lose it silently.
          if (choice?.message?.content) fallbackMessageContent = choice.message.content;
        } catch (parseErr) {
          // Previously swallowed entirely, which made a genuinely broken
          // response indistinguishable from an empty-but-valid one. Logging
          // it means the browser console shows the raw payload next time
          // this happens, instead of nothing.
          console.warn("Groq stream: could not parse SSE chunk:", data.slice(0, 300), parseErr);
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
    finishReason = finishReason || "aborted";
  }

  if (!full && fallbackMessageContent) {
    full = fallbackMessageContent;
    onDelta(full, fullReasoning);
  }

  // Fallback for models that embed thinking as raw <think> tags instead of
  // a separate reasoning field (we ask for reasoning_format:"parsed" above,
  // but this keeps things working even if a model ignores that).
  if (!fullReasoning) {
    const m = full.match(/<think>([\s\S]*?)<\/think>/);
    if (m) {
      fullReasoning = m[1].trim();
      full = (full.slice(0, m.index) + full.slice(m.index + m[0].length)).trim();
    }
  }
  return { text: full, reasoning: fullReasoning, finishReason, usage, executedTools };
}

// ---------------------------------------------------------------------
// Web search — Groq's native built-in tool, not a manual implementation.
//
// Earlier this used a client-defined function-calling tool backed by
// Serper, which meant every search request came from the browser directly
// and depended on Serper allowing cross-origin requests — unconfirmed and
// risky for an app with no backend. Groq's docs (console.groq.com/docs/
// tool-use/built-in-tools/browser-search) confirm gpt-oss-120b and
// gpt-oss-20b support a first-party `browser_search` tool: the search
// itself runs on Groq's servers, not in the browser, so there's no CORS
// concern and no separate API key. It's also simpler — one streaming
// request with `tools` attached, instead of a decide-then-search-then-
// answer round trip.
//
// Models outside this list (Qwen, Compound has its own automatic search)
// have no Groq-side web search mechanism at all, built-in or otherwise,
// so the toggle is disabled for them rather than faking something shaky.
// ---------------------------------------------------------------------
const BUILT_IN_SEARCH_MODELS = new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);

function builtInToolsFor(model) {
  if (!BUILT_IN_SEARCH_MODELS.has(model)) return null;
  return [{ type: "browser_search" }, { type: "code_interpreter" }];
}

function buildApiMessages(model) {
  const modelInfo = MODELS.find((m) => m.id === model);
  const isVision = modelInfo?.vision;
  const isAgentic = modelInfo?.agentic;

  const msgs = [];
  if (!isAgentic) {
    // Compound models are deliberately sent a bare user/assistant turn
    // sequence with no system message — every official Groq example for
    // Compound omits it, and adding our formatting/memory-note instructions
    // on top of its own internal tool-orchestration prompt is a plausible
    // source of the occasional empty/malformed response.
    const baseSystem = (chatSettings.systemPrompt && chatSettings.systemPrompt.trim()) || SYSTEM_PROMPT;
    const systemContent = memoryNote
      ? `${baseSystem}\n\nSummary of earlier conversation, for continuity only — do not repeat it verbatim, just use it as background:\n${memoryNote}`
      : baseSystem;
    msgs.push({ role: "system", content: systemContent });
  }

  // The "tail" is whatever hasn't already been folded into the memory note
  // — this is the actual token-savings mechanism: once a chat has a note,
  // every subsequent request resends system + note + tail instead of the
  // entire raw history, every single turn.
  let tailStart = 0;
  if (memoryCoversUntilDocId && !isAgentic) {
    const boundaryIdx = currentMessages.findIndex((m) => m.docId === memoryCoversUntilDocId);
    if (boundaryIdx >= 0) tailStart = boundaryIdx + 1;
  }
  const tail = currentMessages.slice(tailStart);

  // Weight a message by what it actually costs to resend — images (base64
  // data URLs) and file text can each run tens of thousands of characters,
  // dwarfing the visible text caption. Measuring only m.content.length (the
  // old behavior) made the safety-net budget effectively blind to the
  // single biggest cost driver in the app.
  function messageWeight(m) {
    let w = (m.content || "").length;
    getMsgImages(m).forEach((url) => { w += url.length; });
    getMsgFiles(m).forEach((f) => { w += (f.text || "").length; });
    return w;
  }

  // Safety net: even the post-summary tail gets weight-capped, in case
  // someone pastes something huge (or attaches several images) between
  // summarization passes.
  let used = 0;
  const picked = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = tail[i];
    const w = messageWeight(m);
    if (used + w > MAX_CONTEXT_CHARS && picked.length > 0) break;
    picked.push(m); used += w;
  }
  picked.reverse();

  // How far back each picked message sits from the true end of the whole
  // conversation — used to decide whether it still keeps its full image/
  // file payload, independent of where the memory-note tail boundary is.
  const distanceFromEnd = new Map();
  picked.forEach((m, idx) => { distanceFromEnd.set(m, picked.length - 1 - idx); });

  for (const m of picked) {
    const keepMedia = distanceFromEnd.get(m) < MEMORY_KEEP_MEDIA_RECENT;
    const imgs = keepMedia ? getMsgImages(m) : [];
    const files = keepMedia ? getMsgFiles(m) : [];
    const droppedImgCount = keepMedia ? 0 : getMsgImages(m).length;
    const droppedFiles = keepMedia ? [] : getMsgFiles(m);

    let textContent = m.content || (imgs.length || droppedImgCount ? "[image attached]" : "");
    if (files.length) {
      textContent += files.map((f) => `\n\n--- Attached file: ${f.name} ---\n${f.text}\n--- end of ${f.name} ---`).join("");
    }
    // Older message with media that got stripped — note that it existed
    // (so the model isn't confused by a bare mention of "the file") without
    // paying to resend the actual payload every single turn.
    if (droppedImgCount > 0) textContent += `\n\n[${droppedImgCount} image${droppedImgCount > 1 ? "s" : ""} attached earlier in this conversation — no longer included verbatim to save tokens]`;
    if (droppedFiles.length) textContent += droppedFiles.map((f) => `\n\n[File "${f.name}" attached earlier in this conversation — no longer included verbatim to save tokens]`).join("");

    if (m.role === "user" && imgs.length && isVision) {
      const content = [{ type: "text", text: textContent || " " }];
      imgs.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
      msgs.push({ role: "user", content });
    } else {
      msgs.push({ role: m.role, content: textContent });
    }
  }
  return msgs;
}
function chatSettingsForRequest() { return { temperature: chatSettings.temperature, maxTokens: chatSettings.maxTokens }; }

// ---------------------------------------------------------------------
// Streaming UI
// ---------------------------------------------------------------------
function appendStreamingPlaceholder(model) {
  hideEmptyState();
  const el = buildMessageEl({ role: "assistant", content: "", model }, currentMessages.length);
  el.classList.add("streaming");
  el.querySelector(".content").innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
  el.querySelector(".msg-actions")?.remove();
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}
let renderScheduled = false;
let streamStartTime = 0;
function tpsHtml(charCount, startTime) {
  const elapsed = (performance.now() - startTime) / 1000;
  if (elapsed < 0.15) return "";
  const tps = Math.round(estimateTokens(charCount) / elapsed);
  return `<span class="tps-badge"><svg width="10" height="10" viewBox="0 0 24 24"><path fill="currentColor" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>${tps} tok/s</span>`;
}
function scheduleAssistantRender() {
  if (renderScheduled || !activePlaceholderEl) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (!activePlaceholderEl) return;
    let html = "";
    if (streamingReasoningBuffer) {
      const stillThinking = !streamingBuffer;
      html += `<details class="think-block" ${stillThinking ? "open" : ""}><summary>${stillThinking ? "Thinking…" : "Thought process"}</summary><div class="think-content">${renderMessageContent(streamingReasoningBuffer)}</div></details>`;
    }
    html += renderMessageContent(streamingBuffer) + '<span class="cursor"></span>';
    if (streamingBuffer) html += `<div class="msg-actions">${tpsHtml(streamingBuffer.length, streamStartTime)}</div>`;
    activePlaceholderEl.querySelector(".content").innerHTML = html;
    maybeAutoScroll();
  });
}
function renderAssistantError(el, message) {
  if (!el) return;
  el.classList.remove("streaming");
  el.querySelector(".content").innerHTML = `<span class="error-text">⚠ ${escapeHtml(message)}</span><div class="msg-actions"><button class="action-btn act-retry" type="button">Retry</button></div>`;
}
function setComposerStreamingState(active) {
  isStreaming = active;
  sendBtn.classList.toggle("is-stop", active);
  sendBtn.innerHTML = active ? STOP_SVG : SEND_SVG;
  sendBtn.setAttribute("aria-label", active ? "Stop generating" : "Send message");
}
sendBtn.addEventListener("click", (e) => {
  if (!isStreaming) return;
  e.preventDefault();
  if (isCompareMode) compareColumnsState.forEach((col) => col.controller?.abort());
  else abortController?.abort();
});

function saveMessage(chatId, role, content, model, images, finishReason, reasoning, executedTools, files, citations) {
  return addDoc(collection(db, "users", currentUser.uid, "chats", chatId, "messages"), {
    role, content, model: model || null,
    images: images && images.length ? images : null,
    files: files && files.length ? files.map((f) => ({ name: f.name, text: f.text, charCount: f.charCount })) : null,
    finishReason: finishReason || null,
    reasoning: reasoning || null,
    executedTools: executedTools || null,
    citations: citations && citations.length ? citations : null,
    createdAt: serverTimestamp(),
  });
}

async function generateAssistantReply(chatId) {
  const model = selectedModel;
  const apiMessages = buildApiMessages(model);
  const modelInfo = MODELS.find((m) => m.id === model);
  setComposerStreamingState(true);
  abortController = new AbortController();
  streamingBuffer = "";
  streamingReasoningBuffer = "";
  streamStartTime = performance.now();
  activePlaceholderEl = appendStreamingPlaceholder(model);

  const onDelta = (partial, partialReasoning) => {
    if (!streamingBuffer && partial) streamStartTime = performance.now(); // reset once real text starts (after any search delay)
    streamingBuffer = partial; streamingReasoningBuffer = partialReasoning; scheduleAssistantRender();
  };

  // Compound's empty-response failures look probabilistic rather than
  // deterministic (same query sometimes works, sometimes doesn't) — a
  // quiet retry is the most honest way to raise real-world reliability
  // without claiming a guaranteed root-cause fix for a third-party API's
  // occasional flakiness. Plain models get exactly one attempt; nothing
  // changes for them.
  const maxAttempts = modelInfo?.agentic ? 3 : 1;
  let result = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      streamingBuffer = ""; streamingReasoningBuffer = ""; streamStartTime = performance.now();
      activePlaceholderEl.querySelector(".content").innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
    }
    try {
      const tools = webSearchEnabled ? builtInToolsFor(model) : null;
      result = await streamCompletion(apiMessages, model, chatSettingsForRequest(), onDelta, abortController.signal, { tools });
      lastErr = null;
      if (result.text || result.finishReason === "aborted") break; // got real content, or user stopped it — stop retrying either way
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError" || abortController.signal.aborted) break;
    }
  }

  if (lastErr) {
    renderAssistantError(activePlaceholderEl, lastErr.message || "Something went wrong.");
    setComposerStreamingState(false); activePlaceholderEl = null;
    return null;
  }

  const { text: finalText, reasoning: finalReasoning, finishReason, usage, executedTools, citations } = result;
  if (!finalText) {
    if (finishReason === "aborted") {
      activePlaceholderEl?.remove();
    } else {
      renderAssistantError(activePlaceholderEl, "The model returned an empty response after a few tries. This can happen with some queries — try rephrasing, or hit Retry.");
    }
    activePlaceholderEl = null;
    setComposerStreamingState(false);
    return null;
  }

  activePlaceholderEl?.remove();
  activePlaceholderEl = null;

  let assistantMsg = { role: "assistant", content: finalText, model, finishReason: finishReason || null, reasoning: finalReasoning || null, executedTools: executedTools || null, citations: citations || null };
  try {
    const ref = await saveMessage(chatId, "assistant", finalText, model, null, finishReason, finalReasoning, executedTools, null, citations);
    assistantMsg.docId = ref.id;
  } catch (err) { toast("Reply generated but failed to save: " + err.message, "warn"); }
  pushAndRenderMessage(assistantMsg);

  recordUsage(model, usage, apiMessages, finalText);
  updateDoc(doc(db, "users", currentUser.uid, "chats", chatId), { updatedAt: serverTimestamp() }).catch(() => {});
  setComposerStreamingState(false);
  return finalText;
}

async function continueGeneration(index) {
  if (isStreaming || !currentChatId) return;
  const msg = currentMessages[index];
  if (!msg || msg.role !== "assistant" || index !== currentMessages.length - 1) return;
  const model = msg.model || selectedModel;
  const baseApiMessages = buildApiMessages(model);
  baseApiMessages.push({ role: "user", content: "Continue exactly where you left off. Do not repeat earlier text and do not add a new introduction." });

  const removed = truncateFromIndexLocal(index);
  deleteMessagesBatch(removed).catch(() => {});

  setComposerStreamingState(true);
  abortController = new AbortController();
  streamingBuffer = msg.content;
  streamingReasoningBuffer = "";
  activePlaceholderEl = appendStreamingPlaceholder(model);
  activePlaceholderEl.querySelector(".content").innerHTML = renderMessageContent(streamingBuffer);

  let result;
  try {
    result = await streamCompletion(baseApiMessages, model, chatSettingsForRequest(), (partial) => {
      streamingBuffer = msg.content + " " + partial; scheduleAssistantRender();
    }, abortController.signal);
  } catch (err) {
    renderAssistantError(activePlaceholderEl, err.message || "Something went wrong.");
    setComposerStreamingState(false); activePlaceholderEl = null;
    return;
  }
  activePlaceholderEl?.remove();
  activePlaceholderEl = null;

  const mergedText = msg.content + " " + result.text;
  let newMsg = { role: "assistant", content: mergedText, model, finishReason: result.finishReason || null };
  try {
    const ref = await saveMessage(currentChatId, "assistant", mergedText, model, null, result.finishReason);
    newMsg.docId = ref.id;
  } catch (err) { console.warn(err); }
  pushAndRenderMessage(newMsg);
  recordUsage(model, result.usage, baseApiMessages, result.text);
  updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), { updatedAt: serverTimestamp() }).catch(() => {});
  setComposerStreamingState(false);
  maybeAutoSummarize(currentChatId);
}

// ---------------------------------------------------------------------
// Send / slash commands
// ---------------------------------------------------------------------
composerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (isCompareMode) { if (!isStreaming) sendCompareMessage(); return; }
  if (!isStreaming) sendMessage();
});
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isStreaming) composerForm.requestSubmit(); }
});
promptInput.addEventListener("input", () => {
  autoResize();
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    const key = draftKey(currentChatId);
    if (promptInput.value.trim()) localStorage.setItem(key, promptInput.value);
    else localStorage.removeItem(key);
  }, 400);
});
function draftKey(chatId) { return `flint_draft_${chatId || "new"}`; }
function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + "px";
}

const SLASH_COMMANDS = ["/clear", "/model", "/system", "/title", "/help", "/summarize"];
async function handleSlashCommand(raw) {
  const trimmed = raw.trim();
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (!SLASH_COMMANDS.includes(firstWord)) return false;
  const arg = trimmed.slice(firstWord.length).trim();

  if (firstWord === "/help") {
    toast("Commands: /clear · /model <name> · /system <prompt> · /title <name> · /summarize", "info");
    return true;
  }
  if (firstWord === "/clear") {
    if (!currentChatId || currentMessages.length === 0) { toast("Nothing to clear.", "warn"); return true; }
    const ok = await showConfirmModal("Clear all messages in this chat?");
    if (ok) {
      const removed = truncateFromIndexLocal(0);
      await deleteMessagesBatch(removed);
      toast("Chat cleared.", "success");
    }
    return true;
  }
  if (firstWord === "/model") {
    const found = MODELS.find((m) => m.id.toLowerCase().includes(arg.toLowerCase()) || m.label.toLowerCase().includes(arg.toLowerCase()));
    if (found) { selectModel(found.id); toast(`Switched to ${found.label}.`, "success"); }
    else toast(`No model matches "${arg}".`, "warn");
    return true;
  }
  if (firstWord === "/system") {
    chatSettings.systemPrompt = arg || null;
    toast(arg ? "Custom system prompt set for this chat." : "System prompt reset to default.", "success");
    if (currentChatId) updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), { systemPrompt: chatSettings.systemPrompt }).catch(() => {});
    return true;
  }
  if (firstWord === "/title") {
    if (!arg) { toast("Usage: /title <new title>", "warn"); return true; }
    setChatTitle(arg);
    if (currentChatId) updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), { title: arg }).catch(() => {});
    else toast("Send a message first to create the chat.", "warn");
    return true;
  }
  if (firstWord === "/summarize") {
    if (!currentChatId || currentMessages.length < 4) { toast("Not enough messages to summarize yet.", "warn"); return true; }
    toast("Summarizing context…", "info");
    await runAutoSummarize(currentChatId);
    toast("Context summary updated — check Chat settings to view it.", "success");
    return true;
  }
  return false;
}

async function sendMessage() {
  const text = promptInput.value.trim();
  if (!text && attachedImages.length === 0 && attachedFiles.length === 0) return;
  const draftChatBefore = currentChatId;

  if (text.startsWith("/")) {
    const handled = await handleSlashCommand(text);
    if (handled) { promptInput.value = ""; autoResize(); return; }
  }

  if (!localStorage.getItem("flint_groq_key")) {
    toast("Add your Groq API key in Settings first.", "warn");
    openSettings();
    return;
  }

  let model = selectedModel;
  const imgs = attachedImages.map((i) => i.dataUrl);
  const files = [...attachedFiles];
  if (imgs.length && !MODELS.find((m) => m.id === model)?.vision) {
    model = VISION_MODEL_ID;
    selectModel(model);
    toast(`Switched to ${modelLabel(model)} for image input.`, "info");
  }

  promptInput.value = ""; autoResize();
  clearAttachedImages();
  clearAttachedFiles();
  hideEmptyState();
  localStorage.removeItem(draftKey(draftChatBefore));

  let chatId;
  try { chatId = await ensureChatDoc(); }
  catch (err) { toast("Could not create chat: " + err.message, "error"); return; }

  let userMsg = {
    role: "user", content: text,
    images: imgs.length ? imgs : null,
    files: files.length ? files : null,
    model,
  };
  try {
    const ref = await saveMessage(chatId, "user", text, model, imgs, null, null, null, files);
    userMsg.docId = ref.id;
  } catch (err) { toast("Could not save message: " + err.message, "error"); return; }
  pushAndRenderMessage(userMsg, { forceScroll: true });

  const finalText = await generateAssistantReply(chatId);
  if (currentMessages.length === 2 && finalText) autoTitleChat(chatId, text, finalText);
  if (finalText) maybeAutoSummarize(chatId);
  if (finalText) maybeCelebrateFirstEverMessage();
  promptInput.focus();
}

// A small, tasteful, one-time-only flourish — fires once, on this
// browser's very first successful reply ever, then never again.
function maybeCelebrateFirstEverMessage() {
  if (localStorage.getItem("flint_first_message_done")) return;
  localStorage.setItem("flint_first_message_done", "1");
  sendBtn.classList.add("first-spark");
  setTimeout(() => sendBtn.classList.remove("first-spark"), 900);
}

async function autoTitleChat(chatId, userText, assistantText) {
  try {
    const apiKey = localStorage.getItem("flint_groq_key");
    if (!apiKey) return;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TITLER_MODEL_ID,
        messages: [
          { role: "system", content: "Write a short, specific chat title (3 to 6 words, no quotes, no trailing punctuation) that summarizes the exchange below. Reply with only the title." },
          { role: "user", content: `User: ${userText.slice(0, 800)}\n\nAssistant: ${assistantText.slice(0, 400)}` },
        ],
        temperature: 0.3, max_tokens: 24,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    let title = data.choices?.[0]?.message?.content?.trim() || "";
    title = title.replace(/^["'“”]+|["'“”]+$/g, "").replace(/\.$/, "").trim();
    if (title) {
      await updateDoc(doc(db, "users", currentUser.uid, "chats", chatId), { title });
      if (chatId === currentChatId) setChatTitle(title);
    }
  } catch (err) { console.warn("auto-title failed", err); }
}

// ---------------------------------------------------------------------
// Rolling context memory — auto-summarization system
//
// How it works:
//   After every reply, once the chat has MEMORY_TRIGGER_MIN_MESSAGES
//   messages and then every MEMORY_RESUMMARIZE_EVERY messages after that,
//   we fire a background Groq call that summarises everything *except* the
//   most recent MEMORY_KEEP_RECENT messages. That summary ("memory note")
//   lives in the chat document and gets injected at the top of the system
//   message on every subsequent request, replacing the need to resend the
//   full raw history. The verbatim tail (recent messages) is sent normally.
//
//   Net effect: a 200-message chat no longer sends 200 messages worth of
//   tokens on every single turn — just the note + 10 recent messages,
//   dramatically reducing per-request token burn while keeping coherence.
// ---------------------------------------------------------------------
async function maybeAutoSummarize(chatId) {
  if (!currentChatId || chatId !== currentChatId) return;
  if (currentMessages.length < MEMORY_TRIGGER_MIN_MESSAGES) return;

  const countTrigger = currentMessages.length === MEMORY_TRIGGER_MIN_MESSAGES ||
    ((currentMessages.length - MEMORY_TRIGGER_MIN_MESSAGES) % MEMORY_RESUMMARIZE_EVERY === 0);

  // Independent of the turn-count cadence: if the untouched tail (whatever
  // hasn't already been folded into a summary) has grown past a char
  // threshold on its own — a couple of long pastes, big code blocks, etc.
  // — summarize now rather than waiting for the count-based schedule.
  let tailStart = 0;
  if (memoryCoversUntilDocId) {
    const boundaryIdx = currentMessages.findIndex((m) => m.docId === memoryCoversUntilDocId);
    if (boundaryIdx >= 0) tailStart = boundaryIdx + 1;
  }
  const tailEnd = Math.max(tailStart, currentMessages.length - MEMORY_KEEP_RECENT);
  const tailChars = currentMessages.slice(tailStart, tailEnd)
    .reduce((sum, m) => sum + (m.content || "").length, 0);
  const sizeTrigger = tailChars > MEMORY_TRIGGER_CHARS;

  if (!countTrigger && !sizeTrigger) return;
  await runAutoSummarize(chatId);
}

async function runAutoSummarize(chatId) {
  const apiKey = localStorage.getItem("flint_groq_key");
  if (!apiKey || !currentChatId || chatId !== currentChatId) return;
  const toSummarize = currentMessages.slice(0, currentMessages.length - MEMORY_KEEP_RECENT);
  if (toSummarize.length < 4) return;
  const lastSummarizedMsg = toSummarize[toSummarize.length - 1];

  const transcript = toSummarize
    .filter((m) => m.role !== "system")
    .map((m) => {
      let line = `${m.role === "user" ? "User" : "Assistant"}: ${(m.content || "").slice(0, 800)}`;
      const imgCount = getMsgImages(m).length;
      const fileNames = getMsgFiles(m).map((f) => f.name);
      if (imgCount) line += ` [attached ${imgCount} image${imgCount > 1 ? "s" : ""}]`;
      if (fileNames.length) line += ` [attached file(s): ${fileNames.join(", ")}]`;
      return line;
    })
    .join("\n\n");

  let existingNotePreamble = "";
  if (memoryNote) existingNotePreamble = `Previous summary (update and extend this, do not discard it):\n${memoryNote}\n\nNew messages to incorporate:\n`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TITLER_MODEL_ID,
        messages: [
          {
            role: "system",
            content: "You are a precise summarizer. Create a dense, factual summary of the conversation that captures: key topics and questions asked, important facts or code shared, decisions made, and the current state of the discussion. If a message mentions attached images or files (shown in [brackets]), briefly note what was attached and why, if that's clear from context — the actual attachment content isn't available to you, only that it existed. Write in third person. Be thorough but concise — aim for 150-400 words. Do not add any preamble or commentary.",
          },
          { role: "user", content: `${existingNotePreamble}${transcript}` },
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    if (!res.ok || chatId !== currentChatId) return;
    const data = await res.json();
    const note = data.choices?.[0]?.message?.content?.trim();
    if (!note) return;

    memoryNote = note;
    memoryCoversUntilDocId = lastSummarizedMsg.docId || null;
    // Concrete, visible proof the system is doing something: how many
    // fewer tokens every future request in this chat now sends, compared
    // to resending the raw history it just replaced.
    memoryLastSavedTokens = Math.max(0, estimateTokens(transcript.length) - estimateTokens(note.length));

    await updateDoc(doc(db, "users", currentUser.uid, "chats", chatId), {
      memoryNote,
      memoryCoversUntilDocId,
      memoryLastSavedTokens,
    });
    renderMemoryStatus();
  } catch (err) {
    console.warn("auto-summarize failed:", err);
  }
}

function renderMemoryStatus() {
  if (memoryActiveBadge) memoryActiveBadge.hidden = !memoryNote;
  if (!memoryStatusBox) return;
  if (!memoryNote) {
    memoryStatusBox.innerHTML = `<p class="field-hint">No summary yet — kicks in automatically once this chat gets long, to keep token usage down.</p>`;
    memoryStatusBox.classList.remove("active");
    return;
  }
  memoryStatusBox.classList.add("active");
  const savingsLine = memoryLastSavedTokens > 0
    ? `<p class="field-hint memory-savings" style="margin:0 0 8px">⚡ Saving roughly <strong>${memoryLastSavedTokens.toLocaleString()} tokens</strong> on every message from here on, versus resending full history.</p>`
    : "";
  memoryStatusBox.innerHTML = `
    <p class="field-hint" style="margin:0 0 4px">Context summary active — recent messages sent verbatim, older ones compressed.</p>
    ${savingsLine}
    <div class="memory-note-text">${escapeHtml(memoryNote)}</div>
    <div class="memory-status-row">
      <button class="text-btn" id="clearMemoryBtn" type="button">Clear summary</button>
      <button class="text-btn" id="resummarizeBtn" type="button">Re-summarize now</button>
    </div>`;
  document.getElementById("clearMemoryBtn")?.addEventListener("click", async () => {
    if (!currentChatId) return;
    memoryNote = null; memoryCoversUntilDocId = null; memoryLastSavedTokens = 0;
    await updateDoc(doc(db, "users", currentUser.uid, "chats", currentChatId), { memoryNote: null, memoryCoversUntilDocId: null, memoryLastSavedTokens: 0 }).catch(() => {});
    renderMemoryStatus();
    toast("Context summary cleared.", "success");
  });
  document.getElementById("resummarizeBtn")?.addEventListener("click", async () => {
    if (!currentChatId) return;
    toast("Re-summarizing…", "info");
    await runAutoSummarize(currentChatId);
    toast("Context summary updated.", "success");
  });
}

// Also render memory status when the advanced modal opens
advancedBtn.addEventListener("click", () => {
  renderMemoryStatus();
}, true); // capture=true so this fires before the modal's own open handler and overwrites default

// ---------------------------------------------------------------------
// Usage tracking + dashboard
// ---------------------------------------------------------------------
function estimateTokens(chars) { return Math.ceil(chars / 4); }

async function recordUsage(model, usage, apiMessages, finalText) {
  let promptTokens, completionTokens;
  if (usage && typeof usage.prompt_tokens === "number") {
    promptTokens = usage.prompt_tokens;
    completionTokens = usage.completion_tokens ?? estimateTokens((finalText || "").length);
  } else {
    const promptChars = apiMessages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
    promptTokens = estimateTokens(promptChars);
    completionTokens = estimateTokens((finalText || "").length);
  }
  const total = promptTokens + completionTokens;
  const dateId = new Date().toISOString().slice(0, 10);
  try {
    await setDoc(doc(db, "users", currentUser.uid, "usage", dateId), {
      totalTokens: increment(total),
      promptTokens: increment(promptTokens),
      completionTokens: increment(completionTokens),
      [`byModel.${sanitizeModelKey(model)}`]: increment(total),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) { console.warn("usage record failed", err); }
}

usageBtn.addEventListener("click", openUsageModal);
async function openUsageModal() {
  openModal(usageModal);
  usageModalBody.innerHTML = `<p class="field-hint">Loading usage…</p>`;
  try {
    // No orderBy/limit here on purpose — this collection only grows by one
    // doc per day, so fetching it all and sorting client-side is trivial,
    // and it means this never needs a manually-created Firestore index.
    const snap = await getDocs(collection(db, "users", currentUser.uid, "usage"));
    const days = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(-31);
    renderUsageModal(days);
  } catch (err) {
    usageModalBody.innerHTML = `<p class="field-hint">Could not load usage: ${escapeHtml(err.message)}</p>`;
  }
}
function renderUsageModal(days) {
  const todayId = new Date().toISOString().slice(0, 10);
  const monthPrefix = todayId.slice(0, 7);
  const today = days.find((d) => d.id === todayId);
  const monthTotal = days.filter((d) => d.id.startsWith(monthPrefix)).reduce((s, d) => s + (d.totalTokens || 0), 0);

  const last14 = days.slice(-14);
  const maxVal = Math.max(1, ...last14.map((d) => d.totalTokens || 0));
  const barsHtml = last14.map((d) => {
    const h = Math.max(2, Math.round(((d.totalTokens || 0) / maxVal) * 86));
    const label = d.id.slice(5).replace("-", "/");
    // Bars render at 0 height first, then get their real height set a
    // frame later (see below) so the CSS transition animates them growing
    // in rather than just appearing at full height instantly.
    return `<div class="usage-bar-col"><div class="usage-bar" data-final-height="${h}" style="height:0px" title="${d.totalTokens || 0} tokens"></div><div class="usage-bar-label">${label}</div></div>`;
  }).join("");

  const byModelTotals = {};
  days.forEach((d) => { Object.entries(d.byModel || {}).forEach(([k, v]) => { byModelTotals[k] = (byModelTotals[k] || 0) + v; }); });
  const maxModelVal = Math.max(1, ...Object.values(byModelTotals));
  const modelRows = Object.entries(byModelTotals).sort((a, b) => b[1] - a[1]).map(([key, val]) => {
    const model = MODELS.find((m) => sanitizeModelKey(m.id) === key);
    const pct = Math.round((val / maxModelVal) * 100);
    return `<div class="usage-model-row"><span class="usage-model-name">${escapeHtml(model?.label || key)}</span><div class="usage-model-bar-track"><div class="usage-model-bar-fill" data-final-width="${pct}" style="width:0%"></div></div><span class="usage-model-value">${val.toLocaleString()}</span></div>`;
  }).join("") || `<p class="field-hint">No usage recorded yet.</p>`;

  usageModalBody.innerHTML = `
    <div class="usage-stats-row">
      <div class="usage-stat-card"><div class="stat-num" data-count-target="${today?.totalTokens || 0}">0</div><div class="stat-label">Tokens today</div></div>
      <div class="usage-stat-card"><div class="stat-num" data-count-target="${monthTotal}">0</div><div class="stat-label">Tokens this month</div></div>
    </div>
    <div class="usage-section-title">Last 14 days</div>
    <div class="usage-bars">${barsHtml || '<p class="field-hint">No usage yet.</p>'}</div>
    <div class="usage-section-title">By model (last 31 days)</div>
    ${modelRows}
    <p class="field-hint" style="margin-top:14px;">Token counts use Groq's reported usage where available, otherwise a rough character-based estimate.</p>`;

  animateUsageDashboardIn();
}

// Bars/fills start at 0 and the headline numbers start at 0 in the markup
// above; this nudges them all to their real values one frame later, which
// is what actually triggers the CSS transitions/count-up rather than the
// values just appearing instantly.
function animateUsageDashboardIn() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      usageModalBody.querySelectorAll(".usage-bar[data-final-height]").forEach((bar) => {
        bar.style.height = `${bar.dataset.finalHeight}px`;
      });
      usageModalBody.querySelectorAll(".usage-model-bar-fill[data-final-width]").forEach((fill) => {
        fill.style.width = `${fill.dataset.finalWidth}%`;
      });
      usageModalBody.querySelectorAll(".stat-num[data-count-target]").forEach((el) => {
        animateCountUp(el, parseInt(el.dataset.countTarget, 10) || 0);
      });
    });
  });
}

function animateCountUp(el, target, duration = 700) {
  if (target <= 0) { el.textContent = "0"; return; }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    el.textContent = Math.round(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------
// Attachments: images (file picker, drag/drop, paste, scaled compression,
// lightbox) and documents (PDF/txt/md/csv/json, extracted to plain text
// client-side and fed in as context)
// ---------------------------------------------------------------------
const DOC_EXTENSIONS = /\.(pdf|txt|md|markdown|csv|json|log)$/i;
const DOC_MIME_TYPES = ["application/pdf", "text/plain", "text/markdown", "text/csv", "application/json", "text/csv"];

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); fileInput.value = ""; });

async function handleFiles(fileList) {
  const all = Array.from(fileList);
  const images = all.filter((f) => f.type.startsWith("image/"));
  const docs = all.filter((f) => !f.type.startsWith("image/") && (DOC_MIME_TYPES.includes(f.type) || DOC_EXTENSIONS.test(f.name)));
  const unrecognized = all.length - images.length - docs.length;
  if (unrecognized > 0) toast(`Skipped ${unrecognized} unsupported file${unrecognized > 1 ? "s" : ""}. Images, PDF, txt, md, csv, and json are supported.`, "warn");

  if (images.length) await handleImageFiles(images);
  if (docs.length) await handleDocumentFiles(docs);
}

async function handleImageFiles(files) {
  if (attachedImages.length >= MAX_IMAGES) { toast(`Up to ${MAX_IMAGES} images per message.`, "warn"); return; }
  const room = MAX_IMAGES - attachedImages.length;
  const toAdd = files.slice(0, room);
  if (files.length > room) toast(`Up to ${MAX_IMAGES} images per message — added the first ${room}.`, "warn");
  // Compression scales down as more images pile into one message, since
  // Firestore caps a single document at 1MB and 6 full-size compressed
  // images can otherwise get close to that ceiling.
  const projectedTotal = Math.min(MAX_IMAGES, attachedImages.length + toAdd.length);
  const { maxDim, quality } = compressionParamsFor(projectedTotal);
  for (const file of toAdd) {
    try { attachedImages.push({ dataUrl: await compressImage(file, maxDim, quality) }); }
    catch { toast("Could not read an image.", "error"); }
  }
  renderImagePreview();
}

function compressionParamsFor(count) {
  if (count <= 1) return { maxDim: 1024, quality: 0.78 };
  if (count <= 3) return { maxDim: 900, quality: 0.7 };
  return { maxDim: 760, quality: 0.6 };
}

function renderImagePreview() {
  if (attachedImages.length === 0) { imagePreview.hidden = true; imagePreview.innerHTML = ""; return; }
  imagePreview.hidden = false;
  imagePreview.innerHTML = attachedImages.map((img, i) => `
    <div class="image-preview-thumb" data-i="${i}">
      <img src="${img.dataUrl}" alt="Attached image ${i + 1}" />
      <button class="remove-image" type="button" data-i="${i}" aria-label="Remove image">&times;</button>
    </div>`).join("");
}
imagePreview.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-image");
  if (!btn) return;
  attachedImages.splice(Number(btn.dataset.i), 1);
  renderImagePreview();
});
function clearAttachedImages() { attachedImages = []; renderImagePreview(); }

// The browser's default behavior for a file dropped anywhere it isn't
// explicitly handled is to navigate the tab to that file — which looks
// exactly like the page reloading, and is jarring especially on low-end
// devices. This blocks that everywhere, so only the composer's own drop
// zone (below) ever actually does anything with a dropped file.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

["dragover", "dragenter"].forEach((evt) => composerForm.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); composerForm.classList.add("drag-over"); }));
["dragleave", "drop"].forEach((evt) => composerForm.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); composerForm.classList.remove("drag-over"); }));
composerForm.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

// A full-page drop zone so dragging a file anywhere over the app (not just
// the small composer bar) picks it up too, rather than requiring pixel-
// perfect aim at a thin input strip.
let pageDragCounter = 0;
window.addEventListener("dragenter", (e) => {
  if (isShareMode || !appEl || appEl.hidden) return;
  pageDragCounter++;
  if (e.dataTransfer?.types?.includes("Files")) document.body.classList.add("page-drag-active");
});
window.addEventListener("dragleave", () => {
  pageDragCounter = Math.max(0, pageDragCounter - 1);
  if (pageDragCounter === 0) document.body.classList.remove("page-drag-active");
});
window.addEventListener("drop", (e) => {
  pageDragCounter = 0;
  document.body.classList.remove("page-drag-active");
  if (isCompareMode || isShareMode) return;
  if (e.target.closest(".composer-form")) return; // already handled above, avoid double-add
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

promptInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles = [];
  for (const item of items) { if (item.kind === "file" && item.type.startsWith("image/")) imageFiles.push(item.getAsFile()); }
  if (imageFiles.length) { e.preventDefault(); handleFiles(imageFiles); }
});

function compressImage(file, maxDim = 1024, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function openLightbox(src) { lightboxImg.src = src; openModal(imageLightbox); }
function closeLightbox() { closeModal(imageLightbox); }
lightboxCloseBtn.addEventListener("click", closeLightbox);
imageLightbox.addEventListener("click", (e) => { if (e.target === imageLightbox) closeLightbox(); });

// ---------------------------------------------------------------------
// Document attachments — PDF/txt/md/csv/json extracted to plain text
// client-side, then fed to the model as clearly delimited context.
// ---------------------------------------------------------------------
function ensurePdfJsLoaded() {
  if (pdfjsReadyPromise) return pdfjsReadyPromise;
  pdfjsReadyPromise = loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js")
    .then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    })
    .catch((err) => { pdfjsReadyPromise = null; throw err; });
  return pdfjsReadyPromise;
}

async function extractTextFromFile(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    await ensurePdfJsLoaded();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    const pageCount = Math.min(pdf.numPages, 60); // safety cap on very long PDFs
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n\n";
      if (text.length > MAX_FILE_CHARS * 1.5) break; // stop early, we'll truncate anyway
    }
    return text.trim();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

async function handleDocumentFiles(files) {
  if (attachedFiles.length >= MAX_FILES) { toast(`Up to ${MAX_FILES} files per message.`, "warn"); return; }
  const room = MAX_FILES - attachedFiles.length;
  const toAdd = files.slice(0, room);
  if (files.length > room) toast(`Up to ${MAX_FILES} files per message — added the first ${room}.`, "warn");

  for (const file of toAdd) {
    const placeholderName = file.name;
    toast(`Reading ${placeholderName}…`, "info");
    try {
      let text = await extractTextFromFile(file);
      let truncated = false;
      if (text.length > MAX_FILE_CHARS) { text = text.slice(0, MAX_FILE_CHARS); truncated = true; }
      if (!text.trim()) { toast(`${placeholderName} had no extractable text.`, "warn"); continue; }
      attachedFiles.push({ name: file.name, text: truncated ? text + "\n\n[…truncated]" : text, charCount: text.length });
    } catch (err) {
      toast(`Could not read ${placeholderName}: ${err.message}`, "error");
    }
  }
  renderFilePreview();
}

function renderFilePreview() {
  if (attachedFiles.length === 0) { filePreview.hidden = true; filePreview.innerHTML = ""; return; }
  filePreview.hidden = false;
  filePreview.innerHTML = attachedFiles.map((f, i) => `
    <div class="file-chip" data-i="${i}">
      <span class="file-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5z"/></svg></span>
      <span class="file-chip-info"><span class="file-chip-name">${escapeHtml(f.name)}</span><span class="file-chip-meta">${formatFileSize(f.charCount)}</span></span>
      <button class="file-chip-remove" type="button" data-i="${i}" aria-label="Remove file">&times;</button>
    </div>`).join("");
}
filePreview.addEventListener("click", (e) => {
  const btn = e.target.closest(".file-chip-remove");
  if (!btn) return;
  attachedFiles.splice(Number(btn.dataset.i), 1);
  renderFilePreview();
});
function clearAttachedFiles() { attachedFiles = []; renderFilePreview(); }

// ---------------------------------------------------------------------
// Compare mode — same prompt across 2-3 models side by side.
//
// Deliberately ephemeral: nothing here touches currentChatId/currentMessages
// or Firestore. Each column keeps its own tiny in-memory conversation
// history for follow-ups. This keeps the well-tested single-chat send/edit/
// regenerate pipeline completely untouched, and means compare sessions
// don't persist across a reload — a reasonable tradeoff for a scratchpad
// feature, not a place for chats you want to keep.
// ---------------------------------------------------------------------
let isCompareStreaming = false;

compareBtn.addEventListener("click", openComparePicker);
function openComparePicker() {
  comparePickerSelection = new Set(compareModels.length ? compareModels : []);
  renderComparePickerList();
  openModal(comparePickerOverlay);
}
function renderComparePickerList() {
  comparePickerList.innerHTML = MODELS.map((m) => `
    <div class="model-sheet-item ${comparePickerSelection.has(m.id) ? "active" : ""}" data-model="${m.id}">
      <span><span class="msi-label">${m.label}</span><div class="msi-sub">${m.sub}</div></span>
    </div>`).join("");
  comparePickerStart.disabled = comparePickerSelection.size < 2;
  comparePickerStart.textContent = comparePickerSelection.size
    ? `Compare ${comparePickerSelection.size} models`
    : "Start comparing";
}
comparePickerList.addEventListener("click", (e) => {
  const item = e.target.closest(".model-sheet-item");
  if (!item) return;
  const id = item.dataset.model;
  if (comparePickerSelection.has(id)) comparePickerSelection.delete(id);
  else if (comparePickerSelection.size < 3) comparePickerSelection.add(id);
  else { toast("Pick up to 3 models.", "warn"); return; }
  renderComparePickerList();
});
comparePickerCancel.addEventListener("click", () => { closeModal(comparePickerOverlay); });
comparePickerStart.addEventListener("click", () => {
  if (comparePickerSelection.size < 2) return;
  closeModal(comparePickerOverlay);
  enterCompareMode(Array.from(comparePickerSelection));
});

function enterCompareMode(modelIds) {
  isCompareMode = true;
  compareModels = modelIds;
  compareColumnsState = new Map();
  modelIds.forEach((id) => compareColumnsState.set(id, { history: [], buffer: "", reasoningBuffer: "", controller: null, startTime: 0 }));

  saveScrollPositionNow();
  messagesEl.hidden = true;
  compareColumnsEl.hidden = false;
  hideJumpToBottom();
  compareBanner.hidden = false;
  compareBtn.classList.add("active");
  renderCompareBanner();
  renderCompareColumns();
  promptInput.placeholder = "Message all selected models…";
}

function exitCompareMode() {
  compareColumnsState.forEach((col) => col.controller?.abort());
  isCompareMode = false;
  isCompareStreaming = false;
  setComposerStreamingState(false);
  messagesEl.hidden = false;
  compareColumnsEl.hidden = true;
  compareBanner.hidden = true;
  compareBtn.classList.remove("active");
  promptInput.placeholder = "Message Airoq1… ( / for commands )";
}
compareExitBtn.addEventListener("click", exitCompareMode);

function renderCompareBanner() {
  compareModelSelector.innerHTML = compareModels.map((id) => `<span class="compare-model-chip selected">${escapeHtml(modelLabel(id))}</span>`).join("");
}

function renderCompareColumns() {
  compareColumnsEl.innerHTML = compareModels.map((id) => `
    <div class="compare-column" data-model="${id}">
      <div class="compare-column-header">
        <span>${escapeHtml(modelLabel(id))}</span>
        <span class="compare-tps" data-model="${id}"></span>
      </div>
      <div class="compare-column-messages" data-model="${id}">
        <p class="field-hint" style="padding:16px;">Send a message below to compare responses from ${escapeHtml(modelLabel(id))} here.</p>
      </div>
    </div>`).join("");
}

async function sendCompareMessage() {
  const text = promptInput.value.trim();
  if (!text) return;
  if (attachedImages.length || attachedFiles.length) {
    toast("Images and files aren't supported in compare mode yet.", "warn");
    clearAttachedImages(); clearAttachedFiles();
  }
  promptInput.value = ""; autoResize();
  isCompareStreaming = true;
  setComposerStreamingState(true);

  // Show the shared prompt at the top of every column so it's clear what
  // was asked, then stream each model's reply into its own column.
  compareModels.forEach((id) => {
    const col = compareColumnsState.get(id);
    col.history.push({ role: "user", content: text });
    const container = compareColumnsEl.querySelector(`.compare-column-messages[data-model="${CSS.escape(id)}"]`);
    if (container.querySelector(".field-hint")) container.innerHTML = "";
    const userDiv = document.createElement("div");
    userDiv.className = "message user";
    userDiv.innerHTML = `<div class="message-inner"><div class="bubble"><div class="content">${renderMessageContent(text)}</div></div></div>`;
    container.appendChild(userDiv);
    const replyDiv = document.createElement("div");
    replyDiv.className = "message assistant streaming";
    replyDiv.innerHTML = `<div class="message-inner"><div class="bubble"><div class="content"><span class="typing-dots"><span></span><span></span><span></span></span></div></div></div>`;
    container.appendChild(replyDiv);
    container.scrollTop = container.scrollHeight;
    col.el = replyDiv;
    col.buffer = ""; col.reasoningBuffer = ""; col.startTime = performance.now();
    col.controller = new AbortController();
  });

  const runs = compareModels.map((id) => runCompareColumn(id, text));
  await Promise.allSettled(runs);

  isCompareStreaming = false;
  setComposerStreamingState(false);
}

async function runCompareColumn(modelId, userText) {
  const col = compareColumnsState.get(modelId);
  const modelInfo = MODELS.find((m) => m.id === modelId);
  const apiMessages = modelInfo?.agentic
    ? col.history.map((m) => ({ role: m.role, content: m.content }))
    : [{ role: "system", content: SYSTEM_PROMPT }, ...col.history.map((m) => ({ role: m.role, content: m.content }))];
  const tpsEl = compareColumnsEl.querySelector(`.compare-tps[data-model="${CSS.escape(modelId)}"]`);
  const container = compareColumnsEl.querySelector(`.compare-column-messages[data-model="${CSS.escape(modelId)}"]`);

  const onDelta = (partial, partialReasoning) => {
    col.buffer = partial; col.reasoningBuffer = partialReasoning;
    let html = "";
    if (col.reasoningBuffer) {
      html += `<details class="think-block" ${!col.buffer ? "open" : ""}><summary>${!col.buffer ? "Thinking…" : "Thought process"}</summary><div class="think-content">${renderMessageContent(col.reasoningBuffer)}</div></details>`;
    }
    html += renderMessageContent(col.buffer) + '<span class="cursor"></span>';
    col.el.querySelector(".content").innerHTML = html;
    if (tpsEl && col.buffer) tpsEl.innerHTML = tpsHtml(col.buffer.length, col.startTime);
    container.scrollTop = container.scrollHeight;
  };

  try {
    const result = await streamCompletion(apiMessages, modelId, { temperature: 0.7, maxTokens: 4096 }, onDelta, col.controller.signal);
    col.el.classList.remove("streaming");
    col.el.querySelector(".content").innerHTML = renderMessageContent(result.text) || "<em>(empty response)</em>";
    col.history.push({ role: "assistant", content: result.text });
  } catch (err) {
    col.el.classList.remove("streaming");
    col.el.querySelector(".content").innerHTML = `<span class="error-text">⚠ ${escapeHtml(err.message || "Something went wrong.")}</span>`;
  }
}

// ---------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------
settingsBtn.addEventListener("click", openSettings);
function openSettings() {
  apiKeyInput.value = localStorage.getItem("flint_groq_key") || "";
  apiKeyInput.type = "password";
  openModal(settingsModal);
}
function closeSettings() { closeModal(settingsModal); }
toggleKeyBtn.addEventListener("click", () => {
  const nowVisible = apiKeyInput.type === "password";
  apiKeyInput.type = nowVisible ? "text" : "password";
  toggleKeyBtn.setAttribute("aria-label", nowVisible ? "Hide key" : "Show key");
});
saveSettingsBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (key) localStorage.setItem("flint_groq_key", key); else localStorage.removeItem("flint_groq_key");
  toast("Settings saved.", "success");
  closeSettings();
});

// ---------------------------------------------------------------------
// Web search toggle — enables Groq's native browser_search tool.
// Only GPT-OSS models support it; Compound already searches automatically
// without needing the toggle; other models have no Groq-side mechanism.
// ---------------------------------------------------------------------
webSearchToggle.addEventListener("click", () => {
  const modelInfo = MODELS.find((m) => m.id === selectedModel);
  if (modelInfo?.agentic) { toast("Compound models already search the web automatically.", "info"); return; }
  if (!BUILT_IN_SEARCH_MODELS.has(selectedModel)) {
    toast("Web search is only available on GPT-OSS 120B / 20B for now — switch models to use it.", "warn");
    return;
  }
  webSearchEnabled = !webSearchEnabled;
  webSearchToggle.classList.toggle("active", webSearchEnabled);
  webSearchToggle.setAttribute("aria-pressed", String(webSearchEnabled));
  toast(webSearchEnabled ? "Web search enabled for this chat." : "Web search disabled.", "info");
});
// Reflect support/state on the toggle whenever the model changes.
function updateWebSearchToggleUI() {
  const modelInfo = MODELS.find((m) => m.id === selectedModel);
  const supported = BUILT_IN_SEARCH_MODELS.has(selectedModel) || modelInfo?.agentic;
  webSearchToggle.style.opacity = supported ? "1" : ".4";
  const activeNow = webSearchEnabled && BUILT_IN_SEARCH_MODELS.has(selectedModel);
  webSearchToggle.classList.toggle("active", activeNow);
  webSearchToggle.setAttribute("aria-pressed", String(activeNow));
}

// ---------------------------------------------------------------------
// Mobile sidebar
// ---------------------------------------------------------------------
menuToggleBtn.addEventListener("click", () => { sidebar.classList.add("open"); sidebarBackdrop.classList.add("show"); });
sidebarBackdrop.addEventListener("click", closeMobileSidebar);
function closeMobileSidebar() { sidebar.classList.remove("open"); sidebarBackdrop.classList.remove("show"); }
sidebarCollapseBtn.addEventListener("click", () => { sidebar.classList.toggle("collapsed"); });

// ---------------------------------------------------------------------
// Resizable sidebar — drag the handle, persist width in localStorage
// ---------------------------------------------------------------------
(function setupSidebarResize() {
  const SIDEBAR_MIN = 200, SIDEBAR_MAX = 480;
  const saved = parseInt(localStorage.getItem("flint_sidebar_w"), 10);
  if (saved && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
    document.documentElement.style.setProperty("--sidebar-w", `${saved}px`);
  }
  let dragging = false, startX = 0, startW = 0;
  sidebarResizeHandle.addEventListener("mousedown", (e) => {
    if (sidebar.classList.contains("collapsed")) return;
    dragging = true; startX = e.clientX; startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"), 10) || 288;
    sidebar.classList.add("resizing");
    sidebarResizeHandle.classList.add("active");
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const newW = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (e.clientX - startX)));
    document.documentElement.style.setProperty("--sidebar-w", `${newW}px`);
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    sidebar.classList.remove("resizing");
    sidebarResizeHandle.classList.remove("active");
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"), 10);
    localStorage.setItem("flint_sidebar_w", String(w));
  });
})();

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  // Errors/warnings get an assertive alert role so screen readers announce
  // them immediately; success/info toasts rely on the container's
  // aria-live="polite" and don't interrupt whatever's already being read.
  el.setAttribute("role", type === "error" || type === "warn" ? "alert" : "status");
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3500);
}

// A tiny personality touch on the single most-repeated low-stakes action
// in the app — varied phrasing instead of the exact same string every time.
// Purely cosmetic, never applied to errors/warnings, which stay precise.
const COPY_CONFIRMATIONS = ["Copied to clipboard.", "Copied.", "Got it — copied.", "Clipboard updated."];
function toastCopied() {
  toast(COPY_CONFIRMATIONS[Math.floor(Math.random() * COPY_CONFIRMATIONS.length)], "success");
}