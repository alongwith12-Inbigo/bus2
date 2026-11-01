import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  Person,
  BoardingRecord,
  OperationalSetting,
  BusContact,
  AuditLog,
  Phase,
  BoardingStatus,
  AdminRole,
  INITIAL_PEOPLE_SEED,
  INITIAL_CONTACTS_SEED
} from '../types';

export function maskName(name: string): string {
  const n = String(name || '').trim();
  if (n.length === 3) return n[0] + '*' + n[2];
  if (n.length > 2) return n[0] + '*'.repeat(n.length - 2) + n.slice(-1);
  return n;
}

// Subscribe to real-time collections
export function subscribePeople(
  onData: (people: Person[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'people');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: Person[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as Person;
        list.push({ ...data, id: data.id || d.id });
      });
      // Sort numerically by ID
      list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      onData(list);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, 'people');
    }
  );
}

export function subscribeRecords(
  onData: (records: Record<string, BoardingRecord>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'records');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map: Record<string, BoardingRecord> = {};
      snapshot.forEach((d) => {
        const data = d.data() as BoardingRecord;
        map[`${data.id}|${data.phase}`] = data;
      });
      onData(map);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, 'records');
    }
  );
}

export function subscribeSettings(
  onData: (settings: Record<string, OperationalSetting>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'settings');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map: Record<string, OperationalSetting> = {};
      snapshot.forEach((d) => {
        const data = d.data() as OperationalSetting;
        map[`${data.phase}|${data.bus}`] = data;
      });
      onData(map);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, 'settings');
    }
  );
}

export function subscribeContacts(
  onData: (contacts: Record<number, BusContact>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'contacts');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map: Record<number, BusContact> = {};
      snapshot.forEach((d) => {
        const data = d.data() as BusContact;
        map[data.bus] = data;
      });
      onData(map);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, 'contacts');
    }
  );
}

// Ensure only basic operational settings exist without inserting sample data
export async function ensureBasicSettings(): Promise<void> {
  try {
    const settingsSnap = await getDocs(collection(db, 'settings'));
    if (!settingsSnap.empty) {
      return;
    }

    const batch = writeBatch(db);
    const phases: Phase[] = ['출발', '귀가'];
    const buses = [1, 2];
    for (const phase of phases) {
      for (const bus of buses) {
        const ref = doc(db, 'settings', `${phase}_${bus}`);
        const setting: OperationalSetting = {
          phase,
          bus,
          closed: false,
          final: false,
          at: ''
        };
        batch.set(ref, setting);
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'ensureBasicSettings');
  }
}

// Clear all people and records (Admin manual action)
export async function clearAllPeopleAndRecords(role: AdminRole): Promise<{ peopleCount: number; recordsCount: number }> {
  try {
    const peopleSnap = await getDocs(collection(db, 'people'));
    const recordsSnap = await getDocs(collection(db, 'records'));

    const batch = writeBatch(db);
    peopleSnap.forEach((d) => batch.delete(doc(db, 'people', d.id)));
    recordsSnap.forEach((d) => batch.delete(doc(db, 'records', d.id)));

    const logId = 'clear_' + Date.now();
    const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
    batch.set(doc(db, 'logs', logId), {
      id: logId,
      timestamp: new Date().toISOString(),
      role: roleName,
      action: '명단전체삭제',
      detail: `참가자 명단 ${peopleSnap.size}명 및 탑승기록 전체 삭제 완료`
    });

    await batch.commit();
    return { peopleCount: peopleSnap.size, recordsCount: recordsSnap.size };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'clearAllPeopleAndRecords');
  }
}

// Teacher self-check action
export async function submitSelfBoarding(
  person: Person,
  phase: Phase,
  settings: Record<string, OperationalSetting>,
  currentRecords: Record<string, BoardingRecord>
): Promise<void> {
  const bus = phase === '출발' ? person.out : person.back;
  const s = settings[`${phase}|${bus}`];
  if (s && (s.closed || s.final)) {
    throw new Error('해당 버스 체크가 마감되었습니다. 담당자에게 문의하세요.');
  }

  const existingRec = currentRecords[`${person.id}|${phase}`];
  if (existingRec && existingRec.status !== '미탑승') {
    throw new Error(`이미 '${existingRec.status}' 처리된 상태입니다. 담당자에게 문의하세요.`);
  }

  const recordId = `${person.id}_${phase}`;
  const now = new Date().toISOString();
  const newRecord: BoardingRecord = {
    id: person.id,
    phase,
    status: '탑승',
    at: now,
    by: '본인'
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'records', recordId), newRecord);

    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const log: AuditLog = {
      id: logId,
      timestamp: now,
      role: '선생님 본인',
      action: '탑승확인',
      targetId: person.id,
      detail: `${person.name} (${person.dept}, ${bus}호차, ${phase})`
    };
    batch.set(doc(db, 'logs', logId), log);

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `records/${recordId}`);
  }
}

