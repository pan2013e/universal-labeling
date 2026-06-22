const { test, expect } = require("@playwright/test");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 42);
}

function usernameFor(testInfo, suffix) {
  return `${slug(testInfo.title)}_${suffix}_${Date.now()}_${testInfo.workerIndex}`;
}

async function signIn(page, username) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to your labeling workspace" })).toBeVisible();
  await page.locator("#loginUsername").fill(username);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#authStatus")).toContainText(username);
  await expect(page.locator("#appShell")).toBeVisible();
  await expect(page.locator("#projectPicker")).not.toHaveValue("");
}

async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#authStatus")).toContainText("Not signed in");
}

async function loadSample(page) {
  await page.locator(".nav-item[data-view='backend']").click();
  await expect(page.getByRole("heading", { name: "Dataset Intake" })).toBeVisible();
  await page.getByRole("button", { name: "Load sample" }).click();
}

async function addMember(page, username, participantName, role) {
  await page.locator(".nav-item[data-view='backend']").click();
  await page.locator("#newUserName").fill(username);
  await page.locator("#newParticipantName").fill(participantName);
  await page.locator("#newUserRole").selectOption(role);
  await page.getByRole("button", { name: "Add/update member" }).click();
  await expect(page.locator(".user-row").filter({ hasText: `participant: ${participantName}` })).toBeVisible();
}

async function enableOwnRole(page, role) {
  await page.locator(".nav-item[data-view='backend']").click();
  const selfRow = page.locator(".user-row").first();
  const checkbox = selfRow.locator(".mini-check").filter({ hasText: role }).locator("input");
  await checkbox.check();
  await expect(page.locator("#currentUser")).toContainText(role);
}

async function selectRole(page, role) {
  await page.locator("#currentUser").selectOption(role);
}

function readStoredProject(projectId) {
  const dbPath = path.join(__dirname, "..", "data", "universal-labeling.sqlite");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT name, state_json FROM projects WHERE id = ?").get(projectId);
    return row ? { name: row.name, state: JSON.parse(row.state_json) } : null;
  } finally {
    db.close();
  }
}

test("opens on login and signs into backend", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await expect(page.locator("#projectName")).toHaveValue("Example Project");
  await expect(page.getByRole("heading", { name: "Backend Console", exact: true })).toBeVisible();
  await expect(page.locator(".nav-item").first()).toContainText("Workspace");
  await expect(page.locator(".nav-item").last()).toContainText("Backend");
  await page.getByRole("button", { name: "Backend help" }).click();
  await expect(page.getByRole("dialog")).toContainText("Admins use this backend page");
});

test("filters navigation and export actions by active project role", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));

  await expect(page.locator(".nav-item[data-view='backend']")).toBeVisible();
  await expect(page.locator(".nav-item[data-view='workspace']")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Dataset Intake" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Participants" })).toBeVisible();
  await expect(page.locator(".creator-card")).toBeVisible();
  await expect(page.locator(".participant-card")).toBeHidden();

  await enableOwnRole(page, "labeler");
  await selectRole(page, "labeler");
  await expect(page.locator(".nav-item[data-view='backend']")).toBeHidden();
  await expect(page.locator(".nav-item[data-view='workspace']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete project" })).toBeHidden();
  await expect(page.locator(".creator-card")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Review Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Final CSV" })).toBeHidden();

  await selectRole(page, "admin");
  await enableOwnRole(page, "resolver");
  await selectRole(page, "resolver");
  await expect(page.locator(".nav-item[data-view='backend']")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Review Workspace" })).toBeVisible();
});

test("loads sample data and labels one item with a multi-role admin account", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await enableOwnRole(page, "labeler");
  await selectRole(page, "admin");
  await loadSample(page);
  await selectRole(page, "labeler");
  await page.getByRole("button", { name: "Workspace" }).click();

  await expect(page.getByRole("heading", { name: "Review Workspace" })).toBeVisible();
  await expect(page.getByText("Project Admin / labeler")).toBeVisible();
  await expect(page.getByRole("heading", { name: /This branch changes rendering/ })).toBeVisible();

  await page.locator("#labelChoices").getByRole("button", { name: "Behavioral issue", exact: true }).click();
  await page.getByRole("button", { name: "Save label" }).click();

  await selectRole(page, "admin");
  await expect(page.getByText("1/4 label assignments")).toBeVisible();
});

