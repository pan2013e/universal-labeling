"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 8000);
const DATA_DIR = process.env.LABELING_DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.LABELING_DB_PATH || path.join(DATA_DIR, "universal-labeling.sqlite");
const SECRET = process.env.LABELING_SECRET || "development-only-change-me";
const SESSION_DAYS = 30;
const SESSION_COOKIE_NAME = "ul_session";
const DEFAULT_PROJECT_NAME = "Example Project";
const DEFAULT_PROJECT_ID = "example-project";
const LEGACY_DEFAULT_PROJECT_NAME = "Software Review Labeling";
const LEGACY_DEFAULT_PROJECT_ID = "software-review-labeling";
const CURRENT_DB_SCHEMA_VERSION = 1;
const CURRENT_STATE_VERSION = 2;
const DEFAULT_SEED_USER_IDS = new Set(["u_admin", "u_labeler_a", "u_labeler_b", "u_resolver"]);
const SERVER_FILE_ROOT = process.env.LABELING_FILE_ROOT
  ? fs.realpathSync(path.resolve(process.env.LABELING_FILE_ROOT))
  : "";
const SERVER_FILE_MAX_BYTES = Number(process.env.LABELING_FILE_MAX_BYTES || 50 * 1024 * 1024);
const JSON_BODY_LIMIT = process.env.LABELING_JSON_BODY_LIMIT || "120mb";

