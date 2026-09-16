# 과제 8 테스트 순서

아래 테스트는 **코드상 예상 결과와 실제 결과를 구분**해서 기록합니다. 실제 브라우저 동작을 확인하기 전에는 통과로 표시하지 마세요.

## 1. 공개/비공개 경계

```bash
curl -i http://localhost:3000/api/private/items
```

예상: `401`

```bash
curl -s http://localhost:3000/ | grep -i "진행 중인 프로젝트 메모"
```

예상: 출력 없음. 비공개 항목은 초기 HTML에 들어 있지 않습니다.

## 2. 등록

브라우저 DevTools → Network에서:

- `POST /api/register/options`의 `challenge` 확인
- 같은 옵션 요청을 두 번 보내 challenge가 다른지 확인
- `POST /api/register/verify` 성공 결과 확인
- `data/db.json`의 `credentials`에서 `publicKey`만 저장되는지 확인
- 패스키 등록 중 인증창을 취소한 경우 사용자가 생성되지 않았는지 확인
- 기기 이름과 등록일이 패스키 목록에 표시되는지 확인

## 3. 로그인

```bash
curl -s -X POST http://localhost:3000/api/login/options \
  -H "Content-Type: application/json" \
  -d '{"username":"soyoon"}'
```

두 번 실행해 `challenge`가 달라지는지 확인합니다.

실제 로그인 성공 후 Network의 `POST /api/login/verify` 요청을 같은 내용으로 재전송해 challenge 재사용이 거절되는지 확인합니다.

로그아웃 후 동일 세션 쿠키로:

```bash
curl -i http://localhost:3000/api/private/items -b cookie.txt
```

예상: `401`

## 4. 패스키 2개와 삭제

1. 한 계정에 다른 이름의 패스키 두 개 등록
2. 목록에서 두 개 모두 확인
3. 하나 삭제
4. 남은 하나로 로그인 성공 확인
5. 삭제한 credential로 재로그인을 시도하여 거절 또는 후보 제외 확인
6. 마지막 패스키 삭제 전 경고 확인

## 5. 계정 2개 교차 접근

1. `alice`, `bob` 각각 패스키 등록
2. 각각 로그인해 비공개 API가 자기 자료만 주는지 확인
3. 한 세션으로 `/api/private/items?username=bob` 같은 요청을 보내도 URL의 username을 신뢰하지 않는지 확인
4. 반대 계정 credential을 login verify에 넣어 서버가 소유권 검사를 하는지 확인

## 6. 배포 전 확인

- HTTPS Origin에서 패스키 동작 여부 확인
- `RP_ID`와 `ORIGIN`을 실제 도메인에 맞게 설정
- `data/db.json`이 배포 후에도 유지되는 환경인지 확인
