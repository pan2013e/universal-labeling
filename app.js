"use strict";

const STORAGE_KEY = "universal-labeling.project.v1";
const AUTH_STORAGE_KEY = "universal-labeling.auth.v1";
const ACTIVE_PROJECT_KEY = "universal-labeling.activeProject.v1";
const LEGACY_PROJECT_CACHE_KEY = STORAGE_KEY;
const DEFAULT_PROJECT_NAME = "Example Project";
const DEFAULT_PROJECT_ID = "example-project";
const LEGACY_DEFAULT_PROJECT_NAME = "Software Review Labeling";
const LEGACY_DEFAULT_PROJECT_ID = "software-review-labeling";
const CURRENT_STATE_VERSION = 2;

const sampleRecords = [
  {
    id: "sympy-23927-c1",
    repository: "sympy/sympy",
    pull_request: 23927,
    file: "sympy/printing/latex.py",
    comment: "This branch changes rendering for nested powers. Please classify whether the review comment reports a behavioral issue.",
    diff: "@@ -412,7 +412,10 @@\n- return printer._print(expr.base) + '^' + printer._print(expr.exp)\n+ if expr.exp.is_Rational:\n+     return printer._print(expr.base) + '^{' + printer._print(expr.exp) + '}'\n+ return printer._print(expr.base) + '^' + printer._print(expr.exp)",
    expected_focus: "behavioral"
  },
  {
    id: "django-34411-c3",
    repository: "django/django",
    pull_request: 34411,
    file: "django/db/models/query.py",
    comment: "The reviewer is asking for a clearer variable name and no behavior changes are required.",
    diff: "@@ -82,7 +82,7 @@\n- qs = self._chain()\n+ clone = self._chain()\n  clone.query.add_q(q_object)",
    expected_focus: "style"
  },
  {
    id: "pytest-10012-c8",
    repository: "pytest-dev/pytest",
    pull_request: 10012,
    file: "testing/test_capture.py",
    comment: "The change adds a regression test for fd capture on Windows. Decide whether the item needs resolver review.",
    diff: "def test_fd_capture_windows(tmp_path):\n    assert runpytest(\"--capture=fd\").ret == 0",
    expected_focus: "test"
  },
  {
    id: "pandas-50102-c2",
    repository: "pandas-dev/pandas",
    pull_request: 50102,
    file: "pandas/core/groupby/groupby.py",
    comment: "The reviewer notes that nullable boolean groups now produce a different index order.",
    diff: "@@ -1419,6 +1419,8 @@\n+ if is_bool_dtype(key):\n+     result = result.sort_index()",
    expected_focus: "behavioral"
  }
];

const labelColors = ["#1d8f83", "#375f9c", "#c46d35", "#7d4ea8", "#287d54", "#b34149", "#6a6f2d", "#6f596d"];
const backendViewNames = new Set(["exports", "data", "protocol", "people", "stats"]);

const helpContent = {
  outputs: {
    title: "Backend Console",
    body: [
      "Admins use this backend page to create or switch projects, manage setup, assign roles, and export analysis files.",
      "Reviewers use the Workspace page for labeling and resolution work."
    ]
  },
  "creator-export": {
    title: "Creator Export",
    body: [
      "A project definition is the portable setup file for reviewers. It includes metadata, protocol, sampling choices, assignments, selected records, and context files.",
      "It intentionally excludes submitted labels, resolver decisions, and local drafts."
    ]
  },
  "participant-load": {
    title: "Participant Load",
    body: [
      "Enter the exact name and user id you want stored in label exports, choose your role, then load the creator's project definition.",
      "If the definition does not already contain assignments for that user id, the app assigns the selected records to that participant."
    ]
  },
  sampling: {
    title: "Sampling Plan",
    body: [
      "Use all records when every item should be labeled. Use random percent or random count when the creator wants a stable subset.",
      "The sample-size suggestion estimates the minimum count for a finite population using confidence level, margin of error, and population proportion."
    ]
  },
  "context-fields": {
    title: "Question Context Fields",
    body: [
      "Checked fields are shown to labelers in the review workspace. Drag cards in the sample preview to control the order reviewers see.",
      "Keep the visible context focused enough for consistent decisions, but include enough evidence for edge cases."
    ]
  },
  evidence: {
    title: "Evidence Options",
    body: [
      "Confidence and notes control what labelers must submit with each decision.",
      "Uncertain label handling is optional. Turn it on only when your protocol treats a specific label as special and may require notes."
    ]
  },
  roster: {
    title: "Roster",
    body: [
      "User ids stay stable for assignments and exports. Display names can be edited any time.",
      "Changing a participant role rebuilds role-specific assignments when you apply or rebuild the project."
    ]
  }
};

const rolePermissions = {
  admin: {
    views: ["backend"],
    canEditProject: true,
    canExportDefinition: true,
    canLoadParticipantDefinition: false,
    canExportLabels: true,
    canExportFinal: true,
    canUseFullState: true,
    canClearProject: true,
    canDeleteProject: true,
    canUseWorkspace: false
  },
  labeler: {
    views: ["workspace"],
    canEditProject: false,
    canExportDefinition: false,
    canLoadParticipantDefinition: true,
    canExportLabels: true,
    canExportFinal: false,
    canUseFullState: true,
    canClearProject: true,
    canDeleteProject: false,
    canUseWorkspace: true
  },
  resolver: {
    views: ["workspace"],
    canEditProject: false,
    canExportDefinition: false,
    canLoadParticipantDefinition: true,
    canExportLabels: true,
    canExportFinal: true,
    canUseFullState: true,
    canClearProject: true,
    canDeleteProject: false,
    canUseWorkspace: true
  }
};

function createDefaultState() {
  return {
    version: CURRENT_STATE_VERSION,
    projectName: DEFAULT_PROJECT_NAME,
    metadata: {
      projectId: DEFAULT_PROJECT_ID,
      creatorName: "",
      description: "",
      createdAt: null,
      updatedAt: null
    },
    dataSource: {
      name: "",
      path: "",
      format: "",
      size: 0,
      embedded: true
    },
    sampling: {
      mode: "all",
      percent: 20,
      count: 100,
      confidenceLevel: 95,
      marginOfError: 5,
      populationProportion: 50,
      sampledItemIds: [],
      appliedAt: null
    },
    contextFiles: [],
    importedAt: null,
    detectedFormat: null,
    records: [],
    fields: {
      id: "",
      title: "",
      body: "",
      code: "",
      meta: []
    },
    protocol: {
      primaryQuestion: "What kind of review signal is this item?",
      labels: ["Behavioral issue", "Style or maintainability", "Test or validation", "Unclear"],
      labelersPerItem: 2,
      labelCardinality: "single",
      resolutionPolicy: "disagreements",
      requireConfidence: false,
      requireNotes: true,
      allowCustomLabels: false,
      enableUncertain: true,
      uncertainLabel: "Unclear",
      resolutionQuestion: "What final label should be assigned?",
      instructions: "",
      contextFields: [],
      includeItemContext: true
    },
    users: [
      { id: "u_admin", userHash: "u_admin", name: "Admin", participantName: "Admin", role: "admin", roles: ["admin"] },
      { id: "u_labeler_a", userHash: "u_labeler_a", name: "Labeler A", participantName: "Labeler A", role: "labeler", roles: ["labeler"] },
      { id: "u_labeler_b", userHash: "u_labeler_b", name: "Labeler B", participantName: "Labeler B", role: "labeler", roles: ["labeler"] },
      { id: "u_resolver", userHash: "u_resolver", name: "Resolver", participantName: "Resolver", role: "resolver", roles: ["resolver"] }
    ],
    currentUserId: "u_admin",
    activeRole: "admin",
    assignments: [],
    annotations: {},
    resolutions: {},
    drafts: {
      annotations: {},
      resolutions: {}
    },
    currentItemId: null,
    queueMode: "todo",
    queueSearch: "",
    lastSavedAt: null
  };
}

function createBlankProjectState() {
  const blank = createDefaultState();
  blank.projectName = "New Project";
  blank.metadata = {
    ...blank.metadata,
    projectId: "",
    creatorName: "",
    description: "",
    createdAt: null,
    updatedAt: null
  };
  blank.dataSource = {
    name: "",
    path: "",
    format: "",
    size: 0,
    embedded: true
  };
  blank.sampling = {
    ...blank.sampling,
    sampledItemIds: [],
    appliedAt: null
  };
  blank.contextFiles = [];
  blank.importedAt = null;
  blank.detectedFormat = null;
  blank.records = [];
  blank.fields = {
    id: "",
    title: "",
    body: "",
    code: "",
    meta: []
  };
  blank.assignments = [];
  blank.annotations = {};
  blank.resolutions = {};
  blank.drafts = {
    annotations: {},
    resolutions: {}
  };
  blank.currentItemId = null;
  blank.queueMode = "todo";
  blank.queueSearch = "";
  blank.lastSavedAt = null;
  return blank;
}

let state = loadState();
let auth = loadAuth();
let projects = [];
let activeProjectId = localStorage.getItem(ACTIVE_PROJECT_KEY) || "";
let activePage = "backend";
let selectedLabel = [];
let selectedResolution = [];
let saveTimer = null;
let serverSaveTimer = null;
let isApplyingServerState = false;
let draggedContextField = "";
let serverFileBrowser = {
  purpose: "data",
  path: ".",
  parent: "",
  selectedFile: null
};

const el = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  renderAll();
  await initializeSession();
});

function cacheElements() {
  document.querySelectorAll("[id]").forEach((node) => {
    el[node.id] = node;
  });
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelectorAll("[data-help]").forEach((button) => {
    button.addEventListener("click", () => openHelpModal(button.dataset.help));
  });
  el.closeHelpModal.addEventListener("click", closeHelpModal);
  el.helpModal.addEventListener("click", (event) => {
    if (event.target === el.helpModal) closeHelpModal();
  });
  el.serverFileModal.addEventListener("click", (event) => {
    if (event.target === el.serverFileModal) closeServerFileModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!el.serverFileModal.classList.contains("hidden")) {
        closeServerFileModal();
      } else {
        closeHelpModal();
      }
    }
  });

  el.loginButton.addEventListener("click", loginFromForm);
  el.loginUsername.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginFromForm();
    }
  });
  el.logoutButton.addEventListener("click", logout);
  el.projectPicker.addEventListener("change", async () => {
    const nextProjectId = el.projectPicker.value;
    await flushServerSave();
    activeProjectId = nextProjectId;
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
    loadProjectFromServer(activeProjectId);
  });
  el.createProject.addEventListener("click", () => createProjectOnServer({ blank: true }));
  el.deleteProject.addEventListener("click", deleteCurrentProject);

  el.projectName.addEventListener("input", () => {
    if (!getPermissions().canEditProject) {
      el.projectName.value = state.projectName;
      return;
    }
    state.projectName = el.projectName.value;
    state.metadata.updatedAt = new Date().toISOString();
    persistAndRender(["shell"]);
  });

  bindProjectMetadataField(el.creatorName, "creatorName");
  bindProjectMetadataField(el.projectId, "projectId");
  bindProjectMetadataField(el.projectDescription, "description");
  el.dataFilePath.addEventListener("input", () => {
    if (!getPermissions().canEditProject) {
      el.dataFilePath.value = state.dataSource.path || "";
      return;
    }
    state.dataSource.path = el.dataFilePath.value.trim();
    state.metadata.updatedAt = new Date().toISOString();
    persistAndRender(["exports"]);
  });
  el.samplingMode.addEventListener("change", () => {
    if (!getPermissions().canEditProject) return;
    state.sampling.mode = el.samplingMode.value;
    updateSamplingControls();
    renderSamplingWarnings();
    schedulePersist();
  });
  el.samplingPercent.addEventListener("input", () => {
    if (!getPermissions().canEditProject) return;
    state.sampling.percent = Number(el.samplingPercent.value);
    renderSampleSizeSuggestion();
    renderSamplingWarnings();
    schedulePersist();
  });
  el.samplingCount.addEventListener("input", () => {
    if (!getPermissions().canEditProject) return;
    state.sampling.count = Number(el.samplingCount.value);
    renderSamplingWarnings();
    schedulePersist();
  });
  el.sampleConfidence.addEventListener("change", () => {
    if (!getPermissions().canEditProject) return;
    state.sampling.confidenceLevel = Number(el.sampleConfidence.value);
    renderSampleSizeSuggestion();
    renderSamplingWarnings();
    schedulePersist();
  });
  el.sampleMargin.addEventListener("input", () => {
    if (!getPermissions().canEditProject) return;
    state.sampling.marginOfError = Number(el.sampleMargin.value);
    renderSampleSizeSuggestion();
    renderSamplingWarnings();
    schedulePersist();
  });
  el.sampleProportion.addEventListener("input", () => {
    if (!getPermissions().canEditProject) return;
    state.sampling.populationProportion = Number(el.sampleProportion.value);
    renderSampleSizeSuggestion();
    renderSamplingWarnings();
    schedulePersist();
  });

  el.currentUser.addEventListener("change", () => {
    state.activeRole = el.currentUser.value;
    state.currentItemId = null;
    persistAndRender();
  });

  el.dataFile.addEventListener("change", (event) => {
    if (!getPermissions().canEditProject) {
      event.target.value = "";
      return;
    }
    const file = event.target.files[0];
    if (file) {
      importDataFile(file);
    }
    event.target.value = "";
  });

  el.projectFile.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      restoreProjectFile(file);
    }
    event.target.value = "";
  });

  el.contextFiles.addEventListener("change", (event) => {
    if (!getPermissions().canEditProject) {
      event.target.value = "";
      return;
    }
    addContextFiles([...event.target.files]);
    event.target.value = "";
  });
  el.openServerDataFile.addEventListener("click", () => openServerFileBrowser("data"));
  el.openServerContextFiles.addEventListener("click", () => openServerFileBrowser("context"));
  el.closeServerFileModal.addEventListener("click", closeServerFileModal);
  el.serverFileGo.addEventListener("click", () => loadServerFileList(el.serverFilePath.value.trim() || "."));
  el.serverFilePath.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadServerFileList(el.serverFilePath.value.trim() || ".");
    }
  });
  el.serverFileUp.addEventListener("click", () => {
    if (serverFileBrowser.parent) {
      loadServerFileList(serverFileBrowser.parent);
    }
  });
  el.serverFileConfirm.addEventListener("click", confirmServerFileSelection);
  el.splitArrayRecords.addEventListener("click", splitRecordsBySelectedArrayField);
  el.attachItemContext.addEventListener("click", attachPerItemServerContext);

  el.participantProjectFile.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      loadProjectForParticipant(file);
    }
    event.target.value = "";
  });

  el.loadSample.addEventListener("click", () => {
    if (!getPermissions().canEditProject) return;
    importRecords(sampleRecords, "sample-json", "sample");
  });
  el.applyProtocol.addEventListener("click", applyProtocolFromForm);
  el.addLabelOption.addEventListener("click", addProtocolLabel);
  el.newLabelName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addProtocolLabel();
    }
  });
  el.addCustomLabel.addEventListener("click", () => addCustomWorkspaceLabel("labeler"));
  el.customLabelInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomWorkspaceLabel("labeler");
    }
  });
  el.addCustomResolutionLabel.addEventListener("click", () => addCustomWorkspaceLabel("resolver"));
  el.customResolutionLabelInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomWorkspaceLabel("resolver");
    }
  });
  el.enableUncertain.addEventListener("change", () => {
    if (!getPermissions().canEditProject) {
      el.enableUncertain.checked = state.protocol.enableUncertain;
      return;
    }
    state.protocol.enableUncertain = el.enableUncertain.checked;
    if (!state.protocol.enableUncertain) {
      state.protocol.requireNotes = false;
      state.protocol.uncertainLabel = "";
    } else if (!state.protocol.uncertainLabel) {
      state.protocol.uncertainLabel = "Unclear";
    }
    persistAndRender(["protocol", "workspace", "exports"]);
  });
  el.selectRecommendedContext.addEventListener("click", selectRecommendedContextFields);
  el.applySampling.addEventListener("click", applySamplingPlan);
  el.useSuggestedSample.addEventListener("click", useSuggestedSampleSize);
  el.rebuildAssignments.addEventListener("click", () => {
    if (!getPermissions().canEditProject) return;
    rebuildAssignments();
    persistAndRender();
  });
  el.addUser.addEventListener("click", addUser);
  el.clearProject.addEventListener("click", clearProject);
  el.exportProjectDefinition.addEventListener("click", exportProjectDefinition);
  el.exportProject.addEventListener("click", exportProject);
  el.exportLabelsJsonl.addEventListener("click", exportLabelsJsonl);
  el.exportFinalCsv.addEventListener("click", exportFinalCsv);
  el.saveLabel.addEventListener("click", saveCurrentLabel);
  el.clearLabel.addEventListener("click", clearCurrentLabel);
  el.saveResolution.addEventListener("click", saveCurrentResolution);
  el.clearResolution.addEventListener("click", clearCurrentResolution);

  el.confidenceInput.addEventListener("input", () => {
    el.confidenceValue.textContent = `${el.confidenceInput.value}%`;
    saveLabelDraftForCurrent();
    validateLabelForm();
  });
  el.labelNotes.addEventListener("input", () => {
    saveLabelDraftForCurrent();
    validateLabelForm();
  });
  el.resolutionNotes.addEventListener("input", saveResolutionDraftForCurrent);
  el.queueSearch.addEventListener("input", () => {
    state.queueSearch = el.queueSearch.value;
    renderWorkspace();
    schedulePersist();
  });

  el.queueMode.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.queueMode = button.dataset.mode;
      state.currentItemId = null;
      persistAndRender(["workspace"]);
    });
  });
}