if (SERVER_FILE_ROOT && !fs.statSync(SERVER_FILE_ROOT).isDirectory()) {
  throw new Error("LABELING_FILE_ROOT must point to a directory.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("wal_autocheckpoint = 100");

function checkpointDatabase(mode = "PASSIVE") {
  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (error) {
    console.warn(`SQLite checkpoint failed: ${error.message}`);
  }
}

function closeDatabaseAndExit(signal) {
  checkpointDatabase("TRUNCATE");
  db.close();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", () => closeDatabaseAndExit("SIGINT"));
process.once("SIGTERM", () => closeDatabaseAndExit("SIGTERM"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username_hash TEXT NOT NULL UNIQUE,
    username_encrypted TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_name TEXT NOT NULL,
    roles_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function tableColumns(tableName) {
  const knownTables = new Set(["users", "sessions", "projects", "project_members", "app_metadata"]);
  if (!knownTables.has(tableName)) {
    throw new Error(`Unknown migration table: ${tableName}`);
  }
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!tableColumns(tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

function migrateDatabaseSchema() {
  addColumnIfMissing("projects", "version", "version INTEGER NOT NULL DEFAULT 1");
  const currentVersion = Number(db.pragma("user_version", { simple: true }) || 0);
  if (currentVersion > CURRENT_DB_SCHEMA_VERSION) {
    console.warn(`Database schema version ${currentVersion} is newer than this server expects (${CURRENT_DB_SCHEMA_VERSION}).`);
    return;
  }
  if (currentVersion < CURRENT_DB_SCHEMA_VERSION) {
    db.pragma(`user_version = ${CURRENT_DB_SCHEMA_VERSION}`);
  }
}

migrateDatabaseSchema();

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html"
}));

const createUserStmt = db.prepare(`
  INSERT INTO users (username_hash, username_encrypted, created_at)
  VALUES (?, ?, ?)
`);
const firstUserStmt = db.prepare("SELECT username_encrypted FROM users ORDER BY id LIMIT 1");
const findUserByHashStmt = db.prepare("SELECT * FROM users WHERE username_hash = ?");
const findUserByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const findUserByHashPrefixStmt = db.prepare("SELECT * FROM users WHERE username_hash LIKE ? ORDER BY id LIMIT 1");
const createSessionStmt = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`);
const findSessionStmt = db.prepare(`
  SELECT sessions.*, users.username_hash, users.username_encrypted
  FROM sessions
  JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ?
`);
const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const createProjectStmt = db.prepare(`
  INSERT INTO projects (id, name, state_json, created_by_user_id, created_at, updated_at, version)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);
const updateProjectStateStmt = db.prepare(`
  UPDATE projects SET name = ?, state_json = ?, updated_at = ?, version = version + 1
  WHERE id = ?
`);
const findProjectStmt = db.prepare("SELECT * FROM projects WHERE id = ?");
const deleteProjectStmt = db.prepare("DELETE FROM projects WHERE id = ?");
const allProjectsStmt = db.prepare("SELECT id, name, state_json FROM projects");
const migrateProjectStateStmt = db.prepare("UPDATE projects SET state_json = ? WHERE id = ?");
const listProjectsStmt = db.prepare(`
  SELECT projects.id, projects.name, projects.updated_at, project_members.participant_name, project_members.roles_json
  FROM projects
  JOIN project_members ON project_members.project_id = projects.id
  WHERE project_members.user_id = ?
  ORDER BY projects.updated_at DESC
`);
const memberByProjectUserStmt = db.prepare(`
  SELECT project_members.*, users.username_hash, users.username_encrypted
  FROM project_members
  JOIN users ON users.id = project_members.user_id
  WHERE project_members.project_id = ? AND project_members.user_id = ?
`);
const membersForProjectStmt = db.prepare(`
  SELECT project_members.*, users.username_hash, users.username_encrypted
  FROM project_members
  JOIN users ON users.id = project_members.user_id
  WHERE project_members.project_id = ?
  ORDER BY project_members.created_at ASC
`);
const upsertMemberStmt = db.prepare(`
  INSERT INTO project_members (project_id, user_id, participant_name, roles_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(project_id, user_id)
  DO UPDATE SET participant_name = excluded.participant_name,
                roles_json = excluded.roles_json,
                updated_at = excluded.updated_at
`);
const deleteMemberStmt = db.prepare(`
  DELETE FROM project_members WHERE project_id = ? AND user_id = ?
`);
const getMetadataStmt = db.prepare("SELECT value FROM app_metadata WHERE key = ?");
const upsertMetadataStmt = db.prepare(`
  INSERT INTO app_metadata (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                  updated_at = excluded.updated_at
`);
const legacyDefaultProjectsStmt = db.prepare(`
  SELECT id, name, state_json
  FROM projects
  WHERE name = ? OR state_json LIKE ?
`);

function stateUserFromAccount(user, participantName, roles) {
  const publicId = publicUserIdFromHash(user.username_hash);
  const normalizedRoles = normalizeRoles(roles);
  return {
    id: publicId,
    userHash: publicId,
    name: participantName,
    participantName,
    roles: normalizedRoles,
    role: normalizedRoles[0] || "labeler"
  };
}

function normalizeLabelValues(values) {
  const source = Array.isArray(values) ? values : String(values || "").split("|");
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

function migrateDecision(decision) {
  if (!decision || typeof decision !== "object") return decision;
  const values = normalizeLabelValues(Array.isArray(decision.values) ? decision.values : decision.value);
  return {
    ...decision,
    value: decision.value || values.join("|"),
    values
  };
}

function migrateDecisionMap(map) {
  Object.entries(map || {}).forEach(([itemId, value]) => {
    const looksLikeByUser = value && typeof value === "object" && !Array.isArray(value) && !("value" in value) && !("values" in value);
    if (looksLikeByUser) {
      Object.entries(value).forEach(([userId, decision]) => {
        value[userId] = migrateDecision(decision);
      });
    } else {
      map[itemId] = migrateDecision(value);
    }
  });
}

function migrateProjectStateShape(inputState) {
  const state = JSON.parse(JSON.stringify(inputState || {}));
  state.version = CURRENT_STATE_VERSION;
  state.protocol = {
    ...(state.protocol || {}),
    labelCardinality: state.protocol?.labelCardinality || "single",
    allowCustomLabels: Boolean(state.protocol?.allowCustomLabels),
    includeItemContext: state.protocol?.includeItemContext !== false
  };
  state.annotations ||= {};
  state.resolutions ||= {};
  state.drafts ||= { annotations: {}, resolutions: {} };
  state.drafts.annotations ||= {};
  state.drafts.resolutions ||= {};
  migrateDecisionMap(state.annotations);
  migrateDecisionMap(state.resolutions);
  migrateDecisionMap(state.drafts.annotations);
  migrateDecisionMap(state.drafts.resolutions);
  return state;
}

function nowIso() {
  return new Date().toISOString();
}

function migrateDefaultProjectNames() {
  legacyDefaultProjectsStmt.all(LEGACY_DEFAULT_PROJECT_NAME, `%${LEGACY_DEFAULT_PROJECT_NAME}%`).forEach((project) => {
    let state;
    try {
      state = JSON.parse(project.state_json);
    } catch {
      return;
    }

    let changed = false;
    let nextName = project.name;
    if (project.name === LEGACY_DEFAULT_PROJECT_NAME) {
      nextName = DEFAULT_PROJECT_NAME;
      changed = true;
    }
    if (state.projectName === LEGACY_DEFAULT_PROJECT_NAME) {
      state.projectName = DEFAULT_PROJECT_NAME;
      changed = true;
    }
    if (state.metadata?.projectId === LEGACY_DEFAULT_PROJECT_ID) {
      state.metadata.projectId = DEFAULT_PROJECT_ID;
      changed = true;
    }

    if (changed) {
      updateProjectStateStmt.run(nextName, JSON.stringify(state), nowIso(), project.id);
    }
  });
}

migrateDefaultProjectNames();

function migrateStoredProjectStates() {
  allProjectsStmt.all().forEach((project) => {
    let state;
    try {
      state = JSON.parse(project.state_json);
    } catch {
      return;
    }
    const migrated = migrateProjectStateShape(state);
    if (JSON.stringify(migrated) !== project.state_json) {
      migrateProjectStateStmt.run(JSON.stringify(migrated), project.id);
    }
  });
}

migrateStoredProjectStates();

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function assertUsername(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9_.@-]{2,80}$/.test(normalized)) {
    const error = new Error("User name must be 2-80 characters and use letters, numbers, dot, underscore, @, or hyphen.");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function hmac(value, purpose = "identity") {
  return crypto.createHmac("sha256", `${SECRET}:${purpose}`).update(value).digest("hex");
}

function publicUserIdFromHash(usernameHash) {
  return `u_${usernameHash.slice(0, 24)}`;
}

function tokenHash(token) {
  return hmac(token, "session");
}

function encryptionKey() {
  return crypto.createHash("sha256").update(`${SECRET}:username-encryption`).digest();
}

function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptText(value) {
  const [ivHex, tagHex, encryptedHex] = String(value || "").split(":");
  if (!ivHex || !tagHex || !encryptedHex) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final()
  ]).toString("utf8");
}

let secretMismatch = false;

function verifySecretMarker() {
  const key = "secret_marker";
  const marker = hmac("universal-labeling-secret-marker", "config");
  const existing = getMetadataStmt.get(key);
  if (!existing) {
    const firstUser = firstUserStmt.get();
    if (firstUser) {
      try {
        decryptText(firstUser.username_encrypted);
      } catch {
        secretMismatch = true;
        console.error("LABELING_SECRET does not match the existing database. Set the original LABELING_SECRET or use a different LABELING_DB_PATH.");
        return;
      }
    }
    upsertMetadataStmt.run(key, marker, nowIso());
    checkpointDatabase();
    return;
  }
  if (existing.value !== marker) {
    secretMismatch = true;
    console.error("LABELING_SECRET does not match this database. Existing users and projects cannot be loaded safely.");
  }
}

function assertSecretCompatible() {
  if (!secretMismatch) return;
  const error = new Error("Server secret does not match this database. Restart with the original LABELING_SECRET or use a different LABELING_DB_PATH.");
  error.status = 503;
  throw error;
}

verifySecretMarker();

function getOrCreateUser(username) {
  assertSecretCompatible();
  const normalized = assertUsername(username);
  const usernameHash = hmac(normalized, "username");
  const existing = findUserByHashStmt.get(usernameHash);
  if (existing) return existing;
  createUserStmt.run(usernameHash, encryptText(normalized), nowIso());
  checkpointDatabase();
  return findUserByHashStmt.get(usernameHash);
}

function userFromPublicId(publicId) {
  const normalized = String(publicId || "");
  if (!/^u_[a-f0-9]{24}$/.test(normalized)) return null;
  return findUserByHashPrefixStmt.get(`${normalized.slice(2)}%`) || null;
}

function stateUserMembership(stateUser) {
  const roles = normalizeRoles(stateUser?.roles || [stateUser?.role]);
  if (!roles.length) return null;
  const participantName = String(stateUser.participantName || stateUser.name || stateUser.username || stateUser.id || "").trim();
  if (!participantName) return null;
  return { participantName, roles };
}

function accountForStateUser(stateUser) {
  if (stateUser?.username) return getOrCreateUser(stateUser.username);
  return userFromPublicId(stateUser?.id || stateUser?.userHash);
}

function upsertProjectMembersFromState(projectId, stateUsers, fallbackUser, timestamp = nowIso()) {
  const currentPublicId = publicUserIdFromHash(fallbackUser.username_hash);
  let hasFallbackMember = false;
  let hasAdmin = false;

  (Array.isArray(stateUsers) ? stateUsers : []).forEach((stateUser) => {
    const membership = stateUserMembership(stateUser);
    if (!membership) return;
    const account = accountForStateUser(stateUser);
    if (!account) return;
    hasFallbackMember ||= account.id === fallbackUser.id;
    hasAdmin ||= membership.roles.includes("admin");
    upsertMemberStmt.run(
      projectId,
      account.id,
      membership.participantName,
      JSON.stringify(membership.roles),
      timestamp,
      timestamp
    );
  });

  if (!hasFallbackMember) {
    upsertMemberStmt.run(projectId, fallbackUser.id, "Project Admin", JSON.stringify(["admin"]), timestamp, timestamp);
    hasAdmin = true;
  } else if (!hasAdmin) {
    const fallbackMembership = (Array.isArray(stateUsers) ? stateUsers : [])
      .find((stateUser) => [stateUser?.id, stateUser?.userHash].includes(currentPublicId));
    const name = fallbackMembership?.participantName || fallbackMembership?.name || "Project Admin";
    const roles = normalizeRoles([...(fallbackMembership?.roles || [fallbackMembership?.role]), "admin"]);
    upsertMemberStmt.run(projectId, fallbackUser.id, name, JSON.stringify(roles), timestamp, timestamp);
  }
}

function reconcileStateMembershipsForUser(user) {
  const publicId = publicUserIdFromHash(user.username_hash);
  const timestamp = nowIso();
  let changed = false;
  allProjectsStmt.all().forEach((project) => {
    const existingMembership = getMembership(project.id, user.id);
    let state;
    try {
      state = JSON.parse(project.state_json);
    } catch {
      return;
    }
    const stateUser = (state.users || []).find((entry) => [entry?.id, entry?.userHash].includes(publicId));
    const membership = stateUserMembership(stateUser);
    if (!membership) return;
    if (existingMembership) {
      const existingRoles = rolesFromJson(existingMembership.roles_json);
      const isBootstrapAdmin = existingMembership.participant_name === "Project Admin" && existingRoles.length === 1 && existingRoles[0] === "admin";
      if (!isBootstrapAdmin) return;
    }
    upsertMemberStmt.run(project.id, user.id, membership.participantName, JSON.stringify(membership.roles), timestamp, timestamp);
    changed = true;
  });
  if (changed) checkpointDatabase();
}

function serializeUser(row) {
  return {
    id: publicUserIdFromHash(row.username_hash),
    username: decryptText(row.username_encrypted)
  };
}

function rolesFromJson(value) {
  try {
    const roles = JSON.parse(value || "[]");
    return normalizeRoles(roles);
  } catch {
    return [];
  }
}

function normalizeRoles(roles) {
  const allowed = new Set(["admin", "labeler", "resolver"]);
  const normalized = Array.isArray(roles) ? roles.filter((role) => allowed.has(role)) : [];
  return [...new Set(normalized)];
}

function parseCookies(req) {
  return String(req.get("cookie") || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separator = entry.indexOf("=");
      if (separator === -1) return cookies;
      const name = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function isHttpsRequest(req) {
  return req.secure || req.get("x-forwarded-proto") === "https";
}

function sessionCookieAttributes(req, maxAgeSeconds) {
  const attributes = [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isHttpsRequest(req)) attributes.push("Secure");
  return attributes.join("; ");
}

function setSessionCookie(req, res, token) {
  const maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${sessionCookieAttributes(req, maxAgeSeconds)}`);
}

function clearSessionCookie(req, res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; ${sessionCookieAttributes(req, 0)}`);
}

function authTokenFromRequest(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return parseCookies(req)[SESSION_COOKIE_NAME] || "";
}

function requireAuth(req, res, next) {
  const token = authTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: "Authentication required." });

  const session = findSessionStmt.get(tokenHash(token));
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "Session expired or invalid." });
  }
  req.sessionTokenHash = tokenHash(token);
  req.user = {
    id: session.user_id,
    username_hash: session.username_hash,
    username_encrypted: session.username_encrypted
  };
  setSessionCookie(req, res, token);
  next();
}

