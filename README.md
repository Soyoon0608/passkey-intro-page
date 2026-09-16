# 패스키로 잠근 나만의 자리

1번 과제 `my-portfolio`의 공개 포트폴리오 내용을 유지하면서, 8번 과제에서 요구하는 **패스키(WebAuthn) 기반 비공개 영역**을 별도 Express 프로젝트로 붙인 결과물입니다.

## 저장소 역할

- `my-portfolio`: 1번 과제 원본. 이 저장소는 수정하지 않는 것을 권장합니다.
- `passkey-intro-page`: 8번 과제 결과물. 공개 소개 영역 + 패스키 보호 영역이 한 페이지에 있습니다.

현재 공개 영역의 내용은 `my-portfolio`의 실제 `index.html`에 있던 소개·활동·근거 내용을 반영했습니다. 원본 저장소에는 소개, 활동, 근거, 상호작용 섹션이 있습니다.

## 주요 구현

- `@simplewebauthn/server`로 등록/로그인 검증
- `@simplewebauthn/browser`로 브라우저 패스키 호출
- 등록/로그인 challenge를 서버에 저장하고 5분 TTL + 1회 사용
- 서버 세션을 불투명 랜덤 토큰으로 관리하고 2시간 TTL 적용
- `httpOnly` 세션 쿠키 사용
- 서버가 공개키만 저장
- 비공개 자료는 인증된 세션의 사용자 ID로만 조회
- 패스키 여러 개 등록/삭제
- 마지막 패스키 삭제 전 경고
- 비공개 API 로그인 전 접근 차단

## 실행

```bash
npm install
cp .env.example .env
npm start
```

Windows에서는 `.env.example`을 복사해 `.env`로 이름을 바꾸고 내용을 확인하세요.

접속: `http://localhost:3000`

## 로컬 WebAuthn 조건

`.env` 기본값은 다음과 같습니다.

```text
RP_ID=localhost
ORIGIN=http://localhost:3000
NODE_ENV=development
```

패스키를 실제 등록/로그인할 때는 동일한 Origin으로 접속하세요.

## 배포 주의

현재 저장소는 `data/db.json` 파일을 이용하는 과제용 저장 방식입니다. 서버가 계속 떠 있고 파일 디스크가 유지되는 환경에서는 시연할 수 있지만, 서버리스/에페메럴 파일시스템에서는 데이터가 유실될 수 있습니다. 실제 운영 배포 전에는 PostgreSQL/Supabase 같은 영구 저장소로 교체하는 것이 안전합니다.

## 제출 전 테스트

`TESTING.md`의 순서대로 테스트를 진행하고 실제 결과만 `DOCUMENTATION_TEMPLATE.md`에 기록하세요. 아직 브라우저에서 직접 확인하지 않은 항목은 통과로 표시하지 않습니다.