function bindProjectMetadataField(input, key) {
  input.addEventListener("input", () => {
    if (!getPermissions().canEditProject) {
      input.value = state.metadata[key] || "";
      return;
    }
    state.metadata[key] = input.value;
    state.metadata.updatedAt = new Date().toISOString();
    schedulePersist();
    renderExports();
  });
}

function openHelpModal(key) {
  const content = helpContent[key];
  if (!content) return;
  el.helpModalTitle.textContent = content.title;
  el.helpModalBody.innerHTML = content.body
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
  el.helpModal.classList.remove("hidden");
}

function closeHelpModal() {
  el.helpModal.classList.add("hidden");
}

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveAuth(nextAuth) {
  auth = nextAuth;
  if (auth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

async function initializeSession() {
  renderAuth();
  if (!auth?.token) return;
  try {
    const me = await apiRequest("/api/me");
    saveAuth({ ...auth, user: me.user });
    await refreshProjects();
    if (projects.length) {
      const targetProject = projects.some((project) => project.id === activeProjectId)
        ? activeProjectId
        : projects[0].id;
      await loadProjectFromServer(targetProject);
    } else {
      await createProjectOnServer();
    }
  } catch (error) {
    console.warn("Could not restore session", error);
    saveAuth(null);
    renderAuth();
  }
}

async function loginFromForm() {
  const username = el.loginUsername.value.trim();
  if (!username) {
    alert("Enter a unique user name.");
    return;
  }
  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { username }
    });
    saveAuth(result);
    await refreshProjects();
    if (projects.length) {
      const targetProject = projects.some((project) => project.id === activeProjectId)
        ? activeProjectId
        : projects[0].id;
      await loadProjectFromServer(targetProject);
    } else {
      await createProjectOnServer();
    }
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function logout() {
  try {
    await flushServerSave();
    if (auth?.token) {
      await apiRequest("/api/auth/logout", { method: "POST" });
    }
  } catch {
    // Logging out should still clear the browser session if the server token is stale.
  }
  saveAuth(null);
  projects = [];
  state = createDefaultState();
  renderAll();
}

async function refreshProjects() {
  if (!auth?.token) {
    projects = [];
    return;
  }
  const result = await apiRequest("/api/projects");
  projects = result.projects || [];
  renderProjectPicker();
}

async function createProjectOnServer(options = {}) {
  if (!auth?.token) {
    alert("Sign in before creating a project.");
    return;
  }
  const projectState = options.blank ? createBlankProjectState() : createDefaultState();
  try {
    const result = await apiRequest("/api/projects", {
      method: "POST",
      body: {
        projectName: projectState.projectName,
        state: sanitizeStateForServer(projectState)
      }
    });
    applyServerProject(result);
    await refreshProjects();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteCurrentProject() {
  if (!getPermissions().canDeleteProject) return;
  if (!activeProjectId) {
    alert("Select a server project before deleting.");
    return;
  }
  const projectName = state.projectName || "this project";
  const confirmed = confirm(`Delete "${projectName}" from the server? This removes its members, assignments, labels, resolutions, and exports for everyone.`);
  if (!confirmed) return;

  try {
    clearTimeout(serverSaveTimer);
    await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}`, {
      method: "DELETE"
    });
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    localStorage.removeItem(STORAGE_KEY);
    activeProjectId = "";
    state = createDefaultState();
    selectedLabel = [];
    selectedResolution = [];
    await refreshProjects();
    if (projects.length) {
      await loadProjectFromServer(projects[0].id);
    } else {
      await createProjectOnServer();
    }
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function loadProjectFromServer(projectId) {
  if (!auth?.token || !projectId) return;
  try {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`);
    applyServerProject(result);
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

function applyServerProject(result) {
  isApplyingServerState = true;
  activeProjectId = result.project.id;
  localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
  const nextState = normalizeState(result.state || createDefaultState());
  nextState.serverProjectId = activeProjectId;
  nextState.currentUserId = auth?.user?.id || nextState.currentUserId;
  const currentMember = nextState.users.find((user) => user.id === nextState.currentUserId);
  const availableRoles = currentMember ? getUserRoles(currentMember) : [];
  nextState.activeRole = availableRoles.includes(nextState.activeRole)
    ? nextState.activeRole
    : availableRoles[0] || "admin";
  state = nextState;
  selectedLabel = [];
  selectedResolution = [];
  clearLegacyProjectCache();
  isApplyingServerState = false;
}

function sanitizeStateForServer(inputState) {
  const clone = JSON.parse(JSON.stringify(inputState || {}));
  clone.users = (clone.users || []).map((user) => sanitizeUserForOutput(user));
  return clone;
}

function renderAuth() {
  if (!el.authStatus) return;
  const signedIn = Boolean(auth?.token);
  el.loginPage?.classList.toggle("hidden", signedIn);
  el.appShell?.classList.toggle("hidden", !signedIn);
  el.loginButton.disabled = Boolean(auth?.token);
  el.logoutButton.classList.toggle("hidden", !signedIn);
  el.loginUsername.disabled = Boolean(auth?.token);
  if (auth?.user) {
    if (el.loginUsername.value !== auth.user.username) {
      el.loginUsername.value = auth.user.username;
    }
    el.authStatus.textContent = `Signed in as ${auth.user.username}`;
  } else {
    el.authStatus.textContent = "Not signed in";
    el.loginUsername.disabled = false;
    el.loginButton.disabled = false;
  }
  renderProjectPicker();
}

function renderProjectPicker() {
  if (!el.projectPicker) return;
  el.projectPicker.innerHTML = "";
  if (!auth?.token) {
    el.projectPicker.appendChild(new Option("Sign in to load projects", ""));
    el.projectPicker.disabled = true;
    el.createProject.disabled = true;
    el.deleteProject.disabled = true;
    return;
  }
  if (!projects.length) {
    el.projectPicker.appendChild(new Option("No projects yet", ""));
  } else {
    projects.forEach((project) => {
      const option = new Option(`${project.name} (${project.roles.join(", ")})`, project.id);
      el.projectPicker.appendChild(option);
    });
  }
  el.projectPicker.value = activeProjectId || projects[0]?.id || "";
  el.projectPicker.disabled = !projects.length;
  el.createProject.disabled = false;
  el.deleteProject.disabled = !projects.length;
}

function loadState() {
  clearLegacyProjectCache();
  return createDefaultState();
}

function normalizeState(raw) {
  const defaults = createDefaultState();
  const normalized = {
    ...defaults,
    ...raw,
    fields: { ...defaults.fields, ...(raw.fields || {}) },
    protocol: { ...defaults.protocol, ...(raw.protocol || {}) },
    metadata: { ...defaults.metadata, ...(raw.metadata || {}) },
    dataSource: { ...defaults.dataSource, ...(raw.dataSource || {}) },
    sampling: { ...defaults.sampling, ...(raw.sampling || {}) },
    contextFiles: Array.isArray(raw.contextFiles) ? raw.contextFiles : [],
    users: normalizeUsers(raw.users, defaults.users),
    records: Array.isArray(raw.records) ? raw.records : [],
    assignments: Array.isArray(raw.assignments) ? raw.assignments : [],
    annotations: raw.annotations || {},
    resolutions: raw.resolutions || {},
    drafts: {
      annotations: raw.drafts?.annotations || {},
      resolutions: raw.drafts?.resolutions || {}
    }
  };
  return migrateStateShape(normalizeDefaultProjectName(normalized));
}

function normalizeDefaultProjectName(projectState) {
  if (projectState.projectName === LEGACY_DEFAULT_PROJECT_NAME) {
    projectState.projectName = DEFAULT_PROJECT_NAME;
  }
  if (projectState.metadata?.projectId === LEGACY_DEFAULT_PROJECT_ID) {
    projectState.metadata.projectId = DEFAULT_PROJECT_ID;
  }
  return projectState;
}

function migrateStateShape(projectState) {
  projectState.version = CURRENT_STATE_VERSION;
  projectState.protocol = {
    ...createDefaultState().protocol,
    ...(projectState.protocol || {}),
    labelCardinality: ["single", "multiple"].includes(projectState.protocol?.labelCardinality)
      ? projectState.protocol.labelCardinality
      : "single",
    allowCustomLabels: Boolean(projectState.protocol?.allowCustomLabels),
    includeItemContext: projectState.protocol?.includeItemContext !== false
  };
  projectState.annotations = migrateDecisionCollection(projectState.annotations || {});
  projectState.resolutions = migrateDecisionCollection(projectState.resolutions || {});
  projectState.drafts ||= { annotations: {}, resolutions: {} };
  projectState.drafts.annotations = migrateDecisionCollection(projectState.drafts.annotations || {});
  projectState.drafts.resolutions = migrateDecisionCollection(projectState.drafts.resolutions || {});
  return projectState;
}

function migrateDecisionCollection(collection) {
  Object.entries(collection || {}).forEach(([itemId, value]) => {
    const looksLikeByUser = value && typeof value === "object" && !Array.isArray(value) && !("value" in value) && !("values" in value);
    if (looksLikeByUser) {
      Object.entries(value).forEach(([userId, decision]) => {
        value[userId] = migrateDecision(decision);
      });
    } else {
      collection[itemId] = migrateDecision(value);
    }
  });
  return collection;
}

function migrateDecision(decision) {
  if (!decision || typeof decision !== "object") return decision;
  const values = decisionValues(decision);
  return {
    ...decision,
    value: decision.value || formatLabelValues(values, "|"),
    values
  };
}

function normalizeUsers(users, defaultUsers) {
  const source = Array.isArray(users) && users.length ? users : defaultUsers;
  const normalized = source
    .filter((user) => user && user.id)
    .map((user) => {
      const roles = normalizeRoles(user.roles || [user.role]);
      return {
        id: String(user.id),
        userHash: String(user.userHash || user.id),
        username: user.username ? String(user.username) : "",
        name: String(user.name || user.participantName || user.id),
        participantName: String(user.participantName || user.name || user.id),
        roles,
        role: roles[0] || "labeler"
      };
    });

  if (!normalized.some((user) => getUserRoles(user).includes("admin"))) {
    const defaultAdmin = defaultUsers.find((user) => user.role === "admin");
    normalized.unshift({
      ...defaultAdmin,
      userHash: defaultAdmin.id,
      participantName: defaultAdmin.name,
      roles: ["admin"]
    });
  }
  return normalized.length ? normalized : defaultUsers;
}

function normalizeRoles(roles) {
  const allowed = new Set(["admin", "labeler", "resolver"]);
  const source = Array.isArray(roles) ? roles : [roles];
  return [...new Set(source.filter((role) => allowed.has(role)))];
}

function getUserRoles(user) {
  return normalizeRoles(user?.roles || [user?.role]);
}

function userHasRole(user, role) {
  return getUserRoles(user).includes(role);
}

function isMultiLabelMode() {
  return state.protocol.labelCardinality === "multiple";
}

function normalizeLabelValues(values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const normalized = [];
  source.forEach((value) => {
    const label = String(value || "").trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) {
      seen.add(key);
      normalized.push(label);
    }
  });
  return normalized;
}

function decisionValues(decision) {
  if (!decision) return [];
  if (Array.isArray(decision.values)) {
    return normalizeLabelValues(decision.values);
  }
  if (typeof decision.value === "string" && decision.value.includes("|")) {
    return normalizeLabelValues(decision.value.split("|"));
  }
  return normalizeLabelValues(decision.value);
}

function decisionPayload(values) {
  const normalized = normalizeLabelValues(values);
  return {
    value: normalized.join("|"),
    values: normalized
  };
}

function labelSetKey(values) {
  return normalizeLabelValues(values)
    .map((value) => value.toLowerCase())
    .sort()
    .join("\u001f");
}

function formatLabelValues(values, separator = ", ") {
  return normalizeLabelValues(values).join(separator);
}

function mergeChoiceLabels(labels, selectedValues = []) {
  return normalizeLabelValues([...(labels || []), ...selectedValues]);
}

function toggleSelectedLabel(values, label) {
  const normalized = normalizeLabelValues(values);
  if (!isMultiLabelMode()) return [label];
  const key = label.toLowerCase();
  return normalized.some((value) => value.toLowerCase() === key)
    ? normalized.filter((value) => value.toLowerCase() !== key)
    : [...normalized, label];
}

function persistAndRender(scope = null) {
  saveState();
  if (!scope) {
    renderAll();
    return;
  }
  if (scope.includes("shell")) renderShell();
  if (scope.includes("data")) renderData();
  if (scope.includes("protocol")) renderProtocol();
  if (scope.includes("people")) renderPeople();
  if (scope.includes("workspace")) renderWorkspace();
  if (scope.includes("stats")) renderStats();
  if (scope.includes("exports")) renderExports();
  applyRoleVisibility();
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
}

function saveState() {
  state.lastSavedAt = new Date().toISOString();
  clearLegacyProjectCache();
  renderSaveStatus();
  queueServerSave();
}

function clearLegacyProjectCache() {
  try {
    localStorage.removeItem(LEGACY_PROJECT_CACHE_KEY);
  } catch {
    // Browser storage is best-effort; SQLite remains the project source of truth.
  }
}

function queueServerSave() {
  if (!canSaveActiveProjectState()) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(saveStateToServer, 450);
}

function canSaveActiveProjectState() {
  return Boolean(auth?.token && activeProjectId && !isApplyingServerState && state.serverProjectId === activeProjectId);
}

async function saveStateToServer() {
  if (!canSaveActiveProjectState()) return;
  try {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/state`, {
      method: "PUT",
      body: { state: sanitizeStateForServer(state) }
    });
    state.lastSavedAt = result.state?.lastSavedAt || state.lastSavedAt;
    state.serverVersion = result.state?.serverVersion ?? state.serverVersion;
    renderSaveStatus();
    await refreshProjects();
  } catch (error) {
    el.saveStatus.textContent = `Sync failed: ${error.message}`;
  }
}

async function flushServerSave() {
  clearTimeout(serverSaveTimer);
  if (!canSaveActiveProjectState()) return;
  await saveStateToServer();
}

function renderAll() {
  renderShell();
  renderData();
  renderProtocol();
  renderPeople();
  renderWorkspace();
  renderStats();
  renderExports();
  applyRoleVisibility();
}

function renderShell() {
  el.projectName.value = state.projectName;
  const activeRecords = getWorkRecords();
  el.projectStatus.textContent = state.records.length
    ? `${activeRecords.length} selected / ${state.records.length} records / ${state.assignments.length} assignments`
    : "No dataset loaded";

  if (auth?.user) {
    state.currentUserId = auth.user.id;
  }
  const currentMember = getCurrentMembership();
  if (!currentMember && state.users.length && !auth?.user) {
    state.currentUserId = state.users[0].id;
  }
  el.currentUser.innerHTML = "";
  const roleSource = getCurrentMembership() || state.users[0] || null;
  const roles = getUserRoles(roleSource);
  if (!roles.includes(state.activeRole)) {
    state.activeRole = roles[0] || "admin";
  }
  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    el.currentUser.appendChild(option);
  });
  if (!roles.length) {
    el.currentUser.appendChild(new Option("No project role", ""));
  }
  el.currentUser.value = state.activeRole || "";
  el.currentUser.disabled = roles.length <= 1;
  renderSaveStatus();
  renderAuth();
}

function getPermissions(user = getCurrentUser()) {
  return rolePermissions[user?.role] || rolePermissions.labeler;
}

function canView(viewName, user = getCurrentUser()) {
  return getPermissions(user).views.includes(viewName);
}

function getFirstAllowedView(user = getCurrentUser()) {
  return getPermissions(user).views[0] || "backend";
}

function getActiveViewName() {
  return activePage;
}

function renderSaveStatus() {
  if (!el.saveStatus) return;
  el.saveStatus.textContent = state.lastSavedAt
    ? `Saved ${formatTime(state.lastSavedAt)}`
    : "Not saved yet";
}

function switchView(viewName) {
  const targetView = canView(viewName) ? viewName : getFirstAllowedView();
  activePage = targetView;
  window.scrollTo({ top: 0, left: 0 });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === targetView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    const viewName = view.id.replace("view-", "");
    const visible = targetView === "backend"
      ? backendViewNames.has(viewName)
      : viewName === targetView;
    view.classList.toggle("active", visible);
  });
  if (targetView === "backend") {
    renderExports();
  }
  applyRoleVisibility();
}

function applyRoleVisibility() {
  const user = getCurrentUser();
  const permissions = getPermissions(user);
  const canEdit = permissions.canEditProject;
  if (!canEdit) {
    el.serverFileModal?.classList.add("hidden");
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    const allowed = permissions.views.includes(button.dataset.view);
    button.classList.toggle("hidden", !allowed);
    button.disabled = !allowed;
  });

  const activeView = getActiveViewName();
  if (!permissions.views.includes(activeView)) {
    switchView(getFirstAllowedView(user));
    return;
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activePage);
  });
  document.querySelectorAll(".view").forEach((view) => {
    const viewName = view.id.replace("view-", "");
    const visible = activePage === "backend"
      ? backendViewNames.has(viewName)
      : viewName === activePage;
    view.classList.toggle("active", visible);
  });

  setFormControlState(el.projectName, !canEdit, { readOnly: true });
  setFormControlState(el.deleteProject, !permissions.canDeleteProject || !activeProjectId);
  [
    el.creatorName,
    el.projectId,
    el.dataFilePath,
    el.projectDescription,
    el.dataFile,
    el.openServerDataFile,
    el.loadSample,
    el.contextFiles,
    el.openServerContextFiles,
    el.serverFilePath,
    el.serverFileGo,
    el.serverFileUp,
    el.serverFileConfirm,
    el.splitArrayField,
    el.splitArrayRecords,
    el.itemContextTemplate,
    el.itemContextTitle,
    el.attachItemContext,
    el.samplingMode,
    el.samplingPercent,
    el.samplingCount,
    el.sampleConfidence,
    el.sampleMargin,
    el.sampleProportion,
    el.selectRecommendedContext,
    el.primaryQuestion,
    el.protocolInstructions,
    el.labelersPerItem,
    el.labelCardinality,
    el.resolutionPolicy,
    el.requireConfidence,
    el.allowCustomLabels,
    el.enableUncertain,
    el.resolutionQuestion,
    el.applyProtocol,
    el.newLabelName,
    el.addLabelOption,
    el.rebuildAssignments,
    el.newUserName,
    el.newUserRole,
    el.addUser
  ].forEach((control) => setFormControlState(control, !canEdit));

  setFileButtonState(el.dataFile, !canEdit);
  setFileButtonState(el.contextFiles, !canEdit);
  setFileButtonState(el.projectFile, !permissions.canUseFullState);
  setFileButtonState(el.participantProjectFile, !permissions.canLoadParticipantDefinition);

  document.querySelectorAll("#fieldMapping select, #contextFieldList input, #labelList input, #labelList button, #userList input, #userList select, #userList button")
    .forEach((control) => {
      if (!canEdit) setFormControlState(control, true);
    });

  if (canEdit) {
    renderUncertainControls();
    renderSamplingWarnings();
  } else {
    setFormControlState(el.requireNotes, true);
    setFormControlState(el.uncertainLabel, true);
    setFormControlState(el.applySampling, true);
    setFormControlState(el.useSuggestedSample, true);
  }

  document.querySelectorAll("#contextSample .sample-field").forEach((field) => {
    field.draggable = canEdit;
    field.classList.toggle("locked", !canEdit);
  });

  document.querySelector(".creator-card")?.classList.toggle("hidden", !permissions.canExportDefinition);
  document.querySelector(".participant-card")?.classList.toggle("hidden", !permissions.canLoadParticipantDefinition);
  document.querySelector(".resume-card")?.classList.toggle("hidden", !permissions.canUseFullState);
  document.querySelector(".results-card")?.classList.toggle("hidden", !permissions.canExportLabels && !permissions.canExportFinal);

  setFormControlState(el.exportProjectDefinition, !permissions.canExportDefinition);
  setFormControlState(el.participantName, !permissions.canLoadParticipantDefinition);
  setFormControlState(el.participantId, !permissions.canLoadParticipantDefinition);
  setFormControlState(el.participantRole, !permissions.canLoadParticipantDefinition);
  setFormControlState(el.exportProject, !permissions.canUseFullState);
  setFormControlState(el.exportLabelsJsonl, !permissions.canExportLabels);
  setFormControlState(el.exportFinalCsv, !permissions.canExportFinal);
  setFormControlState(el.clearProject, !permissions.canClearProject);

  el.deleteProject?.classList.toggle("hidden", !permissions.canDeleteProject);
  el.exportLabelsJsonl?.classList.toggle("hidden", !permissions.canExportLabels);
  el.exportFinalCsv?.classList.toggle("hidden", !permissions.canExportFinal);
}

function setFormControlState(control, disabled, options = {}) {
  if (!control) return;
  if (options.readOnly && "readOnly" in control) {
    control.readOnly = disabled;
    control.disabled = false;
  } else {
    control.disabled = disabled;
  }
  control.closest("label")?.classList.toggle("muted-disabled", disabled);
}

function setFileButtonState(input, disabled) {
  if (!input) return;
  input.disabled = disabled;
  input.closest(".file-button")?.classList.toggle("disabled-control", disabled);
}

async function importDataFile(file) {
  const text = await file.text();
  try {
    const parsed = parseStructuredData(text, file.name);
    importRecords(parsed.records, parsed.format, file.name, {
      name: file.name,
      path: state.dataSource.path || file.name,
      size: file.size,
      embedded: true
    });
  } catch (error) {
    alert(error.message);
  }
}

async function openServerFileBrowser(purpose) {
  if (!getPermissions().canEditProject) return;
  serverFileBrowser = {
    purpose,
    path: serverFileBrowser.path || ".",
    parent: serverFileBrowser.parent || "",
    selectedFile: null
  };
  el.serverFileTitle.textContent = purpose === "data" ? "Import Data From Server" : "Add Context Files From Server";
  el.serverFileConfirm.textContent = purpose === "data" ? "Import selected" : "Add selected";
  clearServerFilePreview();
  el.serverFileModal.classList.remove("hidden");
  await loadServerFileList(serverFileBrowser.path || ".");
}

function closeServerFileModal() {
  el.serverFileModal.classList.add("hidden");
}

async function loadServerFileList(relativePath = ".") {
  if (!activeProjectId) {
    el.serverFileStatus.textContent = "Create or select a server project before browsing server files.";
    el.serverFileList.innerHTML = "";
    clearServerFilePreview("Select a server project before previewing files.");
    return;
  }
  try {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/server-files?path=${encodeURIComponent(relativePath || ".")}`);
    renderServerFileList(result);
  } catch (error) {
    el.serverFileStatus.textContent = error.message;
    el.serverFileList.innerHTML = "";
    clearServerFilePreview(error.message);
  }
}

function renderServerFileList(result) {
  serverFileBrowser.path = result.path || ".";
  serverFileBrowser.parent = result.parent || "";
  serverFileBrowser.selectedFile = null;
  el.serverFilePath.value = serverFileBrowser.path;
  el.serverFileUp.disabled = !result.enabled || !serverFileBrowser.parent;
  el.serverFileGo.disabled = !result.enabled;
  el.serverFilePath.disabled = !result.enabled;
  el.serverFileList.innerHTML = "";
  clearServerFilePreview();

  if (!result.enabled) {
    el.serverFileStatus.textContent = "Server filesystem access is disabled. Launch with LABELING_FILE_ROOT=/path/to/files to enable scoped browsing.";
    el.serverFileList.innerHTML = "<div class=\"muted\">Upload files from your browser, or ask the server operator to set a filesystem scope.</div>";
    clearServerFilePreview("Server filesystem access is disabled.");
    return;
  }

  const rootLabel = result.rootLabel ? `/${result.rootLabel}` : "server root";
  el.serverFileStatus.textContent = `${rootLabel} / ${result.path === "." ? "" : result.path} (${formatBytes(result.maxBytes)} read limit)`;
  if (!result.entries.length) {
    el.serverFileList.innerHTML = "<div class=\"muted\">No files in this directory.</div>";
    return;
  }

  result.entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "server-file-row";
    row.dataset.path = entry.path;
    const meta = entry.type === "directory"
      ? "Directory"
      : `${formatBytes(entry.size)}${entry.tooLarge ? " / too large" : ""}`;
    const action = entry.type === "directory"
      ? "<button class=\"secondary server-open\" type=\"button\">Open</button>"
      : `<button class=\"server-select\" type=\"button\" ${entry.tooLarge ? "disabled" : ""}>Preview</button>`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="muted">${escapeHtml(meta)}</span>
      </div>
      ${action}
    `;
    const button = row.querySelector("button");
    button.addEventListener("click", () => {
      if (entry.type === "directory") {
        loadServerFileList(entry.path);
      } else {
        previewServerFile(entry.path);
      }
    });
    el.serverFileList.appendChild(row);
  });
}

async function previewServerFile(relativePath) {
  try {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/server-files/read`, {
      method: "POST",
      body: { path: relativePath, purpose: serverFileBrowser.purpose }
    });
    serverFileBrowser.selectedFile = result.file;
    document.querySelectorAll(".server-file-row").forEach((row) => {
      row.classList.toggle("selected", row.dataset.path === result.file.path);
    });
    renderServerFilePreview(result.file);
  } catch (error) {
    alert(error.message);
  }
}