test("labeler can clear a submitted label from the Done queue", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await enableOwnRole(page, "labeler");
  await selectRole(page, "admin");
  const projectId = await page.locator("#projectPicker").inputValue();
  await loadSample(page);
  await selectRole(page, "labeler");
  await page.getByRole("button", { name: "Workspace" }).click();

  await page.locator("#labelChoices").getByRole("button", { name: "Behavioral issue", exact: true }).click();
  await page.getByRole("button", { name: "Save label" }).click();
  await page.locator("#queueMode button[data-mode='done']").click();
  await expect(page.locator("#recordPosition")).toHaveText("Item 1 of 1");

  await page.getByRole("button", { name: "Clear selection" }).click();

  await expect(page.locator("#emptyReview")).toContainText("No assigned work matches this queue.");
  const stored = readStoredProject(projectId);
  expect(Object.values(stored.state.annotations).flatMap((byUser) => Object.values(byUser))).toHaveLength(0);
});

test("assigned participant signs in and starts work from the server project", async ({ page }, testInfo) => {
  const admin = usernameFor(testInfo, "admin");
  const labeler = usernameFor(testInfo, "labeler");
  await signIn(page, admin);
  await loadSample(page);
  await addMember(page, labeler, "Ada Labeler", "labeler");
  await signOut(page);

  await signIn(page, labeler);
  await expect(page.locator("#currentUser")).toContainText("labeler");
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Ada Labeler / labeler")).toBeVisible();
  await expect(page.getByRole("heading", { name: /This branch changes rendering/ })).toBeVisible();
});

test("large project payloads are not written to browser localStorage", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (key === "universal-labeling.project.v1") {
        throw new DOMException("Project payload exceeded storage quota.", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);
  await expect(page.locator("#recordCount")).toHaveText("4");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("universal-labeling.project.v1"))).toBeNull();
});

test("new project starts from a blank workspace instead of cloning current data", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);
  await page.locator("#creatorName").fill("Previous Creator");
  await page.locator("#projectId").fill("previous-project");
  await page.locator("#projectDescription").fill("Previous project description");
  await expect(page.locator("#recordCount")).toHaveText("4");

  await page.getByRole("button", { name: "New project" }).click();

  await expect(page.locator("#projectName")).toHaveValue("New Project");
  await expect(page.locator("#creatorName")).toHaveValue("");
  await expect(page.locator("#projectId")).toHaveValue("");
  await expect(page.locator("#projectDescription")).toHaveValue("");
  await expect(page.locator("#dataFilePath")).toHaveValue("");
  await expect(page.locator("#recordCount")).toHaveText("0");
});

test("server filesystem browser opens in a modal and reports availability", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await page.getByRole("button", { name: "Server file", exact: true }).click();
  await expect(page.locator("#serverFileModal")).toBeVisible();
  await expect(page.locator("#serverFileStatus")).toContainText(/disabled|read limit/);
  await expect(page.locator("#serverFilePreviewName")).toContainText("No file selected");
});

test("server filesystem API accepts the signed-in browser session cookie", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  const projectId = await page.locator("#projectPicker").inputValue();
  await page.goto(`/api/projects/${encodeURIComponent(projectId)}/server-files?path=.`);
  await expect(page.locator("body")).not.toContainText("Authentication required");
  const payload = JSON.parse(await page.locator("body").innerText());
  expect(typeof payload.enabled).toBe("boolean");
  expect(payload).toHaveProperty("entries");
});

test("exports a clean project definition without account usernames", async ({ page }, testInfo) => {
  const admin = usernameFor(testInfo, "admin");
  await signIn(page, admin);
  await loadSample(page);

  await page.locator("#creatorName").fill("Research Lead");
  await page.locator("#projectId").fill("review-signal-study");
  await page.locator("#dataFilePath").fill("datasets/reviews.jsonl");

  await page.locator("#protocolInstructions").fill("Use the selected fields and classify the dominant review signal.");
  await page.getByRole("button", { name: "Apply protocol" }).click();

  await page.locator(".nav-item[data-view='backend']").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export definition" }).click()
  ]);
  const definitionPath = testInfo.outputPath("exported-definition.json");
  await download.saveAs(definitionPath);
  const raw = fs.readFileSync(definitionPath, "utf8");
  const definition = JSON.parse(raw);

  expect(raw).not.toContain(admin);
  expect(definition.kind).toBe("universal-labeling.project-definition");
  expect(definition.metadata.creatorName).toBe("Research Lead");
  expect(definition.metadata.projectId).toBe("review-signal-study");
  expect(definition.dataSource.path).toBe("datasets/reviews.jsonl");
  expect(definition.protocol.instructions).toContain("dominant review signal");
  expect(definition.users[0].id).toMatch(/^u_[a-f0-9]{24}$/);
  expect(definition.users[0].username).toBeUndefined();
  expect(definition.records).toHaveLength(4);
  expect(definition.annotations).toBeUndefined();
  expect(definition.drafts).toBeUndefined();
});

