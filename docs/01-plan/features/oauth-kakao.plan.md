# Plan: Kakao OAuth — 카카오 로그인 추가

> Created: 2026-04-12

## Executive Summary

| 관점 | 설명 |
|------|------|
| **Problem** | Google 계정이 없는 사용자, 카카오 메신저 연동을 원하는 사용자가 로그인 불가 |
| **Solution** | Supabase Auth에 카카오 OAuth provider 추가 — 카카오가 인증 담당, 우리는 JWT만 수신 |
| **Function UX Effect** | 로그인 화면에 "카카오로 로그인" 버튼 추가, 기존 Google 로그인 유지 |
| **Core Value** | 국내 사용자 접근성 향상 + 차후 카카오 메신저 봇 연동의 기반 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 카카오 사용자 접근성 + 메신저 봇 연동 전제 조건 |
| **WHO** | 카카오 계정 보유 한국 사용자 |
| **RISK** | 카카오 앱 설정 오류, Redirect URL 불일치 |
| **SUCCESS** | 카카오 계정으로 로그인 후 기존 기능 모두 동작 |
| **SCOPE** | 카카오 앱 등록 + Supabase 설정 + 웹앱 버튼 추가 |

---

## 1. 요구사항

| ID | 요구사항 |
|----|----------|
| F1 | 카카오 계정으로 로그인 가능 |
| F2 | 기존 Google 로그인 계속 동작 |
| F3 | 로그인 후 기존 앱 기능 모두 동작 (tasks, shared calendar 등) |
| F4 | GitHub Pages + Cloudflare Pages 둘 다 동작 |
| F5 | 카카오 계정 = Supabase user (동일한 DB, RLS 적용) |

## 2. 구현 단계

| 단계 | 위치 | 내용 |
|------|------|------|
| 1 | developers.kakao.com | 앱 등록 + REST API 키 발급 |
| 2 | developers.kakao.com | Redirect URI 등록 |
| 3 | Supabase 대시보드 | Kakao provider 활성화 + 키 입력 |
| 4 | auth.js | 카카오 로그인 함수 추가 |
| 5 | index.html | "카카오로 로그인" 버튼 추가 |

## 3. 필요한 정보 (카카오 개발자 콘솔에서)

- **REST API 키** (Client ID)
- **Client Secret** (보안 강화 시)
- **Redirect URI**: 
  - `https://urkytivapfgzenpvflce.supabase.co/auth/v1/callback`

## 4. 성공 기준

| ID | 기준 |
|----|------|
| SC1 | 카카오 버튼 클릭 → 카카오 로그인 화면 이동 |
| SC2 | 로그인 성공 → 앱 화면 진입 |
| SC3 | 기존 Google 로그인 영향 없음 |
| SC4 | GitHub Pages + Cloudflare Pages 둘 다 동작 |

## 5. 리스크

| 리스크 | 대응 |
|--------|------|
| Redirect URI 불일치 | Supabase callback URL을 정확히 등록 |
| 카카오 앱 심사 | 테스트 사용자로 먼저 동작 확인 |
| 기존 사용자 충돌 | 같은 이메일 → Supabase가 자동 연결 처리 |
