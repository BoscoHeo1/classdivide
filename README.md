# classdivide

보스코쌤 초등학교 학급 편성 프로그램

초등학교 현장 선생님들의 피로를 덜어드리기 위해 개발된 지능형 학급편성 시스템입니다.  
단독 엑셀 일괄 배정 모드와 동학년 담임교사 간 실시간 협업 배정 모드를 모두 지원합니다.

---

## 🌐 운영 URL

- **공식 운영 서비스 링크**: [https://boscoheo1.github.io/classdivide/](https://boscoheo1.github.io/classdivide/)
- **교사용 매뉴얼**: 앱 내 [📖 교사용 사용설명서] 모달 또는 [`USER_MANUAL.md`](./USER_MANUAL.md) 참조

---

## 🛠️ 기술 스택

실제 프로젝트 구성 기준:

- **Frontend**:
  - React 19 (`^19.2.3`)
  - TypeScript (`~5.8.2`)
  - Vite 6 (`^6.2.0`)
  - Tailwind CSS (CDN)
  - Lucide React (`^0.561.0`)
  - SheetJS / xlsx (`^0.18.5`)
- **Backend & Database**:
  - Firebase Realtime Database (RTDB) - 학급편성 실시간 협업 및 데이터 동기화
  - Firebase Authentication - 익명 인증 (`signInAnonymously`) 기반 세션 관리
  - Firebase Cloud Functions (v2) - 관리자 복구 코드 발급 및 보안 처리 (`functions/`)
- **Hosting**:
  - GitHub Pages (`gh-pages` 브랜치 기반)

---

## 💻 로컬 개발 환경

### 1. 의존성 설치
```bash
# 일반 개발 환경 설치
npm install

# 또는 package-lock.json 기준 클린 설치
npm ci
```

### 2. 로컬 개발 서버 실행
```bash
npm run dev
```
- 기본 로컬 주소: `http://localhost:3000/classdivide/` (Vite `base: '/classdivide/'` 설정 적용)

---

## 📦 프로덕션 빌드

```bash
npm run build
```
- 번들링 결과물은 프로젝트 루트의 `dist/` 폴더에 생성됩니다.
- 프로덕션 빌드 전 TypeScript 타입 및 번들링 에러가 없는지 확인합니다.

---

## 🚀 GitHub Pages 운영 배포

현재 실제 운영 서비스는 GitHub Pages를 통해 배포됩니다.

### 배포 명령
```bash
# 1. 프로덕션 빌드
npm run build

# 2. gh-pages 브랜치로 빌드 산출물 발행
npx -y gh-pages -d dist
```

### 배포 파이프라인 구조
```
main 브랜치 (소스 코드)
  └─► npm run build (dist 폴더 생성)
        └─► npx gh-pages -d dist (gh-pages 브랜치로 푸시)
              └─► GitHub Pages 빌트인 파이프라인 (pages-build-deployment 자동 실행)
                    └─► 프로덕션 서빙 (https://boscoheo1.github.io/classdivide/)
```

- **Vite base**: `/classdivide/`
- **배포 브랜치**: `gh-pages`

---

## 🔒 Firebase RTDB Rules 배포

### 배포 대상 파일
- `database.rules.json`

### 배포 명령
```bash
npx firebase-tools deploy --only database
```

### ⚠️ Rules 배포 주의사항
- **Hosting 배포 명령이 아닙니다**: 본 프로젝트의 웹 호스팅은 GitHub Pages를 사용하므로 `firebase deploy --only hosting`을 실행하지 않습니다.
- **Functions를 함께 배포하지 않습니다**: 반드시 `--only database` 플래그를 사용하여 RTDB Rules만 독립 배포합니다.
- **사전 백업 및 diff 확인**: Rules를 수정/배포하기 전에는 반드시 이전 Rules를 로컬 백업(`database.rules.before-*.json`)하고 `git diff`를 통해 변경 내용을 철저히 검증합니다.

---

## ☁️ Firebase Functions

- 관리자 권한 복구 토큰 발급 및 보안 관리를 위한 함수 소스가 `functions/` 디렉토리에 위치합니다.
- Functions 배포는 검증된 운영 절차에 따라 신중히 개별 진행하며, 일반 프론트엔드/Rules 배포 시에는 함께 배포하지 않습니다.

---

## 🌿 Git 브랜치 운용 규칙

- **`main`**: 전체 소스 코드 및 기능 개발의 단일 진실 공급원(SSOT) 기준 브랜치입니다.
- **`gh-pages`**: 프로덕션 빌드 산출물(`dist`) 서빙 전용 브랜치입니다. 직접 소스 코드를 수정하거나 개발 커밋을 작성하지 않습니다.

---

## 📌 최근 운영 기준점 (2026-09-18 기준)

- **`main` 브랜치 기준 커밋**: `b7a481a4bc81bf4e128dda8721c2a5f093c3aa75` (최신 Bosco UI 및 협업 모드 쌍둥이 그룹 매칭 반영)
- **`gh-pages` 브랜치 배포 커밋**: `078b9cf777ef5b87fd3160662eb04ce1ec6747fa`

---

## 🛡️ 중요 보안 및 운영 원칙

1. **환경 변수 및 시크릿 보호**: `.env` 등 민감한 설정 파일은 절대 Git에 커밋하지 않습니다 (`.gitignore` 적용).
2. **시크릿 키 노출 금지**: 실제 서비스의 관리자 키, 서비스 계정 비밀키 등을 코드나 문서에 하드코딩하지 않습니다.
3. **로컬 백업 보존**: 배포 전 생성된 롤백용 규칙 백업 파일(`database.rules.before-*.json`)은 로컬에만 보존하며, Git 추적 대상에서 제외되어 있습니다.
4. **운영 데이터 보호**: 실서버 기능 테스트 시에는 운영 중인 실제 학급 데이터를 건드리지 않고, 별도의 임의 테스트 방 코드를 생성하여 테스트를 진행합니다.