test("edits allowed labels with the label editor", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);
  await page.locator(".label-name-input").first().fill("Bug risk");
  await page.locator("#newLabelName").fill("Documentation");
  await page.getByRole("button", { name: "Add label" }).click();
  await page.getByRole("button", { name: "Apply protocol" }).click();

  await page.locator(".nav-item[data-view='backend']").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export definition" }).click()
  ]);
  const definitionPath = testInfo.outputPath("labels-definition.json");
  await download.saveAs(definitionPath);
  const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));

  expect(definition.protocol.labels).toContain("Bug risk");
  expect(definition.protocol.labels).toContain("Documentation");
});

test("supports multiple labels and custom workspace labels", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await enableOwnRole(page, "labeler");
  await selectRole(page, "admin");
  await loadSample(page);

  await page.locator("#labelCardinality").selectOption("multiple");
  await page.locator("#allowCustomLabels").check();
  await page.getByRole("button", { name: "Apply protocol" }).click();

  await selectRole(page, "labeler");
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.locator("#labelChoices").getByRole("button", { name: "Behavioral issue", exact: true }).click();
  await page.locator("#labelChoices").getByRole("button", { name: "Style or maintainability", exact: true }).click();
  await page.locator("#customLabelInput").fill("API compatibility");
  await page.locator("#addCustomLabel").click();
  await expect(page.locator("#labelChoices").getByRole("button", { name: "API compatibility", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save label" }).click();

  await selectRole(page, "admin");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Labels JSONL" }).click()
  ]);
  const labelsPath = testInfo.outputPath("multi-custom-labels.jsonl");
  await download.saveAs(labelsPath);
  const labels = fs.readFileSync(labelsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  expect(labels[0].label).toBe("Behavioral issue|Style or maintainability|API compatibility");
  expect(labels[0].labels).toEqual(["Behavioral issue", "Style or maintainability", "API compatibility"]);
});

test("samples records and exports deterministic sampled ids", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);
  await addMember(page, usernameFor(testInfo, "labeler_a"), "Labeler A", "labeler");
  await addMember(page, usernameFor(testInfo, "labeler_b"), "Labeler B", "labeler");
  await addMember(page, usernameFor(testInfo, "resolver"), "Resolver", "resolver");

  await page.locator("#samplingMode").selectOption("count");
  await page.locator("#samplingCount").fill("2");
  await page.getByRole("button", { name: "Apply sampling" }).click();

  await expect(page.getByText("2 of 4 entries selected")).toBeVisible();
  await page.locator(".nav-item[data-view='backend']").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export definition" }).click()
  ]);
  const definitionPath = testInfo.outputPath("sampled-definition.json");
  await download.saveAs(definitionPath);
  const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));

  expect(definition.sampling.mode).toBe("count");
  expect(definition.sampling.sampledItemIds).toHaveLength(2);
  expect(definition.assignments).toHaveLength(6);
});

test("updates sample-size suggestion live and warns on impossible count", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);

  await expect(page.locator("#suggestedSampleSize")).toHaveText("4");
  await page.locator("#sampleMargin").fill("50");
  await expect(page.locator("#suggestedSampleSize")).toHaveText("3");

  await page.locator("#samplingMode").selectOption("count");
  await page.locator("#samplingCount").fill("99");
  await expect(page.locator("#samplingWarnings")).toContainText("Count must be between 1 and 4");
  await expect(page.getByRole("button", { name: "Apply sampling" })).toBeDisabled();
});

test("admin can delete the current server project", async ({ page }, testInfo) => {
  const admin = usernameFor(testInfo, "admin");
  await signIn(page, admin);
  const deletedProjectId = await page.locator("#projectPicker").inputValue();
  await expect(page.getByRole("button", { name: "Delete project" })).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete");
    expect(dialog.message()).toContain("Example Project");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Delete project" }).click();

  await expect(page.locator("#projectPicker")).not.toHaveValue(deletedProjectId);
  await expect(page.locator("#projectName")).toHaveValue("Example Project");
  expect(readStoredProject(deletedProjectId)).toBeNull();
});

