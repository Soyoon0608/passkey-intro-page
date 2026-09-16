require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const db = require('./db');

const app = express();

// 아직 계정이 없는 사용자도 등록 옵션을 받을 수 있어야 하므로, 사용자명으로부터
// 결정적(deterministic)인 userId를 계산한다. 이렇게 하면 "등록 옵션 요청" 단계에서
// DB에 아무것도 미리 만들어두지 않아도 되고, 등록이 검증까지 끝난 뒤에만 실제로
// 사용자를 생성해 저장한다 — 즉 등록을 중간에 취소하면 서버에는 정말 아무것도 남지 않는다.
function normalizeUsername(username) {
  return String(username || '').trim();
}

function deriveUserId(username) {
  return crypto.createHash('sha256').update(`user:${normalizeUsername(username)}`).digest('hex').slice(0, 32);
}

const PORT = process.env.PORT || 3000;
const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = process.env.RP_NAME || 'Passkey Intro Page';
const ORIGIN = process.env.ORIGIN || `http://localhost:${PORT}`;
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// 세션 유틸
// 서버가 발급한 불투명(opaque) 토큰을 httpOnly 쿠키에 담아 세션을 식별합니다.
// (JWT처럼 자체 서명된 토큰이 아니라, 서버 DB에 저장된 값과 대조하는 방식이라
//  로그아웃 시 서버가 즉시 그 값을 지워 무효화할 수 있습니다.)
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'session';

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD, // 배포(HTTPS) 환경에서는 true로 동작
    maxAge: 1000 * 60 * 60 * 2, // 2시간
    path: '/',
  });
}

function requireAuth(req, res, next) {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  const session = db.getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: '세션이 유효하지 않습니다. 다시 로그인해 주세요.' });
  }
  const user = db.getUserById(session.userId);
  if (!user) {
    return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
  }
  req.userId = user.id;
  req.username = user.username;
  next();
}

// ---------------------------------------------------------------------------
// 등록 (카드 2)
// ---------------------------------------------------------------------------

// 등록용 challenge를 만들어 보낸다. 값은 서버가 확인할 때까지 보관한다(T08-C19).
app.post('/api/register/options', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    if (username.length < 2 || username.length > 40) {
      return res.status(400).json({ error: '아이디를 2자 이상 입력해 주세요.' });
    }

    // 주의: 여기서는 아직 DB에 아무것도 쓰지 않는다 (T08-C25).
    const existingUser = db.getUserByUsername(username);
    const userId = existingUser ? existingUser.id : deriveUserId(username);
    const existingCredentials = existingUser ? db.getCredentialsByUserId(userId) : [];

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: username,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      // 이미 등록된 패스키는 등록 후보에서 제외한다 (카드 4의 "두 번째 패스키" 등록을 위해 필요)
      excludeCredentials: existingCredentials.map((c) => ({
        id: c.credentialID,
        transports: c.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // 요청마다 challenge가 다르다는 것은 options.challenge 값 자체가 매번 새로 생성되는 것으로 보장된다.
    db.setChallenge(`reg:${userId}`, options.challenge, userId);

    res.json(options);
  } catch (err) {
    console.error('register/options error', err);
    res.status(500).json({ error: '등록 옵션 생성 중 오류가 발생했습니다.' });
  }
});

// 브라우저가 만든 등록 응답(공개키 + 서명)을 검증하고, 공개키만 저장한다.
app.post('/api/register/verify', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const deviceName = normalizeUsername(req.body.deviceName);
    const { credential } = req.body;
    if (username.length < 2 || username.length > 40 || !credential) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    let user = db.getUserByUsername(username);
    const userId = user ? user.id : deriveUserId(username);

    const challengeRecord = db.consumeChallenge(`reg:${userId}`);
    if (!challengeRecord) {
      return res.status(400).json({ error: '등록 요청이 만료되었거나 이미 처리되었습니다. 처음부터 다시 시도해 주세요.' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
    } catch (err) {
      console.error('verifyRegistrationResponse failed', err);
      return res.status(400).json({ error: '패스키 등록 검증에 실패했습니다.' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: '패스키 등록을 확인할 수 없습니다.' });
    }

    const { credential: registeredCredential } = verification.registrationInfo;

    // 검증까지 통과한 이 시점에야 비로소 사용자를 생성한다 (없었다면).
    if (!user) {
      user = db.createUser(userId, username);
    }

    // 서버에는 오직 "공개키"만 저장한다. 개인키는 애초에 요청 본문(credential)에도 포함되지 않는다
    // — registrationInfo.credential.publicKey가 바로 그 공개키다. (T08-C21~23)
    db.addCredential({
      credentialID: registeredCredential.id, // base64url 문자열
      publicKey: Buffer.from(registeredCredential.publicKey).toString('base64'),
      counter: registeredCredential.counter,
      transports: registeredCredential.transports || [],
      userId: user.id,
      deviceName: (deviceName && deviceName.slice(0, 80)) || '이름 없는 패스키',
      createdAt: new Date().toISOString(),
    });

    res.json({ verified: true });
  } catch (err) {
    console.error('register/verify error', err);
    res.status(500).json({ error: '등록 처리 중 오류가 발생했습니다.' });
  }
});

// ---------------------------------------------------------------------------
// 로그인 (카드 3)
// ---------------------------------------------------------------------------

app.post('/api/login/options', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    if (!username || username.length > 40) {
      return res.status(400).json({ error: '아이디를 입력해 주세요.' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: '등록되지 않은 아이디입니다.' });
    }

    const credentials = db.getCredentialsByUserId(user.id);
    if (credentials.length === 0) {
      return res.status(404).json({ error: '이 계정에 등록된 패스키가 없습니다.' });
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'preferred',
      allowCredentials: credentials.map((c) => ({
        id: c.credentialID,
        transports: c.transports,
      })),
    });

    db.setChallenge(`auth:${user.id}`, options.challenge, user.id);

    res.json(options);
  } catch (err) {
    console.error('login/options error', err);
    res.status(500).json({ error: '로그인 옵션 생성 중 오류가 발생했습니다.' });
  }
});