// Admin set status for participant
export async function adminSetStatus(
  id: string,
  personName: string,
  phase: Phase,
  bus: number,
  newStatus: BoardingStatus,
  role: AdminRole,
  settings: Record<string, OperationalSetting>
): Promise<void> {
  const s = settings[`${phase}|${bus}`];
  if (s && (s.closed || s.final)) {
    throw new Error('마감 또는 최종 확인 상태입니다. 먼저 해제하세요.');
  }

  const recordId = `${id}_${phase}`;
  const now = new Date().toISOString();
  const record: BoardingRecord = {
    id,
    phase,
    status: newStatus,
    at: now,
    by: '관리자'
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'records', recordId), record);

    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
    const log: AuditLog = {
      id: logId,
      timestamp: now,
      role: roleName,
      action: '상태변경',
      targetId: id,
      detail: `${personName} (${phase} ${bus}호차) -> ${newStatus}`
    };
    batch.set(doc(db, 'logs', logId), log);

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `records/${recordId}`);
  }
}

// Admin set closed (체크 마감 / 재개)
export async function adminSetClosed(
  phase: Phase,
  bus: number,
  closed: boolean,
  role: AdminRole,
  settings: Record<string, OperationalSetting>
): Promise<void> {
  const s = settings[`${phase}|${bus}`];
  if (!closed && s?.final) {
    throw new Error('최종 확인을 먼저 해제하세요.');
  }

  const docId = `${phase}_${bus}`;
  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'settings', docId),
      {
        phase,
        bus,
        closed,
        final: s?.final ?? false,
        at: s?.at || ''
      },
      { merge: true }
    );

    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
    const log: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString(),
      role: roleName,
      action: '마감변경',
      detail: `${phase} ${bus}호차 마감 상태: ${closed ? '마감됨' : '재개됨'}`
    };
    batch.set(doc(db, 'logs', logId), log);

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `settings/${docId}`);
  }
}

// Admin set final confirmation (최종 확인 완료 / 해제)
export async function adminSetFinal(
  phase: Phase,
  bus: number,
  finalVal: boolean,
  role: AdminRole,
  settings: Record<string, OperationalSetting>,
  people: Person[],
  records: Record<string, BoardingRecord>
): Promise<void> {
  const s = settings[`${phase}|${bus}`];
  if (finalVal) {
    if (!s?.closed) {
      throw new Error('체크를 먼저 마감한 후 최종 확인하세요.');
    }
    const unconfirmed = people.filter((p) => {
      const assigned = phase === '출발' ? p.out : p.back;
      if (assigned !== bus) return false;
      const rec = records[`${p.id}|${phase}`];
      return !rec || rec.status === '미탑승';
    });
    if (unconfirmed.length > 0) {
      throw new Error(`미확인 인원이 ${unconfirmed.length}명 남아 있습니다. 상태를 모두 확정한 후 시도하세요.`);
    }
  }

  const docId = `${phase}_${bus}`;
  const now = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'settings', docId),
      {
        phase,
        bus,
        closed: s?.closed ?? true,
        final: finalVal,
        at: finalVal ? now : ''
      },
      { merge: true }
    );

    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
    const log: AuditLog = {
      id: logId,
      timestamp: now,
      role: roleName,
      action: '최종확인',
      detail: `${phase} ${bus}호차 최종 확인: ${finalVal ? '완료' : '해제'}`
    };
    batch.set(doc(db, 'logs', logId), log);

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `settings/${docId}`);
  }
}

// Master move participant bus (호차 변경)
export async function masterMoveBus(
  person: Person,
  phase: Phase,
  newBus: number,
  settings: Record<string, OperationalSetting>
): Promise<void> {
  const oldBus = phase === '출발' ? person.out : person.back;
  if (oldBus === newBus) return;

  const sOld = settings[`${phase}|${oldBus}`];
  const sNew = settings[`${phase}|${newBus}`];
  if (sOld?.final || sNew?.final || sOld?.closed || sNew?.closed) {
    throw new Error('양쪽 버스의 마감·최종 확인을 먼저 해제하세요.');
  }

  const updatedPerson: Person = {
    ...person,
    out: phase === '출발' ? newBus : person.out,
    back: phase === '귀가' ? newBus : person.back
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'people', person.id), updatedPerson);

    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const log: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString(),
      role: '총괄 관리자',
      action: '버스변경',
      targetId: person.id,
      detail: `${person.name} ${phase} 배정: ${oldBus}호차 -> ${newBus}호차`
    };
    batch.set(doc(db, 'logs', logId), log);

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `people/${person.id}`);
  }
}