test("example project persists two labels, one resolution, and exports results", async ({ page }, testInfo) => {
  const admin = usernameFor(testInfo, "admin");
  const labelerA = usernameFor(testInfo, "labeler_a");
  const labelerB = usernameFor(testInfo, "labeler_b");
  const resolver = usernameFor(testInfo, "resolver");
  const itemId = "sympy-23927-c1";

  await signIn(page, admin);
  await expect(page.locator("#projectName")).toHaveValue("Example Project");
  const projectId = await page.locator("#projectPicker").inputValue();
  await loadSample(page);
  await page.locator("#allowCustomLabels").check();
  await page.getByRole("button", { name: "Apply protocol" }).click();
  await addMember(page, labelerA, "Labeler One", "labeler");
  await addMember(page, labelerB, "Labeler Two", "labeler");
  await addMember(page, resolver, "Resolver One", "resolver");
  await signOut(page);

  await signIn(page, labelerA);
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Labeler One / labeler")).toBeVisible();
  await page.locator(".queue-item").filter({ hasText: "This branch changes rendering" }).click();
  await expect(page.getByRole("heading", { name: /This branch changes rendering/ })).toBeVisible();
  await page.locator("#labelChoices").getByRole("button", { name: "Behavioral issue", exact: true }).click();
  await page.locator("#labelNotes").fill("Behavior-changing rendering branch.");
  await page.getByRole("button", { name: "Save label" }).click();
  await signOut(page);

  await signIn(page, labelerB);
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Labeler Two / labeler")).toBeVisible();
  await page.locator(".queue-item").filter({ hasText: "This branch changes rendering" }).click();
  await expect(page.getByRole("heading", { name: /This branch changes rendering/ })).toBeVisible();
  await page.locator("#labelChoices").getByRole("button", { name: "Style or maintainability", exact: true }).click();
  await page.locator("#labelNotes").fill("Treating it as maintainability for disagreement test.");
  await page.getByRole("button", { name: "Save label" }).click();
  await signOut(page);

  await signIn(page, resolver);
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Resolver One / resolver")).toBeVisible();
  await expect(page.locator("#recordPosition")).toHaveText("Item 1 of 1");
  await expect(page.locator("#annotationComparison")).toContainText("Behavioral issue");
  await expect(page.locator("#annotationComparison")).toContainText("Style or maintainability");
  await expect(page.locator("#customResolutionLabelInput")).toBeVisible();
  await page.locator("#customResolutionLabelInput").fill("Needs maintainer decision");
  await page.locator("#addCustomResolutionLabel").click();
  await page.locator("#resolutionNotes").fill("Used a custom resolver final label.");
  await page.getByRole("button", { name: "Save resolution" }).click();
  await signOut(page);

  const stored = readStoredProject(projectId);
  expect(stored).toBeTruthy();
  expect(stored.name).toBe("Example Project");
  expect(JSON.stringify(stored.state)).not.toContain(labelerA);
  expect(JSON.stringify(stored.state)).not.toContain(labelerB);
  expect(JSON.stringify(stored.state)).not.toContain(resolver);
  expect(Object.values(stored.state.annotations[itemId] || {}).map((annotation) => annotation.value).sort()).toEqual([
    "Behavioral issue",
    "Style or maintainability"
  ].sort());
  expect(stored.state.resolutions[itemId]).toMatchObject({
    value: "Needs maintainer decision",
    values: ["Needs maintainer decision"],
    rationale: "Used a custom resolver final label."
  });
  expect(stored.state.resolutions[itemId].resolverId).toMatch(/^u_[a-f0-9]{24}$/);

  await signIn(page, admin);
  await page.locator(".nav-item[data-view='backend']").click();
  await expect(page.getByText("2/8 label assignments")).toBeVisible();
  await expect(page.getByText("0% exact agreement")).toBeVisible();

  const [labelsDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Labels JSONL" }).click()
  ]);
  const labelsPath = testInfo.outputPath("example-labels.jsonl");
  await labelsDownload.saveAs(labelsPath);
  const labelsRaw = fs.readFileSync(labelsPath, "utf8");
  const labels = labelsRaw.trim().split("\n").map((line) => JSON.parse(line));
  expect(labels).toHaveLength(2);
  expect(labels.every((label) => label.item_id === itemId)).toBe(true);
  expect(labels.map((label) => label.label).sort()).toEqual([
    "Behavioral issue",
    "Style or maintainability"
  ].sort());
  expect(labelsRaw).not.toContain(labelerA);
  expect(labelsRaw).not.toContain(labelerB);

  const [finalDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Final CSV" }).click()
  ]);
  const finalPath = testInfo.outputPath("example-final.csv");
  await finalDownload.saveAs(finalPath);
  const finalCsv = fs.readFileSync(finalPath, "utf8");
  expect(finalCsv).toContain(itemId);
  expect(finalCsv).toContain("Needs maintainer decision");
  expect(finalCsv).toContain("Behavioral issue|Style or maintainability");
  expect(finalCsv).toContain("resolver");
  expect(finalCsv).toContain("Used a custom resolver final label.");
  expect(finalCsv).not.toContain(labelerA);
  expect(finalCsv).not.toContain(labelerB);
  expect(finalCsv).not.toContain(resolver);
});

