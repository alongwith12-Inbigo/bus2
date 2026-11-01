import { AdminRole } from '../types';

interface AuthStorageState {
  salt: string;
  hash: string;
}

interface FailedAttemptState {
  count: number;
  last: number;
  until: number;
}

const DEFAULT_CREDENTIALS: Record<AdminRole, string> = {
  '1': '1111',
  '2': '2222',
  'master': '0000'
};

async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashWithSalt(salt: string, password: string): Promise<string> {
  let h = await sha256(salt + ':' + password);
  for (let i = 0; i < 200; i++) {
    h = await sha256(h);
  }
  return h;
}

const STORAGE_KEY_AUTH = 'workshop_bus_auth_v2';
const STORAGE_KEY_FAILS = 'workshop_bus_fails_v2';
const STORAGE_KEY_SESSION = 'workshop_bus_session_v2';

export interface AdminSession {
  token: string;
  role: AdminRole;
  expiresAt: number;
}

async function getStoredAuth(): Promise<Record<AdminRole, AuthStorageState>> {
  const raw = localStorage.getItem(STORAGE_KEY_AUTH);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fallback
    }
  }

  // Initialize with default salts & hashes
  const initial: Record<AdminRole, AuthStorageState> = {} as any;
  for (const role of ['1', '2', 'master'] as AdminRole[]) {
    const salt = crypto.randomUUID();
    const hash = await hashWithSalt(salt, DEFAULT_CREDENTIALS[role]);
    initial[role] = { salt, hash };
  }
  localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(initial));
  return initial;
}

export async function loginAdmin(role: AdminRole, passwordInput: string): Promise<AdminSession> {
  const now = Date.now();
  const rawFails = localStorage.getItem(STORAGE_KEY_FAILS);
  const fails: Record<string, FailedAttemptState> = rawFails ? JSON.parse(rawFails) : {};
  const failInfo = fails[role] || { count: 0, last: 0, until: 0 };

  if (failInfo.until > now) {
    const remainMin = Math.ceil((failInfo.until - now) / 60000);
    throw new Error(`로그인 시도가 많습니다. ${remainMin}분 후 다시 시도하세요.`);
  }

  const authRecords = await getStoredAuth();
  const target = authRecords[role];
  if (!target) {
    throw new Error('관리자 인증 정보가 설정되지 않았습니다.');
  }

  const computed = await hashWithSalt(target.salt, passwordInput.trim());
  if (computed !== target.hash) {
    const recent = failInfo.last && now - failInfo.last < 15 * 60 * 1000;
    const newCount = (recent ? failInfo.count : 0) + 1;
    const until = newCount >= 5 ? now + 15 * 60 * 1000 : 0;
    fails[role] = { count: newCount, last: now, until };
    localStorage.setItem(STORAGE_KEY_FAILS, JSON.stringify(fails));

    if (newCount >= 5) {
      throw new Error('비밀번호 오류 5회 누적: 15분간 로그인이 제한됩니다.');
    }
    throw new Error(`비밀번호가 일치하지 않습니다. (오류 ${newCount}/5회)`);
  }

  // Reset fail count on successful login
  delete fails[role];
  localStorage.setItem(STORAGE_KEY_FAILS, JSON.stringify(fails));

  const session: AdminSession = {
    token: crypto.randomUUID(),
    role,
    expiresAt: now + 3600 * 1000 // 1 hour
  };
  sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
  return session;
}

export function getActiveSession(): AdminSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY_SESSION);
  if (!raw) return null;
  try {
    const s: AdminSession = JSON.parse(raw);
    if (s.expiresAt > Date.now()) {
      return s;
    }
    sessionStorage.removeItem(STORAGE_KEY_SESSION);
    return null;
  } catch {
    return null;
  }
}

export function logoutAdmin(): void {
  sessionStorage.removeItem(STORAGE_KEY_SESSION);
}

export async function updateAdminPassword(
  role: AdminRole,
  newPassword: string
): Promise<void> {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('비밀번호는 최소 4자리 이상이어야 합니다.');
  }
  const authRecords = await getStoredAuth();
  const salt = crypto.randomUUID();
  const hash = await hashWithSalt(salt, newPassword.trim());
  authRecords[role] = { salt, hash };
  localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(authRecords));
}