// Reset boarding for stop (중간 정차 시 전체 미탑승 초기화)
// Previous statuses are preserved in logs!
export async function adminResetBoardingForStop(
  phase: Phase,
  bus: number,
  role: AdminRole,
  people: Person[],
  currentRecords: Record<string, BoardingRecord>
): Promise<{ count: number; changed: number }> {
  const targetPeople = people.filter((p) => (phase === '출발' ? p.out : p.back) === bus);
  if (!targetPeople.length) {
    throw new Error('초기화할 탑승 명단이 없습니다.');
  }

  const now = new Date().toISOString();
  const beforeSnapshot: Array<{ id: string; name: string; status: BoardingStatus }> = [];
  let changedCount = 0;

  const batch = writeBatch(db);

  for (const p of targetPeople) {
    const key = `${p.id}|${phase}`;
    const prev = currentRecords[key];
    const prevStatus = prev?.status || '미탑승';
    beforeSnapshot.push({ id: p.id, name: p.name, status: prevStatus });
    if (prevStatus !== '미탑승') {
      changedCount++;
    }

    const recRef = doc(db, 'records', `${p.id}_${phase}`);
    const updatedRecord: BoardingRecord = {
      id: p.id,
      phase,
      status: '미탑승',
      at: now,
      by: '관리자 초기화'
    };
    batch.set(recRef, updatedRecord);
  }

  // Also reset closed and final on settings for this phase/bus
  const settingRef = doc(db, 'settings', `${phase}_${bus}`);
  batch.set(
    settingRef,
    {
      phase,
      bus,
      closed: false,
      final: false,
      at: ''
    },
    { merge: true }
  );

  // Store entire pre-reset snapshot in audit log
  const logId = 'reset_' + Date.now();
  const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
  const log: AuditLog = {
    id: logId,
    timestamp: now,
    role: roleName,
    action: '중간정차 초기화',
    targetId: `${phase}_${bus}호차`,
    detail: JSON.stringify({
      phase,
      bus,
      totalCount: targetPeople.length,
      changedCount,
      snapshot: beforeSnapshot
    })
  };
  batch.set(doc(db, 'logs', logId), log);

  try {
    await batch.commit();
    return { count: targetPeople.length, changed: changedCount };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'resetBoardingForStop');
  }
}

// Update manager contact
export async function updateBusContact(
  bus: number,
  name: string,
  phone: string,
  role: AdminRole
): Promise<void> {
  const contact: BusContact = { bus, name: name.trim(), phone: phone.trim() };
  try {
    await setDoc(doc(db, 'contacts', `bus_${bus}`), contact);

    const logId = 'log_' + Date.now();
    const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
    await setDoc(doc(db, 'logs', logId), {
      id: logId,
      timestamp: new Date().toISOString(),
      role: roleName,
      action: '연락처변경',
      detail: `${bus}호차 연락처: ${name} (${phone})`
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `contacts/bus_${bus}`);
  }
}

// Batch import participants from CSV
export async function batchImportParticipants(
  newList: Person[],
  role: AdminRole
): Promise<{ added: number; updated: number }> {
  if (!newList.length) throw new Error('가져올 참가자 명단이 비어 있습니다.');

  const existingSnap = await getDocs(collection(db, 'people'));
  const existingMap = new Map<string, Person>();
  existingSnap.forEach((d) => {
    const p = d.data() as Person;
    existingMap.set(p.id, p);
  });

  const batch = writeBatch(db);
  let added = 0;
  let updated = 0;

  for (const p of newList) {
    const cleanPerson: Person = {
      id: String(p.id).trim(),
      name: String(p.name).trim(),
      dept: String(p.dept || '').trim() || '소속 미지정',
      out: Number(p.out) === 2 ? 2 : 1,
      back: Number(p.back) === 2 ? 2 : 1
    };
    if (existingMap.has(cleanPerson.id)) {
      updated++;
    } else {
      added++;
    }
    batch.set(doc(db, 'people', cleanPerson.id), cleanPerson);
  }

  const logId = 'import_' + Date.now();
  const roleName = role === 'master' ? '총괄 관리자' : `${role}호차 관리자`;
  batch.set(doc(db, 'logs', logId), {
    id: logId,
    timestamp: new Date().toISOString(),
    role: roleName,
    action: '명단가져오기',
    detail: `CSV 가져오기 완료: 신규 ${added}명, 갱신 ${updated}명 (총 ${newList.length}명)`
  });

  try {
    await batch.commit();
    return { added, updated };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'batchImportParticipants');
  }
}