function clearServerFilePreview(message = "Choose a file to preview it before importing.") {
  serverFileBrowser.selectedFile = null;
  document.querySelectorAll(".server-file-row.selected").forEach((row) => row.classList.remove("selected"));
  el.serverFilePreviewName.textContent = "No file selected";
  el.serverFilePreviewMeta.textContent = message;
  el.serverFilePreview.textContent = "No preview loaded.";
  el.serverFileConfirm.disabled = true;
}

function renderServerFilePreview(file) {
  const metaParts = [file.path || file.name, formatBytes(file.size || 0)];
  if (file.modifiedAt) metaParts.push(`modified ${formatTime(file.modifiedAt)}`);
  let previewText = truncatePreviewText(file.text || "");
  let canConfirm = true;

  if (serverFileBrowser.purpose === "data") {
    try {
      const parsed = parseStructuredData(file.text || "", file.name);
      const sample = parsed.records.slice(0, 3);
      metaParts.push(`${parsed.format}`, `${parsed.records.length} records`);
      previewText = [
        `Detected format: ${parsed.format}`,
        `Record count: ${parsed.records.length}`,
        "",
        "Sample records:",
        JSON.stringify(sample, null, 2)
      ].join("\n");
    } catch (error) {
      canConfirm = false;
      previewText = [
        `This file could not be parsed as an importable dataset: ${error.message}`,
        "",
        "Raw preview:",
        truncatePreviewText(file.text || "")
      ].join("\n");
    }
  }

  el.serverFilePreviewName.textContent = file.name;
  el.serverFilePreviewMeta.textContent = metaParts.join(" / ");
  el.serverFilePreview.textContent = previewText;
  el.serverFileConfirm.textContent = serverFileBrowser.purpose === "data" ? "Import selected" : "Add selected";
  el.serverFileConfirm.disabled = !canConfirm;
}

function truncatePreviewText(text, maxLength = 6000) {
  const value = String(text || "");
  if (value.length <= maxLength) return value || "File is empty.";
  return `${value.slice(0, maxLength)}\n\n... truncated ${value.length - maxLength} characters`;
}

function confirmServerFileSelection() {
  const file = serverFileBrowser.selectedFile;
  if (!file) return;
  if (serverFileBrowser.purpose === "data") {
    importServerDataFile(file);
  } else {
    addServerContextFile(file);
    clearServerFilePreview(`Added ${file.name}. Choose another file to preview.`);
  }
}

function importServerDataFile(file) {
  try {
    const parsed = parseStructuredData(file.text, file.name);
    importRecords(parsed.records, parsed.format, file.name, {
      name: file.name,
      path: file.path,
      size: file.size,
      embedded: true
    });
    closeServerFileModal();
  } catch (error) {
    alert(error.message);
  }
}

