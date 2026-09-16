// 과제용 간단한 파일 기반 저장소입니다.
// 실제 서비스에서는 SQLite/PostgreSQL 같은 영구 저장소를 권장합니다.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function emptyDb() {
  return {
    users: {},
    usersByName: {},
    credentials: {},
    challenges: {}, // challengeKey -> { challenge, userId, createdAt, expiresAt }
    sessions: {},  // sessionId -> { userId, createdAt, expiresAt }
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

function getUserByUsername(username) {
  const db = load();
  const name = normalizeUsername(username);
  const id = db.usersByName[name];
  return id ? db.users[id] : null;
}

function getUserById(userId) {
  const db = load();
  return db.users[userId] || null;
}

function createUser(userId, username) {
  const db = load();
  const name = normalizeUsername(username);
  const now = new Date().toISOString();
  db.users[userId] = {
    id: userId,
    username: name,
    createdAt: now,
    items: [
      {
        id: 'seed-1',
        title: '진행 중인 프로젝트 메모',
        body: '패스키 로그인 과제의 등록·로그인·삭제 흐름을 점검하는 중입니다.',
      },
      {
        id: 'seed-2',
        title: '보안 학습 기록',
        body: 'WebAuthn의 challenge와 공개키 검증 흐름을 직접 확인했습니다.',
      },
      {
        id: 'seed-3',
        title: '다음 점검 항목',
        body: '두 번째 패스키 등록과 삭제 후 잔여 패스키 로그인 테스트를 진행합니다.',
      },
    ],
  };
  db.usersByName[name] = userId;
  save(db);
  return db.users[userId];
}

function addCredential(cred) {
  const db = load();
  db.credentials[cred.credentialID] = cred;
  save(db);
}

function getCredentialById(credentialID) {
  const db = load();
  return db.credentials[credentialID] || null;
}

function getCredentialsByUserId(userId) {
  const db = load();
  return Object.values(db.credentials).filter((c) => c.userId === userId);
}

function updateCredentialCounter(credentialID, newCounter) {
  const db = load();
  if (db.credentials[credentialID]) {
    db.credentials[credentialID].counter = newCounter;
    save(db);
  }
}

function deleteCredential(credentialID, userId) {
  const db = load();
  const cred = db.credentials[credentialID];
  if (!cred || cred.userId !== userId) return false;
  delete db.credentials[credentialID];
  save(db);
  return true;
}

function setChallenge(key, challenge, userId, ttlMs = 5 * 60 * 1000) {
  const db = load();
  const now = Date.now();
  db.challenges[key] = {
    challenge,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  save(db);
}

function consumeChallenge(key) {
  const db = load();
  const val = db.challenges[key] || null;
  delete db.challenges[key];
  save(db);
  if (!val) return null;
  if (Date.now() >= Date.parse(val.expiresAt)) return null;
  return val;
}

function createSession(sessionId, userId, ttlMs = 2 * 60 * 60 * 1000) {
  const db = load();
  const now = Date.now();
  db.sessions[sessionId] = {
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  save(db);
}

function getSession(sessionId) {
  const db = load();
  const session = db.sessions[sessionId] || null;
  if (!session) return null;
  if (Date.now() >= Date.parse(session.expiresAt)) {
    delete db.sessions[sessionId];
    save(db);
    return null;
  }
  return session;
}

function deleteSession(sessionId) {
  const db = load();
  delete db.sessions[sessionId];
  save(db);
}

function getItems(userId) {
  const db = load();
  return db.users[userId] ? db.users[userId].items : [];
}

module.exports = {
  getUserByUsername,
  getUserById,
  createUser,
  addCredential,
  getCredentialById,
  getCredentialsByUserId,
  updateCredentialCounter,
  deleteCredential,
  setChallenge,
  consumeChallenge,
  createSession,
  getSession,
  deleteSession,
  getItems,
};