function getMembership(projectId, userId) {
  return memberByProjectUserStmt.get(projectId, userId);
}

function requireProjectMember(req, res, next) {
  const project = findProjectStmt.get(req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found." });
  const membership = getMembership(project.id, req.user.id);
  if (!membership) return res.status(403).json({ error: "You are not a member of this project." });
  req.project = project;
  req.membership = membership;
  req.roles = rolesFromJson(membership.roles_json);
  next();
}

function requireProjectAdmin(req, res, next) {
  if (!req.roles.includes("admin")) {
    return res.status(403).json({ error: "Project admin role required." });
  }
  next();
}

function serverFileRootLabel() {
  return SERVER_FILE_ROOT ? path.basename(SERVER_FILE_ROOT) || SERVER_FILE_ROOT : "";
}

function serverFilesDisabledPayload() {
  return {
    enabled: false,
    rootLabel: "",
    path: "",
    parent: "",
    maxBytes: SERVER_FILE_MAX_BYTES,
    entries: []
  };
}

function assertServerFilesEnabled() {
  if (!SERVER_FILE_ROOT) {
    const error = new Error("Server filesystem access is disabled. Set LABELING_FILE_ROOT when launching the server to enable it.");
    error.status = 403;
    throw error;
  }
}

function resolveServerScopedPath(relativePath = ".") {
  assertServerFilesEnabled();
  const requested = path.resolve(SERVER_FILE_ROOT, String(relativePath || "."));
  let real;
  try {
    real = fs.realpathSync(requested);
  } catch {
    const error = new Error("Server file path not found.");
    error.status = 404;
    throw error;
  }
  if (real !== SERVER_FILE_ROOT && !real.startsWith(`${SERVER_FILE_ROOT}${path.sep}`)) {
    const error = new Error("Server file path is outside the configured filesystem scope.");
    error.status = 403;
    throw error;
  }
  return real;
}

function relativeServerPath(realPath) {
  const relative = path.relative(SERVER_FILE_ROOT, realPath);
  return relative || ".";
}

function listServerFiles(relativePath = ".") {
  if (!SERVER_FILE_ROOT) return serverFilesDisabledPayload();
  const directory = resolveServerScopedPath(relativePath);
  const stats = fs.statSync(directory);
  if (!stats.isDirectory()) {
    const error = new Error("Server file path must be a directory.");
    error.status = 400;
    throw error;
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      let real;
      let stat;
      try {
        real = fs.realpathSync(fullPath);
        if (real !== SERVER_FILE_ROOT && !real.startsWith(`${SERVER_FILE_ROOT}${path.sep}`)) return null;
        stat = fs.statSync(real);
      } catch {
        return null;
      }
      const isDirectory = stat.isDirectory();
      const isFile = stat.isFile();
      if (!isDirectory && !isFile) return null;
      return {
        name: entry.name,
        path: relativeServerPath(real),
        type: isDirectory ? "directory" : "file",
        size: isFile ? stat.size : null,
        modifiedAt: stat.mtime.toISOString(),
        tooLarge: isFile && stat.size > SERVER_FILE_MAX_BYTES
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const currentPath = relativeServerPath(directory);
  const parentPath = directory === SERVER_FILE_ROOT ? "" : relativeServerPath(path.dirname(directory));
  return {
    enabled: true,
    rootLabel: serverFileRootLabel(),
    path: currentPath,
    parent: parentPath,
    maxBytes: SERVER_FILE_MAX_BYTES,
    entries
  };
}

function readServerFile(relativePath) {
  const filePath = resolveServerScopedPath(relativePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    const error = new Error("Select a server file, not a directory.");
    error.status = 400;
    throw error;
  }
  if (stat.size > SERVER_FILE_MAX_BYTES) {
    const error = new Error(`Server file is too large to read through the web app. Limit is ${SERVER_FILE_MAX_BYTES} bytes.`);
    error.status = 413;
    throw error;
  }
  return {
    name: path.basename(filePath),
    path: relativeServerPath(filePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    text: fs.readFileSync(filePath, "utf8")
  };
}

function wildcardToRegex(pattern) {
  const escaped = String(pattern || "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

function readServerFilePattern(relativePattern, maxMatches = 5) {
  assertServerFilesEnabled();
  const pattern = String(relativePattern || "").trim();
  if (!pattern) return [];
  if (!/[*?]/.test(pattern)) {
    return [readServerFile(pattern)];
  }

  const directoryPattern = path.dirname(pattern);
  const filePattern = path.basename(pattern);
  if (/[*?]/.test(directoryPattern)) {
    const error = new Error("Server file wildcards are supported only in the filename segment.");
    error.status = 400;
    throw error;
  }

  const directory = resolveServerScopedPath(directoryPattern === "." ? "." : directoryPattern);
  if (!fs.statSync(directory).isDirectory()) {
    const error = new Error("Server file pattern directory not found.");
    error.status = 404;
    throw error;
  }

  const matcher = wildcardToRegex(filePattern);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
    .slice(0, Math.max(1, Math.min(Number(maxMatches) || 5, 20)))
    .map((realPath) => readServerFile(relativeServerPath(realPath)));
}

function memberPublicId(member) {
  return publicUserIdFromHash(member.username_hash);
}

function serializeMember(member, includeUsername) {
  const user = {
    id: memberPublicId(member),
    userHash: memberPublicId(member),
    name: member.participant_name,
    participantName: member.participant_name,
    roles: rolesFromJson(member.roles_json)
  };
  if (includeUsername) {
    user.username = decryptText(member.username_encrypted);
  }
  user.role = user.roles[0] || "labeler";
  return user;
}

function mergeStateUsersWithMembers(stateUsers, members, includeUsername) {
  const merged = new Map();
  (Array.isArray(stateUsers) ? stateUsers : []).forEach((stateUser) => {
    const roles = normalizeRoles(stateUser.roles || [stateUser.role]);
    const id = stateUser.id || stateUser.userHash;
    if (!id || !roles.length) return;
    if (members.length && DEFAULT_SEED_USER_IDS.has(id)) return;
    merged.set(id, {
      id,
      userHash: stateUser.userHash || id,
      name: stateUser.name || stateUser.participantName || id,
      participantName: stateUser.participantName || stateUser.name || id,
      roles,
      role: roles[0] || "labeler"
    });
  });
  members.forEach((member) => {
    const serialized = serializeMember(member, includeUsername);
    const existing = merged.get(serialized.id);
    const isBootstrapAdmin = serialized.participantName === "Project Admin" && serialized.roles.length === 1 && serialized.roles[0] === "admin";
    if (existing && isBootstrapAdmin) {
      merged.set(serialized.id, {
        ...existing,
        roles: normalizeRoles([...existing.roles, ...serialized.roles]),
        role: normalizeRoles([...existing.roles, ...serialized.roles])[0] || existing.role,
        ...(serialized.username ? { username: serialized.username } : {})
      });
      return;
    }
    merged.set(serialized.id, serialized);
  });
  return [...merged.values()];
}

function decorateProjectState(project, actorRoles) {
  const includeUsername = actorRoles.includes("admin");
  const members = membersForProjectStmt.all(project.id);
  let state;
  try {
    state = migrateProjectStateShape(JSON.parse(project.state_json));
  } catch {
    state = migrateProjectStateShape({});
  }
  state.serverProjectId = project.id;
  state.serverVersion = project.version;
  state.projectName = project.name || state.projectName || "Labeling Project";
  state.users = mergeStateUsersWithMembers(state.users, members, includeUsername);
  state.lastSavedAt = project.updated_at;
  return state;
}

function sanitizedStoredState(inputState, projectId) {
  const state = migrateProjectStateShape(inputState || {});
  state.serverProjectId = projectId;
  state.users = (state.users || []).map((user) => ({
    id: user.id,
    userHash: user.userHash || user.id,
    name: user.name || user.participantName || user.id,
    participantName: user.participantName || user.name || user.id,
    roles: normalizeRoles(user.roles || [user.role]),
    role: normalizeRoles(user.roles || [user.role])[0] || "labeler"
  }));
  return state;
}

function mergeMemberWork(existing, incoming, actorPublicId, roles) {
  const merged = JSON.parse(JSON.stringify(existing || {}));
  const incomingState = incoming || {};
  merged.currentItemId = incomingState.currentItemId || merged.currentItemId || null;
  merged.queueMode = incomingState.queueMode || merged.queueMode || "todo";
  merged.queueSearch = incomingState.queueSearch || merged.queueSearch || "";
  merged.drafts ||= { annotations: {}, resolutions: {} };
  merged.annotations ||= {};
  merged.resolutions ||= {};

  if (roles.includes("labeler")) {
    Object.entries(merged.annotations).forEach(([itemId, byUser]) => {
      if (!byUser || !Object.hasOwn(byUser, actorPublicId)) return;
      delete byUser[actorPublicId];
      if (!Object.keys(byUser).length) delete merged.annotations[itemId];
    });
    Object.entries(incomingState.annotations || {}).forEach(([itemId, byUser]) => {
      if (byUser?.[actorPublicId]) {
        merged.annotations[itemId] ||= {};
        merged.annotations[itemId][actorPublicId] = byUser[actorPublicId];
      }
    });
    Object.entries(merged.drafts.annotations || {}).forEach(([itemId, byUser]) => {
      if (!byUser || !Object.hasOwn(byUser, actorPublicId)) return;
      delete byUser[actorPublicId];
      if (!Object.keys(byUser).length) delete merged.drafts.annotations[itemId];
    });
    Object.entries(incomingState.drafts?.annotations || {}).forEach(([itemId, byUser]) => {
      if (byUser?.[actorPublicId]) {
        merged.drafts.annotations[itemId] ||= {};
        merged.drafts.annotations[itemId][actorPublicId] = byUser[actorPublicId];
      }
    });
  }

  if (roles.includes("resolver")) {
    Object.entries(merged.resolutions).forEach(([itemId, resolution]) => {
      if (resolution?.resolverId === actorPublicId) delete merged.resolutions[itemId];
    });
    Object.entries(incomingState.resolutions || {}).forEach(([itemId, resolution]) => {
      if (resolution?.resolverId === actorPublicId) {
        merged.resolutions[itemId] = resolution;
      }
    });
    Object.entries(merged.drafts.resolutions || {}).forEach(([itemId, byUser]) => {
      if (!byUser || !Object.hasOwn(byUser, actorPublicId)) return;
      delete byUser[actorPublicId];
      if (!Object.keys(byUser).length) delete merged.drafts.resolutions[itemId];
    });
    Object.entries(incomingState.drafts?.resolutions || {}).forEach(([itemId, byUser]) => {
      if (byUser?.[actorPublicId]) {
        merged.drafts.resolutions[itemId] ||= {};
        merged.drafts.resolutions[itemId][actorPublicId] = byUser[actorPublicId];
      }
    });
  }

  return merged;
}

function saveProjectState(project, nextState, options = {}) {
  const shouldCheckpoint = options.checkpoint !== false;
  const state = sanitizedStoredState(nextState, project.id);
  const name = String(state.projectName || project.name || "Labeling Project").trim() || "Labeling Project";
  const savedAt = nowIso();
  state.lastSavedAt = savedAt;
  updateProjectStateStmt.run(name, JSON.stringify(state), savedAt, project.id);
  if (shouldCheckpoint) checkpointDatabase();
  return findProjectStmt.get(project.id);
}

function updateProjectStateUsers(project, mutateUsers, options = {}) {
  let state;
  try {
    state = migrateProjectStateShape(JSON.parse(project.state_json));
  } catch {
    state = migrateProjectStateShape({});
  }
  const nextUsers = mutateUsers(Array.isArray(state.users) ? state.users : [], state);
  state.users = Array.isArray(nextUsers) ? nextUsers : [];
  return saveProjectState(project, state, options);
}

function upsertStateUser(project, user, participantName, roles, options = {}) {
  return updateProjectStateUsers(project, (users) => {
    const nextUser = stateUserFromAccount(user, participantName, roles);
    const existingIndex = users.findIndex((entry) => [entry?.id, entry?.userHash].includes(nextUser.id));
    if (existingIndex >= 0) {
      users[existingIndex] = {
        ...users[existingIndex],
        ...nextUser
      };
      return users;
    }
    return [...users, nextUser];
  }, options);
}

function removeStateUser(project, publicUserId, options = {}) {
  return updateProjectStateUsers(project, (users, state) => {
    state.assignments = (state.assignments || []).filter((assignment) => assignment.userId !== publicUserId);
    Object.keys(state.annotations || {}).forEach((itemId) => {
      if (state.annotations[itemId]) delete state.annotations[itemId][publicUserId];
      if (!Object.keys(state.annotations[itemId] || {}).length) delete state.annotations[itemId];
    });
    Object.keys(state.drafts?.annotations || {}).forEach((itemId) => {
      if (state.drafts.annotations[itemId]) delete state.drafts.annotations[itemId][publicUserId];
      if (!Object.keys(state.drafts.annotations[itemId] || {}).length) delete state.drafts.annotations[itemId];
    });
    Object.keys(state.drafts?.resolutions || {}).forEach((itemId) => {
      if (state.drafts.resolutions[itemId]) delete state.drafts.resolutions[itemId][publicUserId];
      if (!Object.keys(state.drafts.resolutions[itemId] || {}).length) delete state.drafts.resolutions[itemId];
    });
    Object.keys(state.resolutions || {}).forEach((itemId) => {
      if (state.resolutions[itemId]?.resolverId === publicUserId) delete state.resolutions[itemId];
    });
    if (state.currentUserId === publicUserId) {
      state.currentUserId = users.find((user) => ![user?.id, user?.userHash].includes(publicUserId))?.id || "";
    }
    return users.filter((user) => ![user?.id, user?.userHash].includes(publicUserId));
  }, options);
}

function writeRolesForStateSave(memberRoles, activeRole) {
  if (["labeler", "resolver"].includes(activeRole) && memberRoles.includes(activeRole)) {
    return [activeRole];
  }
  if (memberRoles.includes("admin")) return ["admin"];
  return memberRoles;
}

function createProjectForUser(user, stateInput) {
  const projectId = `p_${crypto.randomBytes(9).toString("hex")}`;
  const createdAt = nowIso();
  const importedUsers = Array.isArray(stateInput?.users) ? stateInput.users : [];
  const state = sanitizedStoredState(stateInput || {}, projectId);
  const name = String(state.projectName || DEFAULT_PROJECT_NAME).trim() || DEFAULT_PROJECT_NAME;
  state.projectName = name;
  state.currentUserId = publicUserIdFromHash(user.username_hash);
  state.activeRole = "admin";
  createProjectStmt.run(projectId, name, JSON.stringify(state), user.id, createdAt, createdAt);
  upsertProjectMembersFromState(projectId, importedUsers.length ? importedUsers : state.users, user, createdAt);
  checkpointDatabase();
  return findProjectStmt.get(projectId);
}

function sendProject(req, res, project = req.project) {
  const roles = project.id === req.project?.id ? req.roles : rolesFromJson(getMembership(project.id, req.user.id).roles_json);
  res.json({
    project: {
      id: project.id,
      name: project.name,
      updatedAt: project.updated_at,
      roles
    },
    state: decorateProjectState(project, roles)
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, database: DB_PATH });
});

app.post("/api/auth/login", (req, res, next) => {
  try {
    const user = getOrCreateUser(req.body?.username);
    reconcileStateMembershipsForUser(user);
    const token = crypto.randomBytes(32).toString("hex");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    createSessionStmt.run(tokenHash(token), user.id, createdAt, expiresAt);
    checkpointDatabase();
    setSessionCookie(req, res, token);
    res.json({ token, user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  deleteSessionStmt.run(req.sessionTokenHash);
  checkpointDatabase();
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  reconcileStateMembershipsForUser(req.user);
  res.json({ user: serializeUser(req.user) });
});

app.get("/api/projects", requireAuth, (req, res) => {
  reconcileStateMembershipsForUser(req.user);
  res.json({
    projects: listProjectsStmt.all(req.user.id).map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updated_at,
      participantName: project.participant_name,
      roles: rolesFromJson(project.roles_json)
    }))
  });
});

app.post("/api/projects", requireAuth, (req, res, next) => {
  try {
    const project = createProjectForUser(req.user, req.body?.state || { projectName: req.body?.projectName });
    req.project = project;
    req.membership = getMembership(project.id, req.user.id);
    req.roles = rolesFromJson(req.membership.roles_json);
    sendProject(req, res, project);
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", requireAuth, requireProjectMember, (req, res) => {
  sendProject(req, res);
});

app.get("/api/projects/:projectId/server-files", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    res.json(listServerFiles(req.query?.path || "."));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/server-files/read", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    res.json({
      enabled: Boolean(SERVER_FILE_ROOT),
      rootLabel: serverFileRootLabel(),
      maxBytes: SERVER_FILE_MAX_BYTES,
      file: readServerFile(req.body?.path || "")
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/server-files/resolve", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    assertServerFilesEnabled();
    const patterns = Array.isArray(req.body?.patterns) ? req.body.patterns.slice(0, 2000) : [];
    const maxMatches = Math.max(1, Math.min(Number(req.body?.maxMatchesPerPattern) || 5, 20));
    const matches = [];
    const errors = [];
    patterns.forEach((entry) => {
      const itemId = String(entry?.itemId || "");
      const pattern = String(entry?.path || "");
      try {
        const files = readServerFilePattern(pattern, maxMatches);
        matches.push({ itemId, path: pattern, files });
      } catch (error) {
        errors.push({ itemId, path: pattern, error: error.message });
      }
    });
    res.json({
      enabled: true,
      rootLabel: serverFileRootLabel(),
      maxBytes: SERVER_FILE_MAX_BYTES,
      matches,
      errors
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:projectId", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    deleteProjectStmt.run(req.project.id);
    checkpointDatabase();
    res.json({ ok: true, deletedProjectId: req.project.id });
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:projectId/state", requireAuth, requireProjectMember, (req, res, next) => {
  try {
    const incomingState = req.body?.state || {};
    if (incomingState.serverProjectId && incomingState.serverProjectId !== req.project.id) {
      return res.status(409).json({ error: "Project state belongs to a different server project." });
    }
    const writeRoles = writeRolesForStateSave(req.roles, incomingState.activeRole);
    if (writeRoles.includes("admin") && incomingState.serverVersion != null && Number(incomingState.serverVersion) !== req.project.version) {
      return res.status(409).json({ error: "Project has changed since this page loaded. Refresh before saving admin changes." });
    }
    let nextState = incomingState;
    if (!writeRoles.includes("admin")) {
      const existing = JSON.parse(req.project.state_json);
      nextState = mergeMemberWork(existing, incomingState, publicUserIdFromHash(req.user.username_hash), writeRoles);
    }
    const project = saveProjectState(req.project, nextState);
    if (writeRoles.includes("admin")) {
      upsertProjectMembersFromState(project.id, incomingState.users, req.user);
    }
    req.project = project;
    sendProject(req, res, project);
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/members", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    const user = getOrCreateUser(req.body?.username);
    const roles = normalizeRoles(req.body?.roles);
    if (!roles.length) {
      return res.status(400).json({ error: "Select at least one role." });
    }
    const participantName = String(req.body?.participantName || req.body?.username || "").trim();
    if (!participantName) {
      return res.status(400).json({ error: "Participant name is required." });
    }
    const timestamp = nowIso();
    let project;
    db.transaction(() => {
      upsertMemberStmt.run(req.project.id, user.id, participantName, JSON.stringify(roles), timestamp, timestamp);
      project = upsertStateUser(req.project, user, participantName, roles, { checkpoint: false });
    })();
    checkpointDatabase();
    req.project = project;
    req.membership = getMembership(project.id, req.user.id);
    req.roles = rolesFromJson(req.membership.roles_json);
    sendProject(req, res, project);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/projects/:projectId/members/:publicUserId", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    const target = membersForProjectStmt.all(req.project.id).find((member) => memberPublicId(member) === req.params.publicUserId);
    if (!target) return res.status(404).json({ error: "Project member not found." });
    const roles = normalizeRoles(req.body?.roles);
    if (!roles.length) return res.status(400).json({ error: "Select at least one role." });
    if (target.user_id === req.user.id && !roles.includes("admin") && membersForProjectStmt.all(req.project.id).filter((member) => rolesFromJson(member.roles_json).includes("admin")).length <= 1) {
      return res.status(400).json({ error: "Keep at least one admin on the project." });
    }
    const participantName = String(req.body?.participantName || target.participant_name || "").trim();
    if (!participantName) return res.status(400).json({ error: "Participant name is required." });
    let project;
    db.transaction(() => {
      upsertMemberStmt.run(req.project.id, target.user_id, participantName, JSON.stringify(roles), target.created_at, nowIso());
      project = upsertStateUser(req.project, target, participantName, roles, { checkpoint: false });
    })();
    checkpointDatabase();
    req.project = project;
    req.membership = getMembership(project.id, req.user.id);
    req.roles = rolesFromJson(req.membership.roles_json);
    sendProject(req, res, project);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:projectId/members/:publicUserId", requireAuth, requireProjectMember, requireProjectAdmin, (req, res, next) => {
  try {
    const members = membersForProjectStmt.all(req.project.id);
    const target = members.find((member) => memberPublicId(member) === req.params.publicUserId);
    if (!target) return res.status(404).json({ error: "Project member not found." });
    if (target.user_id === req.user.id) return res.status(400).json({ error: "Admins cannot remove their own account from the project." });
    if (rolesFromJson(target.roles_json).includes("admin") && members.filter((member) => rolesFromJson(member.roles_json).includes("admin")).length <= 1) {
      return res.status(400).json({ error: "Keep at least one admin on the project." });
    }
    const targetPublicId = memberPublicId(target);
    let project;
    db.transaction(() => {
      deleteMemberStmt.run(req.project.id, target.user_id);
      project = removeStateUser(req.project, targetPublicId, { checkpoint: false });
    })();
    checkpointDatabase();
    req.project = project;
    req.membership = getMembership(project.id, req.user.id);
    req.roles = rolesFromJson(req.membership.roles_json);
    sendProject(req, res, project);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || "Server error." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Universal Labeling server listening on http://127.0.0.1:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (SECRET === "development-only-change-me") {
    console.log("Using development LABELING_SECRET; set LABELING_SECRET for shared deployments.");
  }
});