function addServerContextFile(file) {
  if (!getPermissions().canEditProject) return;
  state.contextFiles.push({
    id: `ctx_${Date.now().toString(36)}_${slugify(file.name)}`,
    name: file.name,
    path: file.path,
    type: "text/plain",
    size: file.size,
    text: file.text,
    addedAt: new Date().toISOString(),
    source: "server"
  });
  state.metadata.updatedAt = new Date().toISOString();
  persistAndRender(["data", "workspace", "exports"]);
}

async function addContextFiles(files) {
  if (!getPermissions().canEditProject) return;
  const loaded = await Promise.all(files.map(async (file) => ({
    id: `ctx_${Date.now().toString(36)}_${slugify(file.name)}`,
    name: file.name,
    path: file.webkitRelativePath || file.name,
    type: file.type || "text/plain",
    size: file.size,
    text: await file.text(),
    addedAt: new Date().toISOString()
  })));
  state.contextFiles.push(...loaded);
  state.metadata.updatedAt = new Date().toISOString();
  persistAndRender(["data", "workspace", "exports"]);
}

async function restoreProjectFile(file) {
  try {
    const targetServerVersion = state.serverVersion;
    const project = JSON.parse(await file.text());
    state = project.kind === "universal-labeling.project-definition"
      ? stateFromProjectDefinition(project)
      : normalizeState(project);
    if (auth?.token && activeProjectId) {
      state.serverProjectId = activeProjectId;
      state.serverVersion = targetServerVersion;
    }
    selectedLabel = [];
    selectedResolution = [];
    persistAndRender();
    switchView(getPermissions().canUseWorkspace ? "workspace" : "backend");
  } catch (error) {
    alert(`Could not restore project: ${error.message}`);
  }
}

async function loadProjectForParticipant(file) {
  if (!getPermissions().canLoadParticipantDefinition) return;
  const name = el.participantName.value.trim();
  if (!name) {
    alert("Enter your participant name before loading a project.");
    return;
  }

  try {
    const targetServerVersion = state.serverVersion;
    const raw = JSON.parse(await file.text());
    state = raw.kind === "universal-labeling.project-definition"
      ? stateFromProjectDefinition(raw)
      : normalizeState(raw);
    if (auth?.token && activeProjectId) {
      state.serverProjectId = activeProjectId;
      state.serverVersion = targetServerVersion;
    }

    const participant = {
      id: el.participantId.value.trim() || slugify(name),
      name,
      role: el.participantRole.value
    };
    upsertParticipant(participant);
    ensureParticipantAssignments(participant);
    state.currentUserId = participant.id;
    state.currentItemId = null;
    state.queueMode = "todo";
    selectedLabel = [];
    selectedResolution = [];
    persistAndRender();
    switchView("workspace");
  } catch (error) {
    alert(`Could not load project definition: ${error.message}`);
  }
}

function stateFromProjectDefinition(definition) {
  const next = normalizeState({
    ...createDefaultState(),
    projectName: definition.projectName || definition.metadata?.projectName || "Labeling Project",
    metadata: definition.metadata || {},
    dataSource: definition.dataSource || {},
    sampling: definition.sampling || {},
    contextFiles: definition.contextFiles || [],
    importedAt: definition.importedAt || definition.dataSource?.importedAt || null,
    detectedFormat: definition.dataSource?.format || definition.detectedFormat || null,
    records: definition.records || [],
    fields: definition.fields || {},
    protocol: definition.protocol || {},
    users: definition.users || [],
    assignments: definition.assignments || [],
    annotations: {},
    resolutions: {},
    drafts: { annotations: {}, resolutions: {} }
  });
  if (!next.assignments.length) {
    rebuildAssignmentsForState(next);
  }
  return next;
}

function upsertParticipant(participant) {
  const existing = state.users.find((user) => user.id === participant.id);
  if (existing) {
    existing.name = participant.name;
    existing.role = participant.role;
  } else {
    state.users.push(participant);
  }
}

function ensureParticipantAssignments(participant) {
  if (!["labeler", "resolver"].includes(participant.role)) return;
  const hasAssignment = state.assignments.some((assignment) => {
    return assignment.userId === participant.id && assignment.role === participant.role;
  });
  if (hasAssignment) return;

  getWorkRecords().forEach((record) => {
    state.assignments.push({
      itemId: record.id,
      userId: participant.id,
      role: participant.role
    });
  });
  state.assignments = dedupeAssignments(state.assignments);
}

function importRecords(records, format, sourceName, sourceInfo = {}) {
  if (!getPermissions().canEditProject) return;
  const normalized = records.map((record, index) => normalizeRecord(record, index));
  state.records = normalized;
  state.detectedFormat = format;
  state.importedAt = new Date().toISOString();
  state.dataSource = {
    ...state.dataSource,
    ...sourceInfo,
    name: sourceInfo.name || sourceName || state.dataSource.name,
    path: sourceInfo.path || state.dataSource.path || sourceName || "",
    format,
    recordCount: normalized.length,
    importedAt: state.importedAt,
    embedded: sourceInfo.embedded !== false
  };
  if (!state.metadata.createdAt) {
    state.metadata.createdAt = state.importedAt;
  }
  state.metadata.updatedAt = state.importedAt;
  state.fields = inferFields(normalized);
  state.protocol.contextFields = recommendedContextFields();
  state.sampling.sampledItemIds = buildSampledItemIds(normalized, state.sampling);
  state.sampling.appliedAt = state.importedAt;
  state.annotations = {};
  state.resolutions = {};
  state.drafts = { annotations: {}, resolutions: {} };
  state.currentItemId = normalized[0]?.id || null;
  state.projectName = sourceName && sourceName !== "sample"
    ? sourceName.replace(/\.[^.]+$/, "")
    : state.projectName;
  rebuildAssignments();
  persistAndRender();
  switchView(canView("backend") ? "backend" : getFirstAllowedView());
}

function parseStructuredData(text, fileName = "") {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The selected file is empty.");
  }

  const ext = fileName.toLowerCase().split(".").pop();
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if ((ext === "jsonl" || ext === "ndjson" || lines.length > 1) && lines.every((line) => looksLikeJson(line))) {
    return { records: lines.map((line) => JSON.parse(line)), format: "JSONL" };
  }

  if (ext === "csv" || ext === "tsv") {
    return { records: parseDelimited(trimmed, ext === "tsv" ? "\t" : ","), format: ext.toUpperCase() };
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return { records: parsed, format: "JSON array" };
    }
    const arrayKey = Object.keys(parsed).find((key) => Array.isArray(parsed[key]));
    if (arrayKey) {
      return { records: parsed[arrayKey], format: `JSON object / ${arrayKey}` };
    }
    return { records: [parsed], format: "JSON object" };
  }

  const delimiter = detectDelimiter(lines[0]);
  if (delimiter) {
    return { records: parseDelimited(trimmed, delimiter), format: delimiter === "\t" ? "TSV" : "CSV" };
  }

  throw new Error("Could not identify the file format. Use JSON, JSONL, CSV, or TSV.");
}

function looksLikeJson(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  if (tabCount > commaCount && tabCount > 0) return "\t";
  if (commaCount > 0) return ",";
  return null;
}

function parseDelimited(text, delimiter) {
  const rows = parseDelimitedRows(text, delimiter);
  if (rows.length < 2) {
    throw new Error("Delimited data needs a header row and at least one record.");
  }
  const headers = rows[0].map((header, index) => header.trim() || `field_${index + 1}`);
  return rows.slice(1)
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  rows.push(row);
  return rows;
}

function normalizeRecord(record, index) {
  const data = isPlainObject(record) ? flattenObject(record) : { value: record };
  const provisionalId = findFirstValue(data, ["id", "uuid", "key", "comment_id", "review_id", "github_id"]);
  const id = String(provisionalId || `item_${String(index + 1).padStart(5, "0")}`);
  return {
    id,
    data,
    sourceIndex: index
  };
}

function flattenObject(input, prefix = "", output = {}) {
  Object.entries(input || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenObject(value, path, output);
    } else if (Array.isArray(value)) {
      output[path] = value.map((entry) => isPlainObject(entry) ? JSON.stringify(entry) : String(entry)).join("\n");
    } else {
      output[path] = value == null ? "" : String(value);
    }
  });
  return output;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inferFields(records) {
  const keys = getAllFields(records);
  const id = pickField(keys, ["id", "uuid", "key", "comment_id", "review_id", "github_id"]) || keys[0] || "";
  const title = pickField(keys, ["title", "summary", "subject", "name", "comment", "message"]) || keys[0] || "";
  const body = pickField(keys, ["body", "comment", "review_comment", "text", "description", "content", "message"]) || title;
  const code = pickField(keys, ["diff", "patch", "code", "snippet", "file_content", "hunk"]) || "";
  const meta = keys.filter((key) => ![id, title, body, code].includes(key)).slice(0, 5);
  return { id, title, body, code, meta };
}

function pickField(keys, candidates) {
  const lowerMap = new Map(keys.map((key) => [key.toLowerCase(), key]));
  for (const candidate of candidates) {
    if (lowerMap.has(candidate)) return lowerMap.get(candidate);
  }
  return keys.find((key) => candidates.some((candidate) => key.toLowerCase().includes(candidate)));
}

function findFirstValue(data, keys) {
  const match = pickField(Object.keys(data), keys);
  return match ? data[match] : "";
}

function getAllFields(records = state.records) {
  const seen = new Set();
  records.forEach((record) => {
    Object.keys(record.data || {}).forEach((key) => seen.add(key));
  });
  return [...seen];
}

function getWorkRecords(target = state) {
  if (target.sampling.mode === "all") return target.records;
  const sampled = new Set(target.sampling.sampledItemIds || []);
  if (!sampled.size) return target.records;
  return target.records.filter((record) => sampled.has(record.id));
}

function buildSampledItemIds(records, sampling) {
  if (!records.length) return [];
  if (sampling.mode === "all") return records.map((record) => record.id);

  const targetCount = sampling.mode === "percent"
    ? Math.ceil(records.length * Math.max(1, Math.min(100, sampling.percent)) / 100)
    : Math.max(1, Math.min(records.length, Number(sampling.count) || records.length));

  return stableShuffle(records.map((record) => record.id), `${state.metadata.projectId || state.projectName}:${records.length}`)
    .slice(0, targetCount);
}

