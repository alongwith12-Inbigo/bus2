import { AdminRole } from '../types';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

interface AuthRecord {
  role: AdminRole;
  salt: string;
  hash: string;
  updatedAt?: string;
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

const STORAGE_KEY_FAILS = 'workshop_bus_fails_v3';
const STORAGE_KEY_SESSION = 'workshop_bus_session_v3';

export interface AdminSession {
  token: string;
  role: AdminRole;
  expiresAt: number;
}

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

// Fetch auth record directly from Firestore (cloud-synced across all devices)
async function getRoleAuth(role: AdminRole): Promise<AuthRecord> {
  try {
    const ref = doc(db, 'admin_auth', role);
    const snap = await getDocFromServer(ref);

    if (snap.exists()) {
      return snap.data() as AuthRecord;
    }

    // If not created yet in Firestore, initialize with default PIN
    const salt = crypto.randomUUID();
    const hash = await hashWithSalt(salt, DEFAULT_CREDENTIALS[role]);
    const initialRecord: AuthRecord = {
      role,
      salt,
      hash,
      updatedAt: new Date().toISOString()
    };
    await setDoc(ref, initialRecord);
    return initialRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `admin_auth/${role}`);
  }
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

  // Get cloud-synced credential from Firestore
  const target = await getRoleAuth(role);
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

// Update password in Firestore so all devices (phones, PCs, tablets) are instantly synchronized
export async function updateAdminPassword(
  role: AdminRole,
  newPassword: string
): Promise<void> {
  const trimmed = newPassword.trim();
  if (!trimmed || trimmed.length < 4) {
    throw new Error('비밀번호는 최소 4자리 이상이어야 합니다.');
  }

  const salt = crypto.randomUUID();
  const hash = await hashWithSalt(salt, trimmed);
  const now = new Date().toISOString();

  const record: AuthRecord = {
    role,
    salt,
    hash,
    updatedAt: now
  };

  try {
    // Save to Firestore admin_auth collection
    await setDoc(doc(db, 'admin_auth', role), record);

    // Audit log
    const logId = 'pw_' + Date.now();
    await setDoc(doc(db, 'logs', logId), {
      id: logId,
      timestamp: now,
      role: '관리자',
      action: '비밀번호변경',
      detail: `${role === 'master' ? '총괄 관리자' : role + '호차 관리자'} 비밀번호가 클라우드에 갱신되었습니다.`
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `admin_auth/${role}`);
  }
}