app.post('/api/login/verify', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const { credential } = req.body;
    if (!username || username.length > 40 || !credential) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: '등록되지 않은 아이디입니다.' });
    }

    // 이미 한 번 쓴(또는 만료된) challenge라면 여기서 걸러진다 — 재사용 방지(T08-C31).
    const challengeRecord = db.consumeChallenge(`auth:${user.id}`);
    if (!challengeRecord) {
      return res.status(400).json({ error: '이미 사용되었거나 만료된 로그인 요청입니다. 처음부터 다시 시도해 주세요.' });
    }

    const storedCredential = db.getCredentialById(credential.id);

    // 이 아이디 계정 소유가 아닌 패스키(=남의 패스키)로 로그인을 시도한 경우.
    if (!storedCredential || storedCredential.userId !== user.id) {
      return res.status(403).json({ error: '이 계정에 등록되지 않은 패스키입니다.' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: storedCredential.credentialID,
          publicKey: Buffer.from(storedCredential.publicKey, 'base64'),
          counter: storedCredential.counter,
          transports: storedCredential.transports,
        },
      });
    } catch (err) {
      console.error('verifyAuthenticationResponse failed', err);
      return res.status(401).json({ error: '서명을 확인할 수 없습니다.' });
    }

    if (!verification.verified) {
      return res.status(401).json({ error: '로그인에 실패했습니다.' });
    }

    db.updateCredentialCounter(storedCredential.credentialID, verification.authenticationInfo.newCounter);

    const sessionId = crypto.randomBytes(32).toString('hex');
    db.createSession(sessionId, user.id);
    setSessionCookie(res, sessionId);

    res.json({ verified: true, username: user.username });
  } catch (err) {
    console.error('login/verify error', err);
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (sessionId) {
    db.deleteSession(sessionId); // 서버 쪽 세션을 즉시 폐기 — 같은 쿠키로 재요청해도 통하지 않는다(T08-C33)
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  const session = sessionId ? db.getSession(sessionId) : null;
  if (!session) return res.json({ loggedIn: false });
  const user = db.getUserById(session.userId);
  res.json({ loggedIn: true, username: user ? user.username : null });
});

// ---------------------------------------------------------------------------
// 비공개 자료 (카드 1)
// ---------------------------------------------------------------------------

app.get('/api/private/items', requireAuth, (req, res) => {
  const items = db.getItems(req.userId);
  res.json({ username: req.username, items });
});

// ---------------------------------------------------------------------------
// 패스키 관리 (카드 4)
// ---------------------------------------------------------------------------

app.get('/api/passkeys', requireAuth, (req, res) => {
  const list = db.getCredentialsByUserId(req.userId).map((c) => ({
    id: c.credentialID,
    deviceName: c.deviceName,
    createdAt: c.createdAt,
  }));
  res.json({ passkeys: list });
});

app.delete('/api/passkeys/:id', requireAuth, (req, res) => {
  const ok = db.deleteCredential(req.params.id, req.userId);
  if (!ok) {
    return res.status(404).json({ error: '해당 패스키를 찾을 수 없거나 삭제 권한이 없습니다.' });
  }
  const remaining = db.getCredentialsByUserId(req.userId).length;
  res.json({ deleted: true, remainingCount: remaining });
});

app.listen(PORT, () => {
  console.log(`passkey-intro-page listening on http://localhost:${PORT}`);
  console.log(`RP_ID=${RP_ID} ORIGIN=${ORIGIN}`);
});