function stableShuffle(values, seedText) {
  let seed = hashString(seedText);
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recommendedContextFields() {
  const candidates = [state.fields.body, state.fields.code, state.fields.title, ...(state.fields.meta || [])]
    .filter(Boolean);
  return [...new Set(candidates)].filter((field) => getAllFields().includes(field));
}

function selectRecommendedContextFields() {
  if (!getPermissions().canEditProject) return;
  state.protocol.contextFields = recommendedContextFields();
  state.metadata.updatedAt = new Date().toISOString();
  persistAndRender(["data", "protocol", "workspace", "exports"]);
}

function getContextFields() {
  const available = new Set(getAllFields());
  const selected = (state.protocol.contextFields || []).filter((field) => available.has(field));
  return selected.length ? selected : recommendedContextFields();
}

function rebuildAssignments() {
  rebuildAssignmentsForState(state);
}

function rebuildAssignmentsForState(target) {
  const labelers = target.users.filter((user) => userHasRole(user, "labeler"));
  const resolverIds = target.users.filter((user) => userHasRole(user, "resolver")).map((user) => user.id);
  const perItem = Math.max(1, Math.min(Number(target.protocol.labelersPerItem) || 1, Math.max(labelers.length, 1)));
  const assignments = [];

  getWorkRecords(target).forEach((record, index) => {
    for (let offset = 0; offset < perItem; offset += 1) {
      const labeler = labelers[(index + offset) % labelers.length];
      if (labeler) {
        assignments.push({
          itemId: record.id,
          userId: labeler.id,
          role: "labeler"
        });
      }
    }
    resolverIds.forEach((userId) => {
      assignments.push({
        itemId: record.id,
        userId,
        role: "resolver"
      });
    });
  });

  target.assignments = dedupeAssignments(assignments);
}

function dedupeAssignments(assignments) {
  const seen = new Set();
  return assignments.filter((assignment) => {
    const key = `${assignment.itemId}:${assignment.userId}:${assignment.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderData() {
  const fields = getAllFields();
  renderProjectMetadata();
  const activeRecords = getWorkRecords();
  el.detectedFormat.textContent = state.detectedFormat || "None";
  el.recordCount.textContent = String(state.records.length);
  el.fieldCount.textContent = String(fields.length);
  el.importTime.textContent = state.importedAt ? formatTime(state.importedAt) : "-";
  el.dataStatusLine.textContent = state.records.length
    ? `${state.records.length} records / ${activeRecords.length} selected / ${fields.length} fields / ${state.detectedFormat || "unknown format"}`
    : "No records imported.";
  renderFieldMapping(fields);
  renderContextFiles();
  renderDerivedItemControls(fields);
  renderSampling();
  renderContextFieldSelector(fields);
  renderQuality(fields);
  renderPreview(fields);
}

function renderProjectMetadata() {
  el.creatorName.value = state.metadata.creatorName || "";
  el.projectId.value = state.metadata.projectId || "";
  el.projectDescription.value = state.metadata.description || "";
  el.dataFilePath.value = state.dataSource.path || "";
}

function renderContextFiles() {
  el.contextFileList.innerHTML = "";
  if (!state.contextFiles.length) {
    el.contextFileList.innerHTML = "<div class=\"muted\">No additional context files uploaded.</div>";
    return;
  }

  state.contextFiles.forEach((file) => {
    const row = document.createElement("div");
    row.className = "context-file-row";
    const summary = document.createElement("div");
    summary.innerHTML = `
      <strong>${escapeHtml(file.name)}</strong>
      <div class="muted">${escapeHtml(file.path || file.name)} / ${formatBytes(file.size || 0)}</div>
      <div class="context-preview">${escapeHtml(truncate(file.text || "", 220))}</div>
    `;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary icon-button";
    remove.textContent = "x";
    remove.title = `Remove ${file.name}`;
    remove.addEventListener("click", () => removeContextFile(file.id));
    row.append(summary, remove);
    el.contextFileList.appendChild(row);
  });
}

function removeContextFile(fileId) {
  if (!getPermissions().canEditProject) return;
  state.contextFiles = state.contextFiles.filter((file) => file.id !== fileId);
  state.metadata.updatedAt = new Date().toISOString();
  persistAndRender(["data", "workspace", "exports"]);
}

function renderDerivedItemControls(fields) {
  const candidates = fields.filter((field) => state.records.some((record) => parseArrayFieldValue(record.data[field]).length));
  const previous = el.splitArrayField.value;
  el.splitArrayField.innerHTML = "";
  if (!candidates.length) {
    el.splitArrayField.appendChild(new Option("No array-like fields detected", ""));
  } else {
    candidates.forEach((field) => el.splitArrayField.appendChild(new Option(field, field)));
    el.splitArrayField.value = candidates.includes(previous) ? previous : candidates[0];
  }
  el.splitArrayRecords.disabled = !getPermissions().canEditProject || !candidates.length;

  const attachedCount = state.records.reduce((sum, record) => sum + (record.contextFiles?.length || 0), 0);
  const missingItemContext = state.records.filter((record) => !(record.contextFiles || []).length).length;
  el.derivedItemStatus.textContent = state.records.length
    ? `${state.records.length} labeling items / ${attachedCount} per-item context files`
    : "No derived item transform applied.";
  el.itemContextStatus.textContent = attachedCount
    ? `${attachedCount} per-item context files attached${missingItemContext ? ` / ${missingItemContext} items without files` : ""}.`
    : "Use placeholders from record fields, such as {instance_id} or {reference_review_comments.__stage3_comment_index}.";
}

function parseArrayFieldValue(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 1) return [];
  const parsed = [];
  for (const line of lines) {
    if (!looksLikeJson(line)) return [];
    try {
      parsed.push(JSON.parse(line));
    } catch {
      return [];
    }
  }
  return parsed;
}

function splitRecordsBySelectedArrayField() {
  if (!getPermissions().canEditProject) return;
  const field = el.splitArrayField.value;
  if (!field) return;
  const derived = [];
  let splitParents = 0;
  state.records.forEach((record) => {
    const items = parseArrayFieldValue(record.data[field]);
    if (!items.length) {
      derived.push(record);
      return;
    }
    splitParents += 1;
    items.forEach((item, index) => {
      const childData = isPlainObject(item) ? flattenObject(item) : { value: item };
      const data = { ...record.data };
      delete data[field];
      data.source_record_id = record.id;
      data.source_record_index = String(record.sourceIndex ?? "");
      data.item_index = String(index);
      Object.entries(childData).forEach(([key, value]) => {
        data[`${field}.${key}`] = value;
      });
      const childIndex = childData.__stage3_comment_index ?? childData.comment_index ?? childData.index ?? index;
      data.comment_index = String(childIndex);
      data[`${field}.__index`] = String(index);
      derived.push({
        id: `${record.id}::${field}[${childIndex}]`,
        data,
        sourceIndex: record.sourceIndex,
        contextFiles: record.contextFiles || []
      });
    });
  });

  if (!splitParents) {
    alert(`No array-like values found in ${field}.`);
    return;
  }
  state.records = derived;
  state.detectedFormat = `${state.detectedFormat || "Data"} / split ${field}`;
  state.fields = inferFields(state.records);
  if (getAllFields(state.records).includes(`${field}.text`)) {
    state.fields.body = `${field}.text`;
  }
  if (getAllFields(state.records).includes(`${field}.diff_hunk`)) {
    state.fields.code = `${field}.diff_hunk`;
  }
  state.protocol.contextFields = recommendedContextFields();
  state.sampling.sampledItemIds = buildSampledItemIds(state.records, state.sampling);
  state.sampling.appliedAt = new Date().toISOString();
  state.annotations = {};
  state.resolutions = {};
  state.drafts = { annotations: {}, resolutions: {} };
  state.currentItemId = state.records[0]?.id || null;
  state.metadata.updatedAt = new Date().toISOString();
  rebuildAssignments();
  persistAndRender(["data", "workspace", "stats", "exports"]);
}

async function attachPerItemServerContext() {
  if (!getPermissions().canEditProject) return;
  if (!activeProjectId) {
    alert("Create or load a server project before attaching server context.");
    return;
  }
  const template = el.itemContextTemplate.value.trim();
  if (!template) {
    alert("Enter a server path template.");
    return;
  }
  const title = el.itemContextTitle.value.trim() || "Per-item context";
  const patterns = state.records.map((record) => ({
    itemId: record.id,
    path: resolveRecordTemplate(template, record)
  })).filter((entry) => entry.path && !entry.path.includes("{}"));

  if (!patterns.length) {
    alert("The template did not resolve to any paths.");
    return;
  }

  el.itemContextStatus.textContent = `Resolving ${patterns.length} server file patterns...`;
  try {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/server-files/resolve`, {
      method: "POST",
      body: { patterns, maxMatchesPerPattern: 5 }
    });
    const byId = new Map(state.records.map((record) => [record.id, record]));
    let attached = 0;
    let missing = 0;
    (result.matches || []).forEach((match) => {
      const record = byId.get(match.itemId);
      const files = match.files || [];
      if (!record || !files.length) {
        missing += 1;
        return;
      }
      record.contextFiles ||= [];
      files.forEach((file) => {
        const contextId = `item_ctx_${slugify(file.path || file.name)}`;
        const existing = record.contextFiles.find((context) => context.path === file.path);
        const next = {
          id: contextId,
          title,
          name: file.name,
          path: file.path,
          size: file.size,
          text: file.text,
          source: "server-template",
          addedAt: new Date().toISOString()
        };
        if (existing) {
          Object.assign(existing, next);
        } else {
          record.contextFiles.push(next);
        }
        attached += 1;
      });
    });
    missing += (result.errors || []).length;
    state.protocol.includeItemContext = true;
    state.metadata.updatedAt = new Date().toISOString();
    el.itemContextStatus.textContent = `${attached} files attached / ${missing} items missing or errored.`;
    persistAndRender(["data", "workspace", "exports"]);
  } catch (error) {
    el.itemContextStatus.textContent = error.message;
  }
}

function resolveRecordTemplate(template, record) {
  return template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const name = String(key || "").trim();
    if (name === "id") return record.id;
    return record.data[name] ?? "";
  });
}

function renderSampling() {
  const activeRecords = getWorkRecords();
  el.samplingMode.value = state.sampling.mode;
  el.samplingPercent.value = state.sampling.percent;
  el.samplingCount.value = state.sampling.count;
  el.sampleConfidence.value = state.sampling.confidenceLevel;
  el.sampleMargin.value = state.sampling.marginOfError;
  el.sampleProportion.value = state.sampling.populationProportion;
  el.samplingStatus.textContent = state.records.length
    ? `${activeRecords.length} of ${state.records.length} entries selected`
    : "Import data before sampling";
  updateSamplingControls();
  renderSampleSizeSuggestion();
  renderSamplingWarnings();
}

function updateSamplingControls() {
  const mode = el.samplingMode.value;
  el.samplingPercentField.classList.toggle("hidden", mode !== "percent");
  el.samplingCountField.classList.toggle("hidden", mode !== "count");
}

function renderSampleSizeSuggestion() {
  el.suggestedSampleSize.textContent = String(calculateSuggestedSampleSize());
}

function calculateSuggestedSampleSize() {
  const values = getSamplingFormValues();
  const population = state.records.length;
  if (!population) return 0;
  const zScores = { 90: 1.645, 95: 1.96, 99: 2.576 };
  const z = zScores[values.confidenceLevel] || 1.96;
  const margin = Math.max(0.001, values.marginOfError / 100);
  const p = Math.min(0.99, Math.max(0.01, values.populationProportion / 100));
  const n0 = (z ** 2 * p * (1 - p)) / (margin ** 2);
  const adjusted = n0 / (1 + ((n0 - 1) / population));
  return Math.min(population, Math.ceil(adjusted));
}

function getSamplingFormValues() {
  return {
    mode: el.samplingMode?.value || state.sampling.mode,
    percent: Number(el.samplingPercent?.value),
    count: Number(el.samplingCount?.value),
    confidenceLevel: Number(el.sampleConfidence?.value) || state.sampling.confidenceLevel,
    marginOfError: Number(el.sampleMargin?.value),
    populationProportion: Number(el.sampleProportion?.value)
  };
}

function renderSamplingWarnings() {
  const values = getSamplingFormValues();
  const warnings = [];
  const population = state.records.length;

  if (!population) {
    warnings.push("Import a data file before applying sampling.");
  }
  if (values.mode === "percent" && (!Number.isFinite(values.percent) || values.percent <= 0 || values.percent > 100)) {
    warnings.push("Percent must be between 1 and 100 for the loaded data.");
  }
  if (values.mode === "count" && (!Number.isFinite(values.count) || values.count < 1 || values.count > population)) {
    warnings.push(`Count must be between 1 and ${Math.max(population, 1)} for the loaded data.`);
  }
  if (!Number.isFinite(values.marginOfError) || values.marginOfError <= 0 || values.marginOfError > 50) {
    warnings.push("Margin of error must be greater than 0 and at most 50%.");
  }
  if (!Number.isFinite(values.populationProportion) || values.populationProportion <= 0 || values.populationProportion >= 100) {
    warnings.push("Population proportion must be between 1% and 99%.");
  }

  el.samplingWarnings.innerHTML = warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("");
  el.applySampling.disabled = warnings.length > 0;
  el.useSuggestedSample.disabled = !population || warnings.some((warning) => !warning.startsWith("Percent") && !warning.startsWith("Count"));
}

function useSuggestedSampleSize() {
  if (!getPermissions().canEditProject) return;
  const suggested = calculateSuggestedSampleSize();
  if (!suggested) return;
  el.samplingMode.value = suggested >= state.records.length ? "all" : "count";
  el.samplingCount.value = String(suggested);
  updateSamplingControls();
  applySamplingPlan();
}

function applySamplingPlan() {
  if (!getPermissions().canEditProject) return;
  renderSamplingWarnings();
  if (el.applySampling.disabled) return;
  const values = getSamplingFormValues();
  state.sampling.mode = values.mode;
  state.sampling.percent = values.percent;
  state.sampling.count = values.count;
  state.sampling.confidenceLevel = values.confidenceLevel;
  state.sampling.marginOfError = values.marginOfError;
  state.sampling.populationProportion = values.populationProportion;
  state.sampling.sampledItemIds = buildSampledItemIds(state.records, state.sampling);
  state.sampling.appliedAt = new Date().toISOString();
  state.currentItemId = null;
  state.metadata.updatedAt = state.sampling.appliedAt;
  rebuildAssignments();
  persistAndRender();
}

function renderContextFieldSelector(fields) {
  el.contextFieldList.innerHTML = "";
  if (!fields.length) {
    el.contextFieldList.innerHTML = "<div class=\"muted\">Import data to select labeler-visible fields.</div>";
    renderContextSample();
    renderQuestionPreview();
    return;
  }

  if (hasItemContextFiles()) {
    const label = document.createElement("label");
    label.className = "field-check-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.protocol.includeItemContext !== false;
    checkbox.addEventListener("change", () => {
      if (!getPermissions().canEditProject) return;
      state.protocol.includeItemContext = checkbox.checked;
      state.metadata.updatedAt = new Date().toISOString();
      persistAndRender(["data", "protocol", "workspace", "exports"]);
    });
    const text = document.createElement("span");
    const count = countItemContextFiles();
    text.innerHTML = `<strong>Item context files</strong><span class="muted">${count} attached files, shown with matching records</span>`;
    label.append(checkbox, text);
    el.contextFieldList.appendChild(label);
  }

  fields.forEach((field) => {
    const label = document.createElement("label");
    label.className = "field-check-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.protocol.contextFields.includes(field);
    checkbox.addEventListener("change", () => {
      if (!getPermissions().canEditProject) return;
      if (checkbox.checked) {
        state.protocol.contextFields = [...new Set([...state.protocol.contextFields, field])];
      } else {
        state.protocol.contextFields = state.protocol.contextFields.filter((item) => item !== field);
      }
      state.metadata.updatedAt = new Date().toISOString();
      persistAndRender(["data", "protocol", "workspace", "exports"]);
    });

    const sampleValue = state.records[0]?.data[field] || "";
    const text = document.createElement("span");
    text.innerHTML = `<strong>${escapeHtml(field)}</strong><span class="muted">${escapeHtml(truncate(sampleValue, 90) || "Empty in first sample")}</span>`;
    label.append(checkbox, text);
    el.contextFieldList.appendChild(label);
  });
  renderContextSample();
  renderQuestionPreview();
}

function renderContextSample() {
  const record = state.records[0];
  const selected = getContextFields();
  el.contextSample.innerHTML = "";
  if (!record || (!selected.length && !shouldShowItemContext(record))) {
    el.contextSample.innerHTML = "<div class=\"muted\">Select fields to preview the labeler context.</div>";
    return;
  }

  selected.forEach((field) => {
    const canEdit = getPermissions().canEditProject;
    const block = document.createElement("div");
    block.className = "sample-field";
    block.draggable = canEdit;
    block.dataset.field = field;
    block.innerHTML = `
      <span class="drag-handle" aria-hidden="true" title="Drag to reorder">::</span>
      <span class="sample-field-content">
        <strong>${escapeHtml(field)}</strong>
        <span>${escapeHtml(truncate(record.data[field] || "", 320))}</span>
      </span>
      <span class="sample-field-actions">
        <button class="secondary mini-move move-up" type="button" title="Move up">Up</button>
        <button class="secondary mini-move move-down" type="button" title="Move down">Down</button>
      </span>
    `;
    block.querySelector(".move-up").addEventListener("click", () => moveContextField(field, -1));
    block.querySelector(".move-down").addEventListener("click", () => moveContextField(field, 1));
    block.addEventListener("dragstart", () => {
      if (!getPermissions().canEditProject) return;
      draggedContextField = field;
      block.classList.add("dragging");
    });
    block.addEventListener("dragend", () => {
      draggedContextField = "";
      block.classList.remove("dragging");
    });
    block.addEventListener("dragover", (event) => {
      if (!getPermissions().canEditProject) return;
      event.preventDefault();
    });
    block.addEventListener("drop", (event) => {
      if (!getPermissions().canEditProject) return;
      event.preventDefault();
      reorderContextField(draggedContextField, field);
    });
    el.contextSample.appendChild(block);
  });

  if (shouldShowItemContext(record)) {
    const block = document.createElement("div");
    block.className = "sample-field item-context-sample";
    block.innerHTML = `
      <span class="drag-handle muted-disabled" aria-hidden="true">ctx</span>
      <span class="sample-field-content">
        <strong>Item context files</strong>
        <span>${escapeHtml(describeItemContext(record))}</span>
      </span>
    `;
    el.contextSample.appendChild(block);
  }
}