test("resolver can clear a submitted resolution from the All queue", async ({ page }, testInfo) => {
  const admin = usernameFor(testInfo, "admin");
  const labelerA = usernameFor(testInfo, "labeler_a");
  const labelerB = usernameFor(testInfo, "labeler_b");
  const resolver = usernameFor(testInfo, "resolver");
  const itemId = "sympy-23927-c1";

  await signIn(page, admin);
  const projectId = await page.locator("#projectPicker").inputValue();
  await loadSample(page);
  await addMember(page, labelerA, "Labeler One", "labeler");
  await addMember(page, labelerB, "Labeler Two", "labeler");
  await addMember(page, resolver, "Resolver One", "resolver");
  await signOut(page);

  await signIn(page, labelerA);
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.locator(".queue-item").filter({ hasText: "This branch changes rendering" }).click();
  await page.locator("#labelChoices").getByRole("button", { name: "Behavioral issue", exact: true }).click();
  await page.getByRole("button", { name: "Save label" }).click();
  await signOut(page);

  await signIn(page, labelerB);
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.locator(".queue-item").filter({ hasText: "This branch changes rendering" }).click();
  await page.locator("#labelChoices").getByRole("button", { name: "Style or maintainability", exact: true }).click();
  await page.getByRole("button", { name: "Save label" }).click();
  await signOut(page);

  await signIn(page, resolver);
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.locator("#resolutionChoices").getByRole("button", { name: "Behavioral issue", exact: true }).click();
  await page.getByRole("button", { name: "Save resolution" }).click();
  await page.locator("#queueMode button[data-mode='all']").click();
  await expect(page.locator("#recordPosition")).toHaveText("Item 1 of 1");

  await page.getByRole("button", { name: "Clear selection" }).click();

  await expect(page.locator("#resolutionChoices").getByRole("button", { name: "Behavioral issue", exact: true })).toHaveAttribute("aria-pressed", "false");
  const stored = readStoredProject(projectId);
  expect(stored.state.resolutions[itemId]).toBeUndefined();
});

test("admin is exported but never assigned review work unless given review roles", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);

  await page.locator(".nav-item[data-view='backend']").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export definition" }).click()
  ]);
  const definitionPath = testInfo.outputPath("admin-definition.json");
  await download.saveAs(definitionPath);
  const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
  const adminUser = definition.users.find((user) => user.roles.includes("admin"));

  expect(adminUser).toBeTruthy();
  expect(definition.assignments.some((assignment) => assignment.userId === adminUser.id)).toBe(false);
});

test("reorders labeler context fields by dragging the sample", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await loadSample(page);

  const first = page.locator("#contextSample .sample-field").first();
  const second = page.locator("#contextSample .sample-field").nth(1);
  await second.dragTo(first);

  await page.locator(".nav-item[data-view='backend']").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export definition" }).click()
  ]);
  const definitionPath = testInfo.outputPath("reordered-definition.json");
  await download.saveAs(definitionPath);
  const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));

  expect(definition.protocol.contextFields[0]).toBe("diff");
  expect(definition.protocol.contextFields[1]).toBe("comment");
});

test("can disable uncertain-label special handling", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await enableOwnRole(page, "labeler");
  await selectRole(page, "admin");
  await loadSample(page);
  await page.locator("#enableUncertain").uncheck();
  await page.getByRole("button", { name: "Apply protocol" }).click();
  await selectRole(page, "labeler");
  await page.getByRole("button", { name: "Workspace" }).click();

  await page.locator("#labelChoices").getByRole("button", { name: "Unclear", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save label" })).toBeEnabled();
});

test("edits participant names in the roster", async ({ page }, testInfo) => {
  await signIn(page, usernameFor(testInfo, "admin"));
  await addMember(page, usernameFor(testInfo, "charlie"), "Charlie", "labeler");
  const row = page.locator(".user-row").filter({ hasText: "participant: Charlie" });
  const input = row.locator(".user-name-input");
  await input.fill("Reviewer Charlie");
  await input.blur();

  await expect(page.locator(".user-row").filter({ hasText: "participant: Reviewer Charlie" })).toBeVisible();
});
