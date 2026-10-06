const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DATA_FILE = path.join(DATA_DIR, 'southops-v4.json');
const TMP_FILE = path.join(DATA_DIR, 'southops-v4.tmp');
const LATEST_BACKUP = path.join(BACKUP_DIR, 'latest.json');
const SCHEMA_VERSION = 1;

let state;
let writeQueue = Promise.resolve();
let lastTimedBackup = 0;

function now() { return new Date().toISOString(); }
function id(prefix = 'id') { return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`; }
function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function newState() {
  return { schemaVersion: SCHEMA_VERSION, createdAt: now(), updatedAt: now(), guilds: {} };
}

function blankGuild() {
  return {
    config: {
      companyName: 'SouthOps',
      roles: { driver: null, controller: null, supervisor: null, admin: null },
      channels: { controlMessages: null, defects: null, requests: null, shiftActivity: null, audit: null, allocations: null },
      liveAllocationsMessageId: null,
      depots: []
    },
    profiles: {},
    duties: {},
    claims: {},
    fleet: {},
    allocations: [],
    defects: {},
    incidents: {},
    requests: {},
    controlMessages: {},
    audit: []
  };
}

function normalizeGuild(g) {
  const base = blankGuild();
  const out = { ...base, ...g };
  out.config = { ...base.config, ...(g.config || {}) };
  out.config.roles = { ...base.config.roles, ...(g.config?.roles || {}) };
  out.config.channels = { ...base.config.channels, ...(g.config?.channels || {}) };
  out.config.depots = Array.isArray(g.config?.depots) ? g.config.depots : [];
  for (const k of ['profiles','duties','claims','fleet','defects','incidents','requests','controlMessages']) {
    if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = {};
  }
  if (!Array.isArray(out.allocations)) out.allocations = [];
  if (!Array.isArray(out.audit)) out.audit = [];
  return out;
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DATA_FILE)) {
    state = newState();
    persistSync(false);
    return state;
  }
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (fs.existsSync(LATEST_BACKUP)) {
      state = JSON.parse(fs.readFileSync(LATEST_BACKUP, 'utf8'));
      persistSync(false);
    } else {
      throw new Error(`SouthOps data file could not be read and no backup exists: ${err.message}`);
    }
  }
  if (!state.guilds) state.guilds = {};
  for (const gid of Object.keys(state.guilds)) state.guilds[gid] = normalizeGuild(state.guilds[gid]);
  migrate();
  return state;
}

function migrate() {
  const current = Number(state.schemaVersion || 0);
  if (current > SCHEMA_VERSION) throw new Error(`Database schema ${current} is newer than this bot supports (${SCHEMA_VERSION}).`);
  // Future migrations are added here. NEVER replace/reset user data.
  state.schemaVersion = SCHEMA_VERSION;
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupSync(forceTimed = false) {
  ensureDirs();
  if (!fs.existsSync(DATA_FILE)) return;
  fs.copyFileSync(DATA_FILE, LATEST_BACKUP);
  const t = Date.now();
  if (forceTimed || t - lastTimedBackup > 10 * 60 * 1000) {
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `southops-${timestampName()}.json`));
    lastTimedBackup = t;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('southops-') && f.endsWith('.json'))
      .sort();
    while (files.length > 30) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    }
  }
}

function persistSync(makeBackup = true) {
  ensureDirs();
  state.updatedAt = now();
  if (makeBackup) backupSync(false);
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf8');

  // Best-effort durability flush. Some Windows/filesystem combinations reject
  // fsync with EPERM even though the file was written successfully. Never let
  // that optional flush prevent SouthOps from starting or saving its data.
  let fd;
  try {
    fd = fs.openSync(TMP_FILE, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    if (!['EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }

  try {
    fs.renameSync(TMP_FILE, DATA_FILE);
  } catch {
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
    fs.renameSync(TMP_FILE, DATA_FILE);
  }
}

function ensureGuild(guildId) {
  if (!state) load();
  if (!state.guilds[guildId]) state.guilds[guildId] = blankGuild();
  state.guilds[guildId] = normalizeGuild(state.guilds[guildId]);
  return state.guilds[guildId];
}

async function mutateGuild(guildId, mutator) {
  writeQueue = writeQueue.then(async () => {
    const guild = ensureGuild(guildId);
    const result = await mutator(guild);
    persistSync(true);
    return result;
  });
  return writeQueue;
}

function getGuild(guildId) { return ensureGuild(guildId); }
function snapshot() { return JSON.parse(JSON.stringify(state)); }
function backupNow() { backupSync(true); return LATEST_BACKUP; }

function audit(guild, type, actorId, data = {}) {
  guild.audit.push({ id: id('evt'), type, actorId, at: now(), data });
  if (guild.audit.length > 10000) guild.audit.splice(0, guild.audit.length - 10000);
}

function activeClaimForUser(guild, userId) {
  return Object.values(guild.claims).find(c => c.userId === userId && ['claimed','on_duty'].includes(c.status)) || null;
}
function findDuty(guild, dutyRef) {
  if (!dutyRef) return null;
  if (guild.duties[dutyRef]) return guild.duties[dutyRef];
  const matches = Object.values(guild.duties).filter(d => String(d.number).toLowerCase() === String(dutyRef).toLowerCase());
  const active = matches.filter(d => ['available','claimed','on_duty'].includes(d.status)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return active[0] || matches.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0] || null;
}
function activeClaimForDuty(guild, dutyRef) {
  const duty = findDuty(guild, dutyRef);
  if (!duty) return null;
  return Object.values(guild.claims).find(c => c.dutyId === duty.id && ['claimed','on_duty'].includes(c.status)) || null;
}
function openBreak(claim) { return claim?.breaks?.find(b => !b.endAt) || null; }
function msBetween(a, b) { return Math.max(0, new Date(b).getTime() - new Date(a).getTime()); }
function claimBreakMs(claim, endAt = now()) {
  return (claim.breaks || []).reduce((sum, b) => sum + msBetween(b.startAt, b.endAt || endAt), 0);
}
function claimWorkMs(claim, endAt = now()) {
  if (!claim.signedOnAt) return 0;
  const end = claim.signedOffAt || endAt;
  return Math.max(0, msBetween(claim.signedOnAt, end) - claimBreakMs(claim, end));
}

function allocationsForClaim(guild, claim) {
  if (!claim.signedOnAt) return [];
  const start = new Date(claim.signedOnAt).getTime();
  const end = new Date(claim.signedOffAt || now()).getTime();
  return guild.allocations.filter(a => {
    if (a.dutyId !== claim.dutyId) return false;
    const aStart = new Date(a.fromAt).getTime();
    const aEnd = new Date(a.toAt || now()).getTime();
    return aStart < end && aEnd > start;
  });
}

function vehicleMsForClaim(guild, claim, allocation) {
  const start = Math.max(new Date(claim.signedOnAt).getTime(), new Date(allocation.fromAt).getTime());
  const end = Math.min(new Date(claim.signedOffAt || now()).getTime(), new Date(allocation.toAt || now()).getTime());
  return Math.max(0, end - start);
}

function driverStats(guild, userId) {
  const claims = Object.values(guild.claims).filter(c => c.userId === userId);
  const completed = claims.filter(c => c.status === 'completed');
  const signedClaims = claims.filter(c => c.signedOnAt);
  const workMs = signedClaims.reduce((s,c) => s + claimWorkMs(c), 0);
  const breakMs = signedClaims.reduce((s,c) => s + claimBreakMs(c, c.signedOffAt || now()), 0);
  const routeCounts = {};
  for (const c of completed) {
    const duty = guild.duties[c.dutyId];
    for (const r of duty?.routes || []) routeCounts[r] = (routeCounts[r] || 0) + 1;
  }
  const vehicleCounts = {}, vehicleMs = {};
  for (const c of signedClaims) {
    for (const a of allocationsForClaim(guild, c)) {
      vehicleCounts[a.vehicle] = (vehicleCounts[a.vehicle] || 0) + 1;
      vehicleMs[a.vehicle] = (vehicleMs[a.vehicle] || 0) + vehicleMsForClaim(guild, c, a);
    }
  }
  const defects = Object.values(guild.defects).filter(d => d.reporterId === userId).length;
  const requests = Object.values(guild.requests).filter(r => r.userId === userId).length;
  const incidents = Object.values(guild.incidents).filter(i => i.userId === userId).length;
  return {
    claims: claims.length,
    completed: completed.length,
    workMs,
    drivingMs: workMs,
    breakMs,
    routeCounts,
    vehicleCounts,
    vehicleMs,
    defects,
    requests,
    incidents
  };
}

function activeDriversForRoutes(guild, routes) {
  const wanted = new Set(routes.map(x => x.trim().toLowerCase()).filter(Boolean));
  const ids = new Set();
  for (const c of Object.values(guild.claims)) {
    if (c.status !== 'on_duty') continue;
    const duty = guild.duties[c.dutyId];
    if ((duty?.routes || []).some(r => wanted.has(String(r).toLowerCase()))) ids.add(c.userId);
  }
  return [...ids];
}
function activeDriversForDuties(guild, duties) {
  const wanted = new Set(duties.map(x => x.trim().toLowerCase()).filter(Boolean));
  return [...new Set(Object.values(guild.claims)
    .filter(c => c.status === 'on_duty' && wanted.has(String(c.dutyNumber).toLowerCase()))
    .map(c => c.userId))];
}
function allActiveDrivers(guild) {
  return [...new Set(Object.values(guild.claims).filter(c => c.status === 'on_duty').map(c => c.userId))];
}

load();

module.exports = {
  now, id, getGuild, mutateGuild, snapshot, backupNow, audit,
  activeClaimForUser, activeClaimForDuty, findDuty, openBreak, claimWorkMs, claimBreakMs,
  allocationsForClaim, driverStats, activeDriversForRoutes, activeDriversForDuties, allActiveDrivers,
  DATA_FILE, BACKUP_DIR
};