function renderQuestionPreview() {
  const record = state.records[0];
  el.questionPreview.innerHTML = "";
  if (!record) {
    el.questionPreview.innerHTML = "<div class=\"muted\">Import data to preview the workspace question.</div>";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "question-preview-card";
  const labels = state.protocol.labels || [];
  wrapper.innerHTML = `
    <div class="record-header preview-record-header">
      <span class="eyebrow">Workspace preview</span>
      <h3>${escapeHtml(getRecordTitle(record))}</h3>
    </div>
    <div class="record-body preview-record-body"></div>
    <div class="annotation-box preview-annotation">
      <h4>${escapeHtml(state.protocol.primaryQuestion || "Select the best label.")}</h4>
      ${state.protocol.instructions ? `<div class="instruction-text">${escapeHtml(state.protocol.instructions)}</div>` : ""}
      <div class="choice-grid">
        ${labels.map((label) => `<button type="button" disabled>${escapeHtml(label)}</button>`).join("")}
      </div>
    </div>
  `;
  const body = wrapper.querySelector(".preview-record-body");
  appendContextBlocks(body, record, { truncateFields: 700, truncateContext: 900 });
  el.questionPreview.appendChild(wrapper);
}

function appendContextBlocks(container, record, options = {}) {
  if (state.contextFiles.length) {
    const block = document.createElement("div");
    block.className = "record-field";
    block.innerHTML = "<strong>Project context files</strong>";
    state.contextFiles.forEach((file) => {
      const item = document.createElement("div");
      item.className = "sample-field";
      item.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(truncate(file.text || "", options.truncateContext || 900))}</span>`;
      block.appendChild(item);
    });
    container.appendChild(block);
  }

  if (shouldShowItemContext(record)) {
    const block = document.createElement("div");
    block.className = "record-field";
    block.innerHTML = "<strong>Item context files</strong>";
    (record.contextFiles || []).forEach((file) => {
      const item = document.createElement("div");
      item.className = "item-context-file";
      const pre = document.createElement("pre");
      pre.textContent = options.truncateContext ? truncate(file.text || "", options.truncateContext) : file.text || "";
      item.innerHTML = `<strong>${escapeHtml(file.title || file.name || "Context file")}</strong><span class="muted">${escapeHtml(file.path || file.name || "")}</span>`;
      item.appendChild(pre);
      block.appendChild(item);
    });
    container.appendChild(block);
  }

  getDisplayFields(record).forEach(([key, value]) => {
    const block = document.createElement("div");
    block.className = "record-field";
    const isCode = key === state.fields.code || looksLikeCode(value);
    block.innerHTML = `<strong>${escapeHtml(key)}</strong>`;
    if (isCode) {
      const pre = document.createElement("pre");
      pre.textContent = options.truncateFields ? truncate(value, options.truncateFields) : value;
      block.appendChild(pre);
    } else {
      const text = document.createElement("div");
      text.className = "field-text";
      text.textContent = options.truncateFields ? truncate(value, options.truncateFields) : value;
      block.appendChild(text);
    }
    container.appendChild(block);
  });
}

function reorderContextField(fromField, toField) {
  if (!getPermissions().canEditProject) return;
  if (!fromField || !toField || fromField === toField) return;
  const ordered = getContextFields();
  const fromIndex = ordered.indexOf(fromField);
  const toIndex = ordered.indexOf(toField);
  if (fromIndex === -1 || toIndex === -1) return;
  ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, fromField);
  state.protocol.contextFields = ordered;
  state.metadata.updatedAt = new Date().toISOString();
  persistAndRender(["data", "protocol", "workspace", "exports"]);
}

function moveContextField(field, delta) {
  if (!getPermissions().canEditProject) return;
  const ordered = getContextFields();
  const index = ordered.indexOf(field);
  if (index === -1) return;
  const nextIndex = Math.max(0, Math.min(ordered.length - 1, index + delta));
  if (index === nextIndex) return;
  ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, field);
  state.protocol.contextFields = ordered;
  state.metadata.updatedAt = new Date().toISOString();
  persistAndRender(["data", "protocol", "workspace", "exports"]);
}

function hasItemContextFiles() {
  return state.records.some((record) => (record.contextFiles || []).length);
}

function countItemContextFiles() {
  return state.records.reduce((sum, record) => sum + (record.contextFiles?.length || 0), 0);
}

function shouldShowItemContext(record) {
  return state.protocol.includeItemContext !== false && Boolean(record?.contextFiles?.length);
}

function describeItemContext(record) {
  const files = record.contextFiles || [];
  if (!files.length) return "No files attached to this sample item.";
  return files.map((file) => `${file.title || file.name}: ${file.path || file.name}`).join("\n");
}

function renderFieldMapping(fields) {
  const mappings = [
    ["id", "Identifier"],
    ["title", "Title"],
    ["body", "Primary text"],
    ["code", "Code or diff"]
  ];
  el.fieldMapping.innerHTML = "";
  mappings.forEach(([key, label]) => {
    const wrapper = document.createElement("label");
    wrapper.innerHTML = `<span>${label}</span>`;
    const select = document.createElement("select");
    select.dataset.fieldKey = key;
    select.appendChild(new Option("None", ""));
    fields.forEach((field) => select.appendChild(new Option(field, field)));
    select.value = state.fields[key] || "";
    select.addEventListener("change", () => {
      if (!getPermissions().canEditProject) {
        select.value = state.fields[key] || "";
        return;
      }
      state.fields[key] = select.value;
      persistAndRender(["data", "workspace"]);
    });
    wrapper.appendChild(select);
    el.fieldMapping.appendChild(wrapper);
  });
}

function renderQuality(fields) {
  const duplicateIds = countDuplicateIds();
  const emptyRows = state.records.filter((record) => Object.values(record.data).every((value) => !String(value).trim())).length;
  const checks = [
    {
      level: state.records.length ? "good" : "warn",
      title: "Records loaded",
      detail: state.records.length ? `${state.records.length} items are ready for assignment.` : "Import or restore a dataset."
    },
    {
      level: duplicateIds ? "bad" : "good",
      title: "Identifier uniqueness",
      detail: duplicateIds ? `${duplicateIds} duplicate item identifiers detected.` : "Each item has a stable identifier."
    },
    {
      level: fields.length ? "good" : "warn",
      title: "Structured fields",
      detail: fields.length ? `${fields.length} fields are available for mapping.` : "No fields detected yet."
    },
    {
      level: emptyRows ? "warn" : "good",
      title: "Empty records",
      detail: emptyRows ? `${emptyRows} records have no visible values.` : "No fully empty records found."
    }
  ];

  el.qualityList.innerHTML = "";
  checks.forEach((check) => {
    const item = document.createElement("div");
    item.className = "quality-item";
    item.innerHTML = `
      <span class="quality-dot ${check.level}"></span>
      <span><strong>${escapeHtml(check.title)}</strong><span class="muted">${escapeHtml(check.detail)}</span></span>
    `;
    el.qualityList.appendChild(item);
  });
}

function countDuplicateIds() {
  const counts = new Map();
  state.records.forEach((record) => counts.set(record.id, (counts.get(record.id) || 0) + 1));
  return [...counts.values()].filter((count) => count > 1).length;
}

function renderPreview(fields) {
  const previewFields = fields.slice(0, 8);
  const rows = state.records.slice(0, 8);
  el.previewMeta.textContent = rows.length ? `Showing ${rows.length} of ${state.records.length}` : "";
  el.previewTable.innerHTML = "";

  if (!rows.length) {
    el.previewTable.innerHTML = "<tbody><tr><td class=\"muted\">No records imported.</td></tr></tbody>";
    return;
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  previewFields.forEach((field) => {
    const th = document.createElement("th");
    th.textContent = field;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  el.previewTable.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((record) => {
    const row = document.createElement("tr");
    previewFields.forEach((field) => {
      const td = document.createElement("td");
      td.textContent = truncate(record.data[field] || "", 160);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  el.previewTable.appendChild(tbody);
}

function renderProtocol() {
  el.primaryQuestion.value = state.protocol.primaryQuestion;
  renderLabelEditor();
  el.protocolInstructions.value = state.protocol.instructions || "";
  el.labelersPerItem.value = state.protocol.labelersPerItem;
  el.labelCardinality.value = state.protocol.labelCardinality || "single";
  el.resolutionPolicy.value = state.protocol.resolutionPolicy;
  el.requireConfidence.checked = state.protocol.requireConfidence;
  el.allowCustomLabels.checked = Boolean(state.protocol.allowCustomLabels);
  el.enableUncertain.checked = Boolean(state.protocol.enableUncertain);
  el.requireNotes.checked = state.protocol.requireNotes;
  el.uncertainLabel.value = state.protocol.uncertainLabel;
  el.resolutionQuestion.value = state.protocol.resolutionQuestion;
  renderUncertainControls();
  el.protocolStatusLine.textContent = `${state.protocol.labels.length} labels / ${state.protocol.labelCardinality === "multiple" ? "multiple per answer" : "single per answer"} / ${state.protocol.labelersPerItem} labelers per item / ${getContextFields().length} context fields / item context ${state.protocol.includeItemContext !== false ? "on" : "off"} / custom labels ${state.protocol.allowCustomLabels ? "on" : "off"} / uncertain ${state.protocol.enableUncertain ? "on" : "off"} / ${state.protocol.resolutionPolicy}`;
  renderProtocolSnapshot();
}

function renderProtocolSnapshot() {
  el.protocolSnapshot.textContent = JSON.stringify({
    protocol: state.protocol,
    sampling: {
      ...state.sampling,
      selectedCount: getWorkRecords().length,
      populationCount: state.records.length
    }
  }, null, 2);
}

function renderUncertainControls() {
  const canEdit = getPermissions().canEditProject;
  const enabled = el.enableUncertain.checked;
  el.requireNotes.disabled = !canEdit || !enabled;
  el.uncertainLabel.disabled = !canEdit || !enabled;
  el.uncertainLabelRow.classList.toggle("muted-disabled", !canEdit || !enabled);
}

function applyProtocolFromForm() {
  if (!getPermissions().canEditProject) return;
  const labels = [...el.labelList.querySelectorAll(".label-name-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);

  if (!labels.length) {
    alert("Add at least one label.");
    return;
  }

  state.protocol = {
    primaryQuestion: el.primaryQuestion.value.trim() || "Select the best label.",
    labels,
    instructions: el.protocolInstructions.value.trim(),
    labelersPerItem: Math.max(1, Number(el.labelersPerItem.value) || 1),
    labelCardinality: ["single", "multiple"].includes(el.labelCardinality.value) ? el.labelCardinality.value : "single",
    resolutionPolicy: el.resolutionPolicy.value,
    requireConfidence: el.requireConfidence.checked,
    allowCustomLabels: el.allowCustomLabels.checked,
    enableUncertain: el.enableUncertain.checked,
    requireNotes: el.enableUncertain.checked && el.requireNotes.checked,
    uncertainLabel: el.enableUncertain.checked ? (el.uncertainLabel.value.trim() || "Unclear") : "",
    resolutionQuestion: el.resolutionQuestion.value.trim() || "What final label should be assigned?",
    contextFields: state.protocol.contextFields.filter((field) => getAllFields().includes(field)),
    includeItemContext: state.protocol.includeItemContext !== false
  };
  state.metadata.updatedAt = new Date().toISOString();
  rebuildAssignments();
  persistAndRender();
}

function renderLabelEditor() {
  el.labelList.innerHTML = "";
  state.protocol.labels.forEach((label, index) => {
    const row = document.createElement("div");
    row.className = "label-editor-row";

    const swatch = document.createElement("span");
    swatch.className = "label-swatch";
    swatch.style.background = labelColors[index % labelColors.length];

    const input = document.createElement("input");
    input.className = "label-name-input";
    input.value = label;
    input.setAttribute("aria-label", `Label ${index + 1}`);
    input.addEventListener("input", () => {
      if (!getPermissions().canEditProject) {
        input.value = state.protocol.labels[index] || "";
        return;
      }
      state.protocol.labels[index] = input.value;
      schedulePersist();
      renderProtocolSnapshot();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary icon-button";
    remove.textContent = "x";
    remove.title = `Remove ${label}`;
    remove.disabled = state.protocol.labels.length <= 1;
    remove.addEventListener("click", () => {
      if (!getPermissions().canEditProject) return;
      state.protocol.labels.splice(index, 1);
      persistAndRender(["protocol", "workspace", "stats", "exports"]);
    });

    row.append(swatch, input, remove);
    el.labelList.appendChild(row);
  });
}

function addProtocolLabel() {
  if (!getPermissions().canEditProject) return;
  const label = el.newLabelName.value.trim();
  if (!label) return;
  state.protocol.labels.push(label);
  el.newLabelName.value = "";
  persistAndRender(["protocol", "workspace", "stats", "exports"]);
}

function renderPeople() {
  el.userList.innerHTML = "";
  const admins = state.users.filter((user) => userHasRole(user, "admin")).length;
  const labelers = state.users.filter((user) => userHasRole(user, "labeler")).length;
  const resolvers = state.users.filter((user) => userHasRole(user, "resolver")).length;
  el.peopleStatusLine.textContent = `${admins} admins / ${labelers} labelers / ${resolvers} resolvers / ${state.assignments.length} assignments`;
  state.users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "user-row";

    const summary = document.createElement("div");
    const roles = getUserRoles(user);
    const assigned = state.assignments.filter((assignment) => assignment.userId === user.id && roles.includes(assignment.role)).length;
    const completed = countCompletedByUser(user);
    const nameInput = document.createElement("input");
    nameInput.className = "user-name-input";
    nameInput.value = user.participantName || user.name;
    nameInput.setAttribute("aria-label", `Participant name for ${user.id}`);
    nameInput.addEventListener("change", () => {
      if (!getPermissions().canEditProject) {
        nameInput.value = user.participantName || user.name;
        return;
      }
      user.participantName = nameInput.value.trim() || user.id;
      user.name = user.participantName;
      state.metadata.updatedAt = new Date().toISOString();
      updateProjectMember(user);
    });
    const status = document.createElement("div");
    status.className = "muted";
    status.textContent = `participant: ${user.participantName || user.name} / ${user.username ? `account: ${user.username} / ` : ""}${user.id} / roles: ${roles.join(", ")} / ${completed}/${assigned} completed`;
    summary.append(nameInput, status);

    const roleGroup = document.createElement("div");
    roleGroup.className = "role-checks";
    ["admin", "labeler", "resolver"].forEach((roleName) => {
      const label = document.createElement("label");
      label.className = "mini-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = roles.includes(roleName);
      checkbox.addEventListener("change", () => {
        if (!getPermissions().canEditProject) {
          checkbox.checked = getUserRoles(user).includes(roleName);
          return;
        }
        const nextRoles = new Set(getUserRoles(user));
        if (checkbox.checked) {
          nextRoles.add(roleName);
        } else {
          nextRoles.delete(roleName);
        }
        const normalizedRoles = normalizeRoles([...nextRoles]);
        if (!normalizedRoles.length) {
          alert("Select at least one role.");
          checkbox.checked = true;
          return;
        }
        if (roles.includes("admin") && !normalizedRoles.includes("admin") && state.users.filter((participant) => userHasRole(participant, "admin")).length <= 1) {
          alert("Keep at least one admin for project setup and exports.");
          checkbox.checked = true;
          return;
        }
        user.roles = normalizedRoles;
        user.role = normalizedRoles[0];
        rebuildAssignments();
        updateProjectMember(user);
      });
      label.append(checkbox, document.createTextNode(roleName));
      roleGroup.appendChild(label);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary icon-button";
    remove.textContent = "x";
    remove.title = `Remove ${user.name}`;
    remove.addEventListener("click", () => removeUser(user.id));

    row.append(summary, roleGroup, remove);
    el.userList.appendChild(row);
  });
}

async function addUser() {
  if (!getPermissions().canEditProject) return;
  const username = el.newUserName.value.trim();
  const participantName = el.newParticipantName.value.trim() || username;
  if (!username) {
    alert("Enter a unique user name.");
    return;
  }
  if (!activeProjectId) {
    alert("Create or load a server project first.");
    return;
  }
  try {
    await flushServerSave();
    const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/members`, {
      method: "POST",
      body: {
        username,
        participantName,
        roles: [el.newUserRole.value]
      }
    });
    applyServerProject(result);
    el.newUserName.value = "";
    el.newParticipantName.value = "";
    rebuildAssignments();
    persistAndRender();
  } catch (error) {
    alert(error.message);
  }
}

async function updateProjectMember(user) {
  if (!activeProjectId) {
    persistAndRender();
    return;
  }
  try {
    await flushServerSave();
    const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/members/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        participantName: user.participantName || user.name || user.id,
        roles: getUserRoles(user)
      }
    });
    applyServerProject(result);
    rebuildAssignments();
    persistAndRender();
  } catch (error) {
    alert(error.message);
    await loadProjectFromServer(activeProjectId);
  }
}

