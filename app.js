import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from 'https://unpkg.com/@simplewebauthn/browser@13.1.0/dist/bundle/index.js';

const $ = (id) => document.getElementById(id);
const loggedOutView = $('logged-out-view');
const loggedInView = $('logged-in-view');
const authMessage = $('auth-message');
const passkeysMessage = $('passkeys-message');

function setMessage(el, text, type) {
  el.textContent = text || '';
  el.className = 'message' + (type ? ` ${type}` : '');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function doRegister(username, deviceName, messageEl) {
  if (!username) return setMessage(messageEl, '아이디를 먼저 입력해 주세요.', 'error');
  try {
    setMessage(messageEl, '패스키 생성 중... 기기의 인증 창을 확인하세요.');
    const options = await api('/api/register/options', { method:'POST', body:{ username } });

    let credential;
    try {
      credential = await startRegistration({ optionsJSON: options });
    } catch (_) {
      setMessage(messageEl, '등록이 취소되었습니다. 검증 완료 전에는 새 사용자나 패스키가 저장되지 않습니다.', 'error');
      return;
    }

    await api('/api/register/verify', {
      method:'POST',
      body:{ username, deviceName, credential },
    });

    setMessage(messageEl, '패스키 등록 완료! 이제 패스키로 로그인할 수 있습니다.', 'success');
    $('device-name').value = '';
    $('device-name-2').value = '';
  } catch (err) {
    console.error(err);
    setMessage(messageEl, `등록 실패: ${err.message}`, 'error');
  }
}

async function doLogin(username) {
  if (!username) return setMessage(authMessage, '아이디를 먼저 입력해 주세요.', 'error');
  try {
    setMessage(authMessage, '로그인 중... 기기의 인증 창을 확인하세요.');
    const options = await api('/api/login/options', { method:'POST', body:{ username } });
    let credential;
    try {
      credential = await startAuthentication({ optionsJSON: options });
    } catch (_) {
      setMessage(authMessage, '로그인이 취소되었습니다.', 'error');
      return;
    }

    const result = await api('/api/login/verify', {
      method:'POST',
      body:{ username, credential },
    });
    setMessage(authMessage, '', null);
    await enterPrivateArea(result.username);
  } catch (err) {
    console.error(err);
    setMessage(authMessage, `로그인 실패: ${err.message}`, 'error');
  }
}

async function enterPrivateArea(username) {
  loggedOutView.hidden = true;
  loggedInView.hidden = false;
  $('welcome-username').textContent = username;
  try {
    await Promise.all([loadItems(), loadPasskeys()]);
  } catch (err) {
    console.error(err);
    if (err.status === 401) await doLogout();
  }
}

async function loadItems() {
  const data = await api('/api/private/items');
  const ul = $('items-list');
  ul.replaceChildren();
  $('items-empty').hidden = data.items.length !== 0;
  for (const item of data.items) {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const body = document.createTextNode(item.body);
    li.append(title, body);
    ul.appendChild(li);
  }
}

async function loadPasskeys() {
  const data = await api('/api/passkeys');
  const ul = $('passkeys-list');
  ul.replaceChildren();
  $('passkeys-empty').hidden = data.passkeys.length !== 0;

  for (const pk of data.passkeys) {
    const li = document.createElement('li');
    const info = document.createElement('span');
    const date = new Date(pk.createdAt).toLocaleString('ko-KR');
    info.innerHTML = `${escapeHtml(pk.deviceName)} <span class="passkey-meta">(등록일: ${escapeHtml(date)})</span>`;

    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.className = 'btn-danger';
    delBtn.addEventListener('click', () => deletePasskey(pk.id, data.passkeys.length));
    li.append(info, delBtn);
    ul.appendChild(li);
  }
}

async function deletePasskey(id, currentCount) {
  const isLast = currentCount <= 1;
  const warning = isLast
    ? '이것이 마지막 남은 패스키입니다. 지우면 이 계정으로 다시 로그인할 수 없습니다. 정말 삭제할까요?'
    : '이 패스키를 삭제할까요?';
  if (!window.confirm(warning)) return;

  try {
    const result = await api(`/api/passkeys/${encodeURIComponent(id)}`, { method:'DELETE' });
    setMessage(passkeysMessage, `삭제되었습니다. 남은 패스키: ${result.remainingCount}개`, 'success');
    await loadPasskeys();
  } catch (err) {
    setMessage(passkeysMessage, `삭제 실패: ${err.message}`, 'error');
  }
}

async function doLogout() {
  try { await api('/api/logout', { method:'POST' }); } catch (_) {}
  loggedInView.hidden = true;
  loggedOutView.hidden = false;
  $('username').value = '';
  setMessage(authMessage, '로그아웃되었습니다.', 'success');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

$('btn-register').addEventListener('click', () => {
  doRegister($('username').value.trim(), $('device-name').value.trim(), authMessage);
});
$('btn-login').addEventListener('click', () => doLogin($('username').value.trim()));
$('btn-logout').addEventListener('click', doLogout);
$('btn-register-more').addEventListener('click', async () => {
  const username = $('welcome-username').textContent.trim();
  await doRegister(username, $('device-name-2').value.trim(), passkeysMessage);
  await loadPasskeys();
});

$('focus-button').addEventListener('click', () => {
  const el = $('focus-message');
  el.textContent = el.textContent.includes('네트워크와 웹 보안')
    ? '현재 관심 분야는 침해사고 대응과 보안 문제 분석입니다.'
    : '현재 관심 분야는 네트워크와 웹 보안입니다.';
});

(async function init() {
  if (!browserSupportsWebAuthn()) {
    setMessage(authMessage, '이 브라우저는 패스키(WebAuthn)를 지원하지 않습니다.', 'error');
    $('btn-login').disabled = true;
    $('btn-register').disabled = true;
    return;
  }

  try {
    const me = await api('/api/me');
    if (me.loggedIn) await enterPrivateArea(me.username);
  } catch (err) {
    console.error(err);
  }
})();