async function removeUser(userId) {
  if (!getPermissions().canEditProject) return;
  if (state.users.length <= 1) {
    alert("Keep at least one person in the roster.");
    return;
  }
  const target = state.users.find((user) => user.id === userId);
  if (target && userHasRole(target, "admin") && state.users.filter((user) => userHasRole(user, "admin")).length <= 1) {
    alert("Keep at least one admin for project setup and exports.");
    return;
  }
  if (auth?.user?.id === userId) {
    alert("Admins cannot remove their own account from the project.");
    return;
  }
  if (activeProjectId) {
    try {
      await flushServerSave();
      const result = await apiRequest(`/api/projects/${encodeURIComponent(activeProjectId)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE"
      });
      applyServerProject(result);
    } catch (error) {
      alert(error.message);
      return;
    }
  }
  state.users = state.users.filter((user) => user.id !== userId);
  state.assignments = state.assignments.filter((assignment) => assignment.userId !== userId);
  Object.keys(state.annotations).forEach((itemId) => {
    delete state.annotations[itemId][userId];
  });
  Object.keys(state.drafts.annotations).forEach((itemId) => {
    delete state.drafts.annotations[itemId][userId];
  });
  Object.keys(state.drafts.resolutions).forEach((itemId) => {
    delete state.drafts.resolutions[itemId][userId];
  });
  Object.keys(state.resolutions).forEach((itemId) => {
    if (state.resolutions[itemId].resolverId === userId) {
      delete state.resolutions[itemId];
    }
  });
  if (state.currentUserId === userId) {
    state.currentUserId = state.users[0]?.id || "";
  }
  rebuildAssignments();
  persistAndRender();
}

function countCompletedByUser(user) {
  if (user.role === "labeler" || userHasRole(user, "labeler")) {
    return getWorkRecords().filter((record) => decisionValues(state.annotations[record.id]?.[user.id]).length).length;
  }
  if (user.role !== "resolver" && !userHasRole(user, "resolver")) return 0;
  return getWorkRecords().filter((record) => state.resolutions[record.id]?.resolverId === user.id && decisionValues(state.resolutions[record.id]).length).length;
}

function renderWorkspace() {
  const currentUser = getCurrentUser();
  if (!getPermissions(currentUser).canUseWorkspace) {
    el.queueMode.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.queueMode);
    });
    el.queueSearch.value = state.queueSearch || "";
    el.queueSummary.textContent = currentUser
      ? `${currentUser.name} / ${currentUser.role} / workspace unavailable`
      : "No participant selected.";
    el.queueCount.textContent = "0 items";
    el.queueList.innerHTML = "<div class=\"muted\">Admin creates projects and reviews statistics. This role does not label or resolve items.</div>";
    el.emptyReview.textContent = "Admin does not participate in labeling or resolution.";
    el.emptyReview.classList.remove("hidden");
    el.reviewContent.classList.add("hidden");
    return;
  }
  const queue = getVisibleQueue(currentUser);
  const currentRecord = getCurrentRecord(queue);

  el.queueMode.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.queueMode);
  });
  el.queueSearch.value = state.queueSearch || "";
  el.queueSummary.textContent = currentUser
    ? `${currentUser.name} / ${currentUser.role} / ${queue.length} visible items`
    : "No participant selected.";
  el.queueCount.textContent = `${queue.length} items`;
  renderQueue(queue);

  if (!currentRecord) {
    el.emptyReview.textContent = "No assigned work matches this queue.";
    el.emptyReview.classList.remove("hidden");
    el.reviewContent.classList.add("hidden");
    return;
  }

  el.emptyReview.classList.add("hidden");
  el.reviewContent.classList.remove("hidden");
  renderRecord(currentRecord, queue);
  renderAnnotationControls(currentRecord, currentUser);
}

function getCurrentUser() {
  const membership = getCurrentMembership() || state.users[0] || null;
  if (!membership) return null;
  const roles = getUserRoles(membership);
  const activeRole = roles.includes(state.activeRole) ? state.activeRole : roles[0] || membership.role || "labeler";
  return {
    ...membership,
    role: activeRole,
    roles
  };
}

function getCurrentMembership() {
  const currentId = auth?.user?.id || state.currentUserId;
  return state.users.find((user) => user.id === currentId) || null;
}

function getVisibleQueue(user) {
  if (!user) return [];
  if (!getPermissions(user).canUseWorkspace) return [];
  const search = (state.queueSearch || "").toLowerCase();
  const assignedIds = new Set(
    state.assignments
      .filter((assignment) => assignment.userId === user.id && assignment.role === user.role)
      .map((assignment) => assignment.itemId)
  );

  return getWorkRecords().filter((record) => {
    if (!assignedIds.has(record.id)) return false;
    if (user.role === "resolver" && !shouldResolverSee(record.id)) return false;
    const done = user.role === "labeler"
      ? Boolean(decisionValues(state.annotations[record.id]?.[user.id]).length)
      : Boolean(decisionValues(state.resolutions[record.id]).length);
    if (state.queueMode === "todo" && done) return false;
    if (state.queueMode === "done" && !done) return false;
    if (search && !recordSearchText(record).includes(search)) return false;
    return true;
  });
}

function shouldResolverSee(itemId) {
  if (state.protocol.resolutionPolicy === "manual") return false;
  const labels = getItemLabels(itemId);
  if (labels.length < 2) return false;
  if (state.protocol.resolutionPolicy === "all") return true;
  return new Set(labels.map((label) => labelSetKey(label.values))).size > 1;
}

function getCurrentRecord(queue) {
  if (!queue.length) return null;
  const existing = queue.find((record) => record.id === state.currentItemId);
  if (existing) return existing;
  state.currentItemId = queue[0].id;
  return queue[0];
}

function renderQueue(queue) {
  el.queueList.innerHTML = "";
  if (!queue.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No items match this queue.";
    el.queueList.appendChild(empty);
    return;
  }

  queue.forEach((record) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `queue-item ${record.id === state.currentItemId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(getRecordTitle(record))}</strong>
      <span class="status-line">${queueStatus(record.id).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</span>
    `;
    button.addEventListener("click", () => {
      state.currentItemId = record.id;
      renderWorkspace();
      schedulePersist();
    });
    el.queueList.appendChild(button);
  });
}

function queueStatus(itemId) {
  const labels = getItemLabels(itemId);
  const resolution = state.resolutions[itemId];
  const parts = [`${labels.length} labels`];
  if (labels.length >= 2) {
    parts.push(new Set(labels.map((label) => labelSetKey(label.values))).size === 1 ? "agree" : "disagree");
  }
  if (decisionValues(resolution).length) {
    parts.push("resolved");
  }
  return parts;
}

function renderRecord(record, queue) {
  const position = queue.findIndex((item) => item.id === record.id) + 1;
  el.recordPosition.textContent = `Item ${position} of ${queue.length}`;
  el.recordTitle.textContent = getRecordTitle(record);
  el.recordMeta.innerHTML = "";
  getMetaFields(record).forEach(([key, value]) => {
    const chip = document.createElement("span");
    chip.className = "meta-chip";
    chip.textContent = `${key}: ${truncate(value, 48)}`;
    el.recordMeta.appendChild(chip);
  });

  el.recordBody.innerHTML = "";
  appendContextBlocks(el.recordBody, record);
}

function renderSharedContextFiles() {
  if (!state.contextFiles.length) return;
  const block = document.createElement("div");
  block.className = "record-field";
  block.innerHTML = "<strong>Project context files</strong>";
  state.contextFiles.forEach((file) => {
    const item = document.createElement("div");
    item.className = "sample-field";
    item.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(truncate(file.text || "", 900))}</span>`;
    block.appendChild(item);
  });
  el.recordBody.appendChild(block);
}

function renderItemContextFiles(record) {
  const files = record.contextFiles || [];
  if (!files.length) return;
  const block = document.createElement("div");
  block.className = "record-field";
  block.innerHTML = "<strong>Item context files</strong>";
  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "item-context-file";
    const pre = document.createElement("pre");
    pre.textContent = file.text || "";
    item.innerHTML = `<strong>${escapeHtml(file.title || file.name || "Context file")}</strong><span class="muted">${escapeHtml(file.path || file.name || "")}</span>`;
    item.appendChild(pre);
    block.appendChild(item);
  });
  el.recordBody.appendChild(block);
}

function renderAnnotationControls(record, user) {
  if (!user || !getPermissions(user).canUseWorkspace) return;
  const isResolver = user.role === "resolver";
  el.labelerControls.classList.toggle("hidden", isResolver);
  el.resolverControls.classList.toggle("hidden", !isResolver);

  if (isResolver) {
    renderResolverControls(record, user);
  } else {
    renderLabelerControls(record, user);
  }
}

function renderLabelerControls(record, user) {
  const existing = getLabelDraft(record.id, user.id) || state.annotations[record.id]?.[user.id] || {};
  selectedLabel = decisionValues(existing);
  el.labelQuestion.textContent = state.protocol.primaryQuestion;
  renderInstruction(el.protocolInstructionText);
  const rerenderChoices = () => renderChoices(el.labelChoices, state.protocol.labels, selectedLabel, (value) => {
    selectedLabel = toggleSelectedLabel(selectedLabel, value);
    saveLabelDraftForCurrent();
    rerenderChoices();
    validateLabelForm();
  });
  rerenderChoices();
  renderCustomLabelControls();
  el.confidenceInput.value = existing.confidence ?? 50;
  el.confidenceValue.textContent = `${el.confidenceInput.value}%`;
  el.labelNotes.value = existing.notes || "";
  validateLabelForm();
}

function renderResolverControls(record, user) {
  const existing = getResolutionDraft(record.id, user.id) || state.resolutions[record.id] || {};
  selectedResolution = decisionValues(existing);
  el.resolutionQuestionText.textContent = state.protocol.resolutionQuestion;
  renderInstruction(el.resolutionInstructionText);
  el.resolutionNotes.value = existing.rationale || "";
  renderAnnotationComparison(record.id);
  const rerenderChoices = () => renderChoices(el.resolutionChoices, state.protocol.labels, selectedResolution, (value) => {
    selectedResolution = toggleSelectedLabel(selectedResolution, value);
    saveResolutionDraftForCurrent();
    rerenderChoices();
    validateResolutionForm();
  });
  rerenderChoices();
  renderCustomLabelControls();
  validateResolutionForm();
}

function renderInstruction(container) {
  const instructions = state.protocol.instructions || "";
  container.textContent = instructions;
  container.classList.toggle("hidden", !instructions);
}

function renderChoices(container, labels, selected, onSelect) {
  container.innerHTML = "";
  const selectedValues = normalizeLabelValues(selected);
  mergeChoiceLabels(labels, selectedValues).forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    const active = selectedValues.some((value) => value.toLowerCase() === label.toLowerCase());
    button.className = `choice-button ${active ? "active" : ""}`;
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.textContent = label;
    button.addEventListener("click", () => onSelect(label));
    container.appendChild(button);
  });
}

function validateLabelForm() {
  const selectedValues = normalizeLabelValues(selectedLabel);
  const isUncertain = state.protocol.enableUncertain && selectedValues.some((value) => value.toLowerCase() === state.protocol.uncertainLabel.toLowerCase());
  const needsNotes = state.protocol.requireNotes && isUncertain && !el.labelNotes.value.trim();
  const needsConfidence = state.protocol.requireConfidence && Number(el.confidenceInput.value) <= 0;
  const missingLabel = !selectedValues.length;
  const message = missingLabel
    ? `Select ${isMultiLabelMode() ? "at least one label" : "a label"}.`
    : needsConfidence
      ? "Confidence is required."
      : needsNotes
        ? "Notes required for uncertain labels."
        : "";
  el.labelValidation.textContent = message;
  el.saveLabel.disabled = Boolean(message);
  el.clearLabel.disabled = !selectedValues.length && !hasCurrentLabelDecision();
}

function validateResolutionForm() {
  const selectedValues = normalizeLabelValues(selectedResolution);
  el.saveResolution.disabled = !selectedValues.length;
  el.clearResolution.disabled = !selectedValues.length && !hasCurrentResolutionDecision();
}

function renderCustomLabelControls() {
  const enabled = Boolean(state.protocol.allowCustomLabels);
  el.customLabelRow.classList.toggle("hidden", !enabled);
  el.customResolutionLabelRow.classList.toggle("hidden", !enabled);
}

function addCustomWorkspaceLabel(role) {
  if (!state.protocol.allowCustomLabels) return;
  const isResolver = role === "resolver";
  const input = isResolver ? el.customResolutionLabelInput : el.customLabelInput;
  const label = input.value.trim();
  if (!label) return;
  const canonical = mergeChoiceLabels(state.protocol.labels, [label]).find((value) => value.toLowerCase() === label.toLowerCase()) || label;
  if (!state.protocol.labels.some((value) => value.toLowerCase() === canonical.toLowerCase())) {
    state.protocol.labels.push(canonical);
  }
  if (isResolver) {
    selectedResolution = toggleSelectedLabel(selectedResolution, canonical);
    saveResolutionDraftForCurrent();
    validateResolutionForm();
  } else {
    selectedLabel = toggleSelectedLabel(selectedLabel, canonical);
    saveLabelDraftForCurrent();
    validateLabelForm();
  }
  input.value = "";
  persistAndRender(["protocol", "workspace", "stats", "exports"]);
}

function renderAnnotationComparison(itemId) {
  const labels = getItemLabels(itemId);
  el.annotationComparison.innerHTML = "";
  if (!labels.length) {
    el.annotationComparison.innerHTML = "<div class=\"muted\">No submitted labels.</div>";
    return;
  }
  labels.forEach((label) => {
    const user = state.users.find((participant) => participant.id === label.userId);
    const card = document.createElement("div");
    card.className = "comparison-card";
    card.innerHTML = `
      <header>
        <strong>${escapeHtml(user?.name || label.userId)}</strong>
        <span class="label-pill">${escapeHtml(formatLabelValues(label.values))}</span>
        <span class="muted">${label.confidence ?? 0}%</span>
      </header>
      <div>${escapeHtml(label.notes || "No notes")}</div>
    `;
    el.annotationComparison.appendChild(card);
  });
}

function saveCurrentLabel() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  const values = normalizeLabelValues(selectedLabel);
  if (!user || user.role !== "labeler" || !record || !values.length) return;
  state.annotations[record.id] ||= {};
  state.annotations[record.id][user.id] = {
    ...decisionPayload(values),
    confidence: Number(el.confidenceInput.value),
    notes: el.labelNotes.value.trim(),
    updatedAt: new Date().toISOString()
  };
  deleteLabelDraft(record.id, user.id);
  advanceAfterSave(user);
}

function clearCurrentLabel() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  if (!user || user.role !== "labeler" || !record) return;
  if (state.annotations[record.id]) {
    delete state.annotations[record.id][user.id];
    if (!Object.keys(state.annotations[record.id]).length) {
      delete state.annotations[record.id];
    }
  }
  deleteLabelDraft(record.id, user.id);
  selectedLabel = [];
  el.labelNotes.value = "";
  state.metadata.updatedAt = new Date().toISOString();
  settleQueueAfterClear(user, record.id);
}

function saveCurrentResolution() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  const values = normalizeLabelValues(selectedResolution);
  if (!user || user.role !== "resolver" || !record || !values.length) return;
  state.resolutions[record.id] = {
    ...decisionPayload(values),
    rationale: el.resolutionNotes.value.trim(),
    resolverId: user.id,
    updatedAt: new Date().toISOString()
  };
  deleteResolutionDraft(record.id, user.id);
  advanceAfterSave(user);
}

function clearCurrentResolution() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  if (!user || user.role !== "resolver" || !record) return;
  delete state.resolutions[record.id];
  deleteResolutionDraft(record.id, user.id);
  selectedResolution = [];
  el.resolutionNotes.value = "";
  state.metadata.updatedAt = new Date().toISOString();
  settleQueueAfterClear(user, record.id);
}

function advanceAfterSave(user) {
  const queueBefore = getVisibleQueue(user);
  const currentIndex = queueBefore.findIndex((record) => record.id === state.currentItemId);
  saveState();
  const queueAfter = getVisibleQueue(user);
  const next = queueAfter[currentIndex] || queueAfter[currentIndex - 1] || queueAfter[0] || null;
  state.currentItemId = next?.id || null;
  saveState();
  renderAll();
}

function settleQueueAfterClear(user, clearedItemId) {
  const queueAfter = getVisibleQueue(user);
  if (!queueAfter.some((record) => record.id === clearedItemId)) {
    state.currentItemId = queueAfter[0]?.id || null;
  }
  persistAndRender(["workspace", "stats", "exports"]);
}

function saveLabelDraftForCurrent() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  if (!user || !record || user.role !== "labeler") return;
  const values = normalizeLabelValues(selectedLabel);
  state.drafts.annotations[record.id] ||= {};
  state.drafts.annotations[record.id][user.id] = {
    ...decisionPayload(values),
    confidence: Number(el.confidenceInput.value),
    notes: el.labelNotes.value.trim(),
    updatedAt: new Date().toISOString()
  };
  schedulePersist();
}

function saveResolutionDraftForCurrent() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  if (!user || !record || user.role !== "resolver") return;
  const values = normalizeLabelValues(selectedResolution);
  state.drafts.resolutions[record.id] ||= {};
  state.drafts.resolutions[record.id][user.id] = {
    ...decisionPayload(values),
    rationale: el.resolutionNotes.value.trim(),
    resolverId: user.id,
    updatedAt: new Date().toISOString()
  };
  schedulePersist();
}

function getLabelDraft(itemId, userId) {
  return state.drafts.annotations[itemId]?.[userId] || null;
}

function getResolutionDraft(itemId, userId) {
  return state.drafts.resolutions[itemId]?.[userId] || null;
}

function hasCurrentLabelDecision() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  if (!user || !record) return false;
  return Boolean(
    decisionValues(state.annotations[record.id]?.[user.id]).length ||
    decisionValues(getLabelDraft(record.id, user.id)).length
  );
}

function hasCurrentResolutionDecision() {
  const user = getCurrentUser();
  const record = state.records.find((item) => item.id === state.currentItemId);
  if (!user || !record) return false;
  return Boolean(
    decisionValues(state.resolutions[record.id]).length ||
    decisionValues(getResolutionDraft(record.id, user.id)).length
  );
}

function deleteLabelDraft(itemId, userId) {
  if (!state.drafts.annotations[itemId]) return;
  delete state.drafts.annotations[itemId][userId];
  if (!Object.keys(state.drafts.annotations[itemId]).length) {
    delete state.drafts.annotations[itemId];
  }
}

function deleteResolutionDraft(itemId, userId) {
  if (!state.drafts.resolutions[itemId]) return;
  delete state.drafts.resolutions[itemId][userId];
  if (!Object.keys(state.drafts.resolutions[itemId]).length) {
    delete state.drafts.resolutions[itemId];
  }
}

function getItemLabels(itemId) {
  return Object.entries(state.annotations[itemId] || {})
    .map(([userId, annotation]) => {
      const values = decisionValues(annotation);
      return {
        userId,
        ...annotation,
        value: annotation.value || formatLabelValues(values, "|"),
        values
      };
    })
    .filter((annotation) => annotation.values.length);
}

function getRecordTitle(record) {
  const value = record.data[state.fields.title] || record.data[state.fields.body] || record.id;
  return truncate(String(value), 120);
}

function getMetaFields(record) {
  const keys = state.fields.meta?.length
    ? state.fields.meta
    : Object.keys(record.data).filter((key) => ![state.fields.title, state.fields.body, state.fields.code].includes(key)).slice(0, 4);
  return keys
    .filter((key) => record.data[key])
    .slice(0, 5)
    .map((key) => [key, record.data[key]]);
}

function getDisplayFields(record) {
  const selectedContext = getContextFields();
  if (selectedContext.length) {
    return selectedContext
      .filter((key) => record.data[key])
      .map((key) => [key, record.data[key]]);
  }

  const priority = [state.fields.body, state.fields.code].filter(Boolean);
  const seen = new Set();
  const fields = [];

  priority.forEach((key) => {
    if (record.data[key] && !seen.has(key)) {
      fields.push([key, record.data[key]]);
      seen.add(key);
    }
  });

  Object.entries(record.data).forEach(([key, value]) => {
    if (!seen.has(key) && value) {
      fields.push([key, value]);
      seen.add(key);
    }
  });

  return fields.slice(0, 14);
}

function recordSearchText(record) {
  return Object.values(record.data).join(" ").toLowerCase();
}

function looksLikeCode(value) {
  const text = String(value);
  return text.includes("@@") || text.includes("\n+") || text.includes("\n-") || /\b(def|class|function|import|return)\b/.test(text);
}

function renderStats() {
  const stats = computeStats();
  el.statsStatusLine.textContent = `${stats.completedLabelAssignments}/${stats.labelAssignments} label assignments / ${stats.exactAgreementRate} exact agreement`;
  el.statsCards.innerHTML = "";
  [
    ["Items", stats.totalItems],
    ["Label completion", `${stats.completedLabelAssignments}/${stats.labelAssignments}`],
    ["Exact agreement", stats.exactAgreementRate],
    ["Needs resolution", stats.needsResolution]
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.innerHTML = `<span class="metric-label">${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    el.statsCards.appendChild(card);
  });

  renderLabelDistribution(stats);
  renderThroughput();
}

function computeStats() {
  const labelAssignments = state.assignments.filter((assignment) => assignment.role === "labeler").length;
  const completedLabelAssignments = state.assignments.filter((assignment) => {
    return assignment.role === "labeler" && decisionValues(state.annotations[assignment.itemId]?.[assignment.userId]).length;
  }).length;

  let comparableItems = 0;
  let agreedItems = 0;
  let needsResolution = 0;

  getWorkRecords().forEach((record) => {
    const labels = getItemLabels(record.id);
    if (labels.length >= 2) {
      comparableItems += 1;
      const unique = new Set(labels.map((label) => labelSetKey(label.values)));
      if (unique.size === 1) {
        agreedItems += 1;
      } else {
        needsResolution += decisionValues(state.resolutions[record.id]).length ? 0 : 1;
      }
    }
  });

  const exactAgreementRate = comparableItems
    ? `${Math.round((agreedItems / comparableItems) * 100)}%`
    : "n/a";

  return {
    totalItems: getWorkRecords().length,
    labelAssignments,
    completedLabelAssignments,
    comparableItems,
    agreedItems,
    exactAgreementRate,
    needsResolution
  };
}

function renderLabelDistribution(stats) {
  const counts = new Map(state.protocol.labels.map((label) => [label, 0]));
  Object.values(state.annotations).forEach((byUser) => {
    Object.values(byUser).forEach((annotation) => {
      decisionValues(annotation).forEach((label) => {
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });
  });
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  el.labelDistribution.innerHTML = "";

  if (!total) {
    el.labelDistribution.innerHTML = "<div class=\"muted\">No labels submitted yet.</div>";
    return;
  }

  counts.forEach((count, label) => {
    const pct = total ? Math.round((count / total) * 100) : 0;
    const item = document.createElement("div");
    item.className = "bar-item";
    item.innerHTML = `
      <div class="bar-head"><strong>${escapeHtml(label)}</strong><span class="muted">${count} / ${pct}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width: ${pct}%"></div></div>
    `;
    el.labelDistribution.appendChild(item);
  });
}

function renderThroughput() {
  el.throughputTable.innerHTML = "";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Participant</th><th>Role</th><th>Done</th><th>Assigned</th></tr>";
  el.throughputTable.appendChild(thead);

  const tbody = document.createElement("tbody");
  state.users.forEach((user) => {
    getUserRoles(user).filter((role) => role !== "admin").forEach((role) => {
      const assigned = state.assignments.filter((assignment) => assignment.userId === user.id && assignment.role === role).length;
      const done = role === "labeler"
        ? getWorkRecords().filter((record) => decisionValues(state.annotations[record.id]?.[user.id]).length).length
        : getWorkRecords().filter((record) => state.resolutions[record.id]?.resolverId === user.id && decisionValues(state.resolutions[record.id]).length).length;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(user.participantName || user.name)}</td><td>${escapeHtml(role)}</td><td>${done}</td><td>${assigned}</td>`;
      tbody.appendChild(tr);
    });
  });
  if (!tbody.children.length) {
    tbody.innerHTML = "<tr><td class=\"muted\" colspan=\"4\">No labeler or resolver roles assigned.</td></tr>";
  }
  el.throughputTable.appendChild(tbody);
}

function renderExports() {
  const preview = buildFinalRows().slice(0, 5);
  const currentUser = getCurrentUser();
  if (currentUser && getPermissions(currentUser).canLoadParticipantDefinition) {
    el.participantName.value = currentUser.name;
    el.participantId.value = currentUser.id;
    el.participantRole.value = currentUser.role;
  } else if (currentUser && !getPermissions(currentUser).canLoadParticipantDefinition) {
    el.participantName.value = "";
    el.participantId.value = "";
    el.participantRole.value = "labeler";
  }
  el.exportsStatusLine.textContent = `${getWorkRecords().length} selected / ${state.records.length} records / ${Object.keys(state.resolutions).length} resolver decisions / ${countDrafts()} autosaved drafts`;
  const definition = buildProjectDefinition();
  el.exportPreview.textContent = JSON.stringify({
    project: state.projectName,
    project_definition: {
      project_id: definition.metadata.projectId,
      data_path: definition.dataSource.path,
      context_files: definition.contextFiles.map((file) => file.name),
      context_fields: definition.protocol.contextFields,
      records: definition.records.length,
      selected_records: definition.sampling.sampledItemIds.length,
      assignments: definition.assignments.length
    },
    records: state.records.length,
    labels: Object.values(state.annotations).reduce((sum, byUser) => sum + Object.keys(byUser).length, 0),
    preview
  }, null, 2);
}

function countDrafts() {
  const labelDrafts = Object.values(state.drafts.annotations)
    .reduce((sum, byUser) => sum + Object.keys(byUser).length, 0);
  const resolutionDrafts = Object.values(state.drafts.resolutions)
    .reduce((sum, byUser) => sum + Object.keys(byUser).length, 0);
  return labelDrafts + resolutionDrafts;
}

function buildFinalRows() {
  return getWorkRecords().map((record) => {
    const labels = getItemLabels(record.id);
    const unanimous = labels.length >= 2 && new Set(labels.map((label) => labelSetKey(label.values))).size === 1
      ? labels[0].values
      : [];
    const resolutionValues = decisionValues(state.resolutions[record.id]);
    const finalValues = resolutionValues.length ? resolutionValues : unanimous;
    return {
      item_id: record.id,
      final_label: formatLabelValues(finalValues, "|"),
      resolution_source: resolutionValues.length ? "resolver" : unanimous.length ? "unanimous" : "unresolved",
      label_count: labels.length,
      label_values: labels.flatMap((label) => label.values).join("|"),
      resolver_id: state.resolutions[record.id]?.resolverId || "",
      resolution_rationale: state.resolutions[record.id]?.rationale || "",
      data: record.data
    };
  });
}

function buildProjectDefinition() {
  const now = new Date().toISOString();
  return {
    kind: "universal-labeling.project-definition",
    version: 1,
    exportedAt: now,
    projectName: state.projectName,
    metadata: {
      ...state.metadata,
      projectName: state.projectName,
      updatedAt: now
    },
    dataSource: {
      ...state.dataSource,
      format: state.detectedFormat || state.dataSource.format,
      recordCount: state.records.length,
      embedded: true
    },
    importedAt: state.importedAt,
    detectedFormat: state.detectedFormat,
    sampling: {
      ...state.sampling,
      sampledItemIds: getWorkRecords().map((record) => record.id)
    },
    fields: state.fields,
    protocol: {
      ...state.protocol,
      contextFields: getContextFields()
    },
    contextFiles: state.contextFiles,
    records: state.records,
    users: state.users.map((user) => sanitizeUserForOutput(user)),
    assignments: state.assignments
  };
}

function sanitizeUserForOutput(user) {
  const roles = getUserRoles(user);
  return {
    id: user.userHash || user.id,
    userHash: user.userHash || user.id,
    participantName: user.participantName || user.name || user.id,
    name: user.participantName || user.name || user.id,
    roles,
    role: roles[0] || "labeler"
  };
}

function exportProjectDefinition() {
  if (!getPermissions().canExportDefinition) return;
  const definition = buildProjectDefinition();
  downloadFile(`${safeFileName(state.projectName)}-definition.json`, JSON.stringify(definition, null, 2), "application/json");
}

function exportProject() {
  if (!getPermissions().canUseFullState) return;
  downloadFile(`${safeFileName(state.projectName)}-state.json`, JSON.stringify({
    kind: "universal-labeling.workspace-state",
    ...sanitizeStateForServer(state)
  }, null, 2), "application/json");
}

function exportLabelsJsonl() {
  if (!getPermissions().canExportLabels) return;
  const lines = [];
  getWorkRecords().forEach((record) => {
    getItemLabels(record.id).forEach((annotation) => {
      const labels = decisionValues(annotation);
      lines.push(JSON.stringify({
        item_id: record.id,
        user_id: annotation.userId,
        label: formatLabelValues(labels, "|"),
        labels,
        confidence: annotation.confidence,
        notes: annotation.notes,
        updated_at: annotation.updatedAt
      }));
    });
  });
  downloadFile(`${safeFileName(state.projectName)}-labels.jsonl`, `${lines.join("\n")}\n`, "application/x-ndjson");
}

function exportFinalCsv() {
  if (!getPermissions().canExportFinal) return;
  const rows = buildFinalRows().map((row) => ({
    item_id: row.item_id,
    final_label: row.final_label,
    resolution_source: row.resolution_source,
    label_count: row.label_count,
    label_values: row.label_values,
    resolver_id: row.resolver_id,
    resolution_rationale: row.resolution_rationale
  }));
  downloadFile(`${safeFileName(state.projectName)}-final.csv`, toCsv(rows), "text/csv");
}

function clearProject() {
  if (!getPermissions().canClearProject) return;
  const confirmed = confirm("Clear this browser session cache? Server projects and saved labels stay in SQLite.");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  state = createDefaultState();
  selectedLabel = [];
  selectedResolution = [];
  renderAll();
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "user";
}

function safeFileName(value) {
  return slugify(value || "labeling-project").replace(/_/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
