import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Person,
  BoardingRecord,
  OperationalSetting,
  BusContact,
  BoardingStatus,
  AdminRole
} from './types';
import {
  subscribePeople,
  subscribeRecords,
  subscribeSettings,
  subscribeContacts,
  ensureBasicSettings,
  submitSelfBoarding,
  adminSetStatus,
  adminSetAllBoarded,
  adminSetAllReset,
  adminCloseAndResetNext,
  maskName
} from './lib/firestoreService';
import {
  loginAdmin,
  getActiveSession,
  logoutAdmin,
  AdminSession
} from './lib/authService';
import { CsvImportModal } from './components/CsvImportModal';
import { AdminSettingsModal } from './components/AdminSettingsModal';

type AppMode = 'self' | 'login' | 'admin';

export default function App() {
  // Application view state
  const [mode, setMode] = useState<AppMode>('self');
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [selectedMasterBus, setSelectedMasterBus] = useState<number>(1);

  // Firestore real-time state
  const [people, setPeople] = useState<Person[]>([]);
  const [records, setRecords] = useState<Record<string, BoardingRecord>>({});
  const [settings, setSettings] = useState<Record<string, OperationalSetting>>({});
  const [contacts, setContacts] = useState<Record<number, BusContact>>({});

  // Status & Feedback message
  const [message, setMessage] = useState<string>('');
  const [isErrorMsg, setIsErrorMsg] = useState(false);
  const msgTimer = useRef<NodeJS.Timeout | null>(null);

  const showMsg = (text: string, isErr = false, duration = 4000) => {
    setMessage(text);
    setIsErrorMsg(isErr);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    if (duration > 0) {
      msgTimer.current = setTimeout(() => {
        setMessage('');
      }, duration);
    }
  };

  // Self-check (Teacher) search state
  const [searchText, setSearchText] = useState('');
  const [searchedPeople, setSearchedPeople] = useState<Person[] | null>(null);
  const [selfPendingIds, setSelfPendingIds] = useState<Set<string>>(new Set());
  const [agreedCheckboxes, setAgreedCheckboxes] = useState<Record<string, boolean>>({});

  // Admin view state
  const [openExceptionMenuId, setOpenExceptionMenuId] = useState<string | null>(null);
  const [adminPendingActions, setAdminPendingActions] = useState<Set<string>>(new Set());

  // Modals (accessible for Master or discreetly)
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Admin login form
  const [loginRole, setLoginRole] = useState<AdminRole>('1');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Initialize DB and real-time subscriptions
  useEffect(() => {
    const existing = getActiveSession();
    if (existing) {
      setAdminSession(existing);
      if (existing.role !== 'master') {
        setSelectedMasterBus(Number(existing.role));
      }
    }

    ensureBasicSettings();

    const unsubPeople = subscribePeople((list) => setPeople(list));
    const unsubRecords = subscribeRecords((recs) => setRecords(recs));
    const unsubSettings = subscribeSettings((sets) => setSettings(sets));
    const unsubContacts = subscribeContacts((cts) => setContacts(cts));

    return () => {
      unsubPeople();
      unsubRecords();
      unsubSettings();
      unsubContacts();
    };
  }, []);

  // Current bus under administration
  const currentBus = useMemo(() => {
    if (!adminSession) return 1;
    if (adminSession.role === 'master') return selectedMasterBus;
    return Number(adminSession.role);
  }, [adminSession, selectedMasterBus]);

  // Teachers candidate list for autocomplete
  const nameCandidates = useMemo(() => {
    const q = searchText.trim();
    if (!q || searchedPeople !== null) return [];
    return people.filter((p) => p.name.includes(q)).slice(0, 10);
  }, [searchText, people, searchedPeople]);

  // Filtered roster for current bus
  const busRoster = useMemo(() => {
    return people
      .filter((p) => (p.out || p.back || 1) === currentBus)
      .map((p, idx) => {
        const rec = records[`${p.id}|출발`];
        const status: BoardingStatus = rec?.status || '미탑승';
        return {
          ...p,
          seq: idx + 1,
          status,
          at: rec?.at || '',
          by: rec?.by || ''
        };
      });
  }, [people, records, currentBus]);

  // Counts & stats
  const stats = useMemo(() => {
    const total = busRoster.length;
    const boarded = busRoster.filter((p) => p.status === '탑승').length;
    const unboarded = busRoster.filter((p) => p.status === '미탑승').length;
    const absent = busRoster.filter((p) => p.status === '불참').length;
    const indiv = busRoster.filter((p) => p.status === '개별이동').length;
    const targetCount = total - absent - indiv;
    const pct = total ? Math.round((boarded / total) * 100) : 0;
    return { total, boarded, unboarded, absent, indiv, targetCount, pct };
  }, [busRoster]);

  // Handler: Mode Toggle
  const toggleMode = () => {
    if (mode === 'self') {
      if (adminSession) {
        setMode('admin');
      } else {
        setMode('login');
      }
    } else {
      setMode('self');
      setSearchedPeople(null);
      setSearchText('');
    }
  };

  // Handler: Teacher Search
  const handleTeacherLookup = (exactName?: string) => {
    const targetName = (exactName || searchText).trim();
    if (!/^[가-힣]{3}$/.test(targetName)) {
      showMsg('이름 3글자를 정확히 입력해 주세요.', true);
      return;
    }
    const matches = people.filter((p) => p.name === targetName);
    setSearchedPeople(matches);
    if (!matches.length) {
      showMsg('일치하는 명단이 없습니다. 이름을 확인하거나 담당자에게 문의하세요.', true);
    } else {
      showMsg('조회되었습니다.');
    }
  };

  const resetTeacherLookup = () => {
    setSearchedPeople(null);
    setSearchText('');
    setAgreedCheckboxes({});
  };

  // Handler: Teacher Confirm Boarding
  const handleTeacherConfirm = async (person: Person) => {
    if (!agreedCheckboxes[person.id]) {
      showMsg('버스에 탑승한 후 체크박스를 선택해 주세요.', true);
      return;
    }

    setSelfPendingIds((prev) => new Set(prev).add(person.id));
    showMsg('탑승 확인 저장 중…', false, 0);

    try {
      await submitSelfBoarding(person, '출발', settings, records);
      showMsg('✓ 탑승 확인이 완료되었습니다.');
    } catch (e: any) {
      showMsg('저장 실패: ' + (e.message || String(e)), true);
    } finally {
      setSelfPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(person.id);
        return next;
      });
    }
  };

  // Handler: Admin Login
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginSubmitting(true);
    try {
      const session = await loginAdmin(loginRole, loginPassword);
      setAdminSession(session);
      setLoginPassword('');
      if (session.role !== 'master') {
        setSelectedMasterBus(Number(session.role));
      }
      setMode('admin');
      showMsg(`${session.role === 'master' ? '총괄' : session.role + '호차'} 관리자로 로그인되었습니다.`);
    } catch (err: any) {
      showMsg(err.message || String(err), true);
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleAdminLogout = () => {
    logoutAdmin();
    setAdminSession(null);
    setMode('self');
    showMsg('로그아웃되었습니다.');
  };

  // Handler: Single Person Boarding Toggle
  const handleToggleBoarding = async (personId: string, personName: string, currentStatus: BoardingStatus) => {
    const newStatus: BoardingStatus = currentStatus === '탑승' ? '미탑승' : '탑승';
    await handleStatusChange(personId, personName, newStatus);
  };

  const handleStatusChange = async (personId: string, personName: string, newStatus: BoardingStatus) => {
    if (!adminSession) return;
    const actionKey = `status:${personId}`;
    if (adminPendingActions.has(actionKey)) return;

    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    setOpenExceptionMenuId(null);

    // Optimistic update
    const prevRec = records[`${personId}|출발`];
    const optimisticRec: BoardingRecord = {
      id: personId,
      phase: '출발',
      status: newStatus,
      at: new Date().toISOString(),
      by: '관리자'
    };
    setRecords((prev) => ({ ...prev, [`${personId}|출발`]: optimisticRec }));

    try {
      await adminSetStatus(
        personId,
        personName,
        '출발',
        currentBus,
        newStatus,
        adminSession.role,
        settings
      );
      showMsg(`${personName} 선생님: ${newStatus}`);
    } catch (err: any) {
      if (prevRec) {
        setRecords((prev) => ({ ...prev, [`${personId}|출발`]: prevRec }));
      }
      showMsg('저장 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // 1. Button 1: [ 전체 탑승 ]
  const handleAllBoarded = async () => {
    if (!adminSession) return;
    if (!window.confirm(`${currentBus}호차 전체 인원(${stats.total}명)을 '탑승' 처리하시겠습니까?`)) return;

    const actionKey = `all_board:${currentBus}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    showMsg('전체 탑승 처리 중…', false, 0);

    try {
      const count = await adminSetAllBoarded(currentBus, adminSession.role, people);
      showMsg(`✓ ${currentBus}호차 전원(${count}명) 탑승 처리 완료`);
    } catch (err: any) {
      showMsg('전체 탑승 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // 2. Button 2: [ 전체 초기화 ]
  const handleAllReset = async () => {
    if (!adminSession) return;
    if (!window.confirm(`${currentBus}호차 모든 탑승 상태를 '미탑승'으로 초기화할까요?`)) return;

    const actionKey = `all_reset:${currentBus}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    showMsg('전체 초기화 중…', false, 0);

    try {
      const count = await adminSetAllReset(currentBus, adminSession.role, people);
      showMsg(`✓ ${currentBus}호차 전원(${count}명) 미탑승으로 초기화되었습니다.`);
    } catch (err: any) {
      showMsg('초기화 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // 3. Button 3: [ 마감 ] (출발 및 다음 출석체크를 위해 전원 미탑승 초기화)
  const handleBusFinishAndReset = async () => {
    if (!adminSession) return;
    const confirmPrompt = `${currentBus}호차 탑승 확인을 마감합니다.\n(현재 탑승: ${stats.boarded}명 / 미탑승: ${stats.unboarded}명)\n\n출발 후 다음 출석체크를 위해 전원 '미탑승' 상태로 초기화됩니다.\n진행하시겠습니까?`;
    if (!window.confirm(confirmPrompt)) return;

    const actionKey = `finish:${currentBus}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    showMsg('마감 및 다음 회차 초기화 중…', false, 0);

    try {
      const res = await adminCloseAndResetNext(currentBus, adminSession.role, people, records);
      showMsg(`✓ ${currentBus}호차 마감 완료 (${res.boardedCount}명 탑승 기록 보존됨). 다음 탑승을 위해 전원 미탑승으로 준비되었습니다.`);
    } catch (err: any) {
      showMsg('마감 처리 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // Teacher Contact Phone
  const teacherBusPhone = useMemo(() => {
    if (!searchedPeople || !searchedPeople.length) return '';
    const buses = Array.from(new Set(searchedPeople.map((p) => p.out || p.back || 1)));
    if (buses.length === 1) {
      return contacts[buses[0]]?.phone?.replace(/[^0-9+]/g, '') || '';
    }
    return '';
  }, [searchedPeople, contacts]);

  return (
    <main>
      {/* Pastel garland at top corners */}
      <div className="festive-garland">
        <svg viewBox="0 0 110 30" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 4 Q55 11 110 4" stroke="#e9dfe1" strokeWidth="1.3" fill="none" />
          <path d="M5 5 L24 5 L14.5 25 Z" fill="#ffd8e2" />
          <path d="M30 5 L49 5 L39.5 25 Z" fill="#c8efdc" />
          <path d="M55 5 L74 5 L64.5 25 Z" fill="#ffe4ac" />
          <path d="M80 5 L99 5 L89.5 25 Z" fill="#dcd5fa" />
        </svg>
        <svg viewBox="0 0 110 30" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 4 Q55 11 110 4" stroke="#e9dfe1" strokeWidth="1.3" fill="none" />
          <path d="M5 5 L24 5 L14.5 25 Z" fill="#ffd8e2" />
          <path d="M30 5 L49 5 L39.5 25 Z" fill="#c8efdc" />
          <path d="M55 5 L74 5 L64.5 25 Z" fill="#ffe4ac" />
          <path d="M80 5 L99 5 L89.5 25 Z" fill="#dcd5fa" />
        </svg>
      </div>

      {/* Header bar */}
      <div className="row page-head">
        <div>
          <div className="muted">2026 교직원 워크숍 · 버스 탑승 관리</div>
          <h1>워크숍 버스 탑승 확인</h1>
        </div>
        <button id="modeBtn" onClick={toggleMode}>
          {mode === 'self' ? '관리자' : '교직원 화면'}
        </button>
      </div>

      {/* Global message banner */}
      <p id="message" role="status" className={isErrorMsg ? 'error' : 'success'}>
        {message}
      </p>

      {/* ---------------- 1. TEACHER VIEW ---------------- */}
      {mode === 'self' && (
        <div id="selfView">
          {/* Manager Contact Bar (shown when bus contact is resolved) */}
          {teacherBusPhone && (
            <div className="contact-actions" aria-label="호차 관리자 연락">
              <a className="contact-btn" href={`tel:${teacherBusPhone}`}>
                ☎ 관리자 전화
              </a>
              <a className="contact-btn" href={`sms:${teacherBusPhone}`}>
                ✉ 관리자 문자
              </a>
            </div>
          )}

          {/* Search Card */}
          <div className="card">
            <h2>내 이름으로 탑승 확인</h2>
            <p className="muted">
              이름으로 본인 정보를 확인한 뒤, 실제 탑승 시 체크해 주세요. 조회만으로 탑승 처리되지 않습니다.
            </p>

            {searchedPeople === null && (
              <>
                <div className="row" id="selfSearchRow">
                  <input
                    id="search"
                    placeholder="이름 3글자"
                    maxLength={3}
                    autoComplete="off"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleTeacherLookup();
                    }}
                  />
                  <button
                    className="primary"
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    onClick={() => handleTeacherLookup()}
                  >
                    내 정보 확인
                  </button>
                </div>

                {/* Autocomplete candidates */}
                {nameCandidates.length > 0 && (
                  <div className="name-candidates">
                    {nameCandidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSearchText(c.name);
                          handleTeacherLookup(c.name);
                        }}
                      >
                        <strong>{c.name}</strong>
                        <span>{c.dept}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Matching Result Panel */}
            {searchedPeople !== null && (
              <div id="selfList">
                {searchedPeople.length === 0 ? (
                  <p className="muted">
                    일치하는 명단이 없습니다. 이름을 확인하거나 담당자에게 문의하세요.
                  </p>
                ) : (
                  searchedPeople.map((p) => {
                    const assignedBus = p.out || p.back || 1;
                    const rec = records[`${p.id}|출발`];
                    const status: BoardingStatus = rec?.status || '미탑승';
                    const isPending = selfPendingIds.has(p.id);

                    return (
                      <div className="self-check-panel" key={p.id}>
                        <div className="self-check-title">
                          <strong>{maskName(p.name)}</strong>
                          <span className="self-school">{p.dept}</span>
                        </div>
                        <div className="self-bus" style={{ fontSize: '13px', margin: '8px 0 12px' }}>
                          <span
                            style={{
                              background: assignedBus === 1 ? '#e7f5ff' : '#fff4e6',
                              color: assignedBus === 1 ? '#1864ab' : '#d9480f',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '6px',
                              marginRight: '6px'
                            }}
                          >
                            {assignedBus}호차
                          </span>
                          상태: <strong>{status}</strong>
                        </div>

                        {isPending ? (
                          <div className="self-saving">
                            탑승 확인 저장 중입니다. 잠시만 기다려 주세요…
                          </div>
                        ) : status === '탑승' ? (
                          <div className="self-done">✓ 탑승 확인 완료 · 저장됨</div>
                        ) : status !== '미탑승' ? (
                          <div className="self-closed">
                            현재 상태: {status} · 관리자에게 문의하세요.
                          </div>
                        ) : (
                          <>
                            <label className="self-check-label">
                              <input
                                type="checkbox"
                                checked={!!agreedCheckboxes[p.id]}
                                onChange={(e) =>
                                  setAgreedCheckboxes((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.checked
                                  }))
                                }
                              />
                              <span>버스에 탑승했습니다.</span>
                            </label>
                            <button
                              className="self-confirm"
                              disabled={!agreedCheckboxes[p.id]}
                              onClick={() => handleTeacherConfirm(p)}
                            >
                              탑승 확인 완료하기
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })
                )}

                <button
                  id="resetSelfBtn"
                  onClick={resetTeacherLookup}
                  style={{ marginTop: '14px', width: '100%' }}
                >
                  다른 이름 조회
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 2. ADMIN LOGIN VIEW ---------------- */}
      {mode === 'login' && (
        <div id="loginView">
          <div className="card">
            <h2>관리자 로그인</h2>
            <form onSubmit={handleAdminLogin}>
              <label>담당 구분</label>
              <select
                value={loginRole}
                onChange={(e) => setLoginRole(e.target.value as AdminRole)}
              >
                <option value="1">1호차 관리자</option>
                <option value="2">2호차 관리자</option>
                <option value="master">총괄 관리자</option>
              </select>

              <label>비밀번호</label>
              <input
                type="password"
                placeholder="관리자 비밀번호"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
              />

              <button
                type="submit"
                className="primary"
                style={{ width: '100%', marginTop: '14px' }}
                disabled={loginSubmitting}
              >
                {loginSubmitting ? '로그인 확인 중…' : '로그인'}
              </button>
            </form>

            <p className="muted" style={{ marginTop: '12px' }}>
              비밀번호 오류 5회 시 15분간 로그인이 제한됩니다.
              <br />
              <span style={{ color: '#273b55', fontWeight: 600 }}>
                (초기 비밀번호: 1호차 1111 / 2호차 2222 / 총괄 0000)
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ---------------- 3. ADMIN DASHBOARD VIEW ---------------- */}
      {mode === 'admin' && adminSession && (
        <div id="adminView">
          {/* Top Admin Row */}
          <div className="row" style={{ marginBottom: '8px' }}>
            <h2 id="adminTitle" style={{ fontSize: '15px', color: '#172d4c', margin: 0 }}>
              {adminSession.role === 'master' ? '총괄 관리자' : `${currentBus}호차 관리자`}
            </h2>
            <button onClick={handleAdminLogout} style={{ fontSize: '12px', padding: '6px 10px' }}>
              로그아웃
            </button>
          </div>

          {/* Master Admin: Clean tabs between 1호차 and 2호차 */}
          {adminSession.role === 'master' && (
            <div className="tabs" style={{ margin: '8px 0 12px' }}>
              <button
                type="button"
                className={selectedMasterBus === 1 ? 'primary' : ''}
                onClick={() => {
                  setSelectedMasterBus(1);
                  setOpenExceptionMenuId(null);
                }}
              >
                1호차
              </button>
              <button
                type="button"
                className={selectedMasterBus === 2 ? 'primary' : ''}
                onClick={() => {
                  setSelectedMasterBus(2);
                  setOpenExceptionMenuId(null);
                }}
              >
                2호차
              </button>
            </div>
          )}

          {/* Summary Card (Original elegant design with slightly larger heading) */}
          <div className="card" id="dashboardSummary">
            <div className="row">
              <h2 id="busTitle" style={{ fontSize: '18px', fontWeight: 800, color: '#1e3350', margin: '2px 0 8px' }}>
                {currentBus}호차 탑승 현황
              </h2>
              <span className="chip ok">체크 진행 중</span>
            </div>

            {/* Progress bar */}
            <div className="progress-wrap" aria-live="polite">
              <div className="progress-top">
                <span>
                  <strong>{stats.boarded}</strong> / {stats.total}명 탑승
                </span>
                <strong>{stats.pct}%</strong>
              </div>
              <div className="progress-track" role="progressbar">
                <div className="progress-fill" style={{ width: `${stats.pct}%` }} />
              </div>
            </div>

            {/* 3 Count Boxes */}
            <div className="stats">
              <div className="stat">
                탑승 대상
                <strong>{stats.targetCount}</strong>
              </div>
              <div className="stat">
                탑승 완료
                <strong>{stats.boarded}</strong>
              </div>
              <div className="stat">
                미탑승
                <strong>{stats.unboarded}</strong>
              </div>
            </div>

            {/* 3 Action Buttons matching original styling */}
            <div
              className="actions"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginTop: '12px'
              }}
            >
              <button
                type="button"
                className="primary"
                onClick={handleAllBoarded}
                disabled={adminPendingActions.size > 0 || stats.total === 0}
                style={{ height: '40px', fontSize: '13px', fontWeight: 700 }}
              >
                전체 탑승
              </button>

              <button
                type="button"
                onClick={handleAllReset}
                disabled={adminPendingActions.size > 0 || stats.total === 0}
                style={{ height: '40px', fontSize: '13px', fontWeight: 700 }}
              >
                전체 초기화
              </button>

              <button
                type="button"
                className="primary"
                onClick={handleBusFinishAndReset}
                disabled={adminPendingActions.size > 0}
                style={{ height: '40px', fontSize: '13px', fontWeight: 700 }}
              >
                마감
              </button>
            </div>
          </div>

          {/* Roster List Card */}
          <div className="card" id="dashboardRoster">
            <div className="row" style={{ marginBottom: '6px' }}>
              <h2>탑승 명단</h2>
              <span className="muted" style={{ fontSize: '12px' }}>총 {busRoster.length}명</span>
            </div>

            <div id="adminList">
              {busRoster.length === 0 ? (
                <p className="muted" style={{ padding: '16px 0', textAlign: 'center' }}>
                  현재 {currentBus}호차에 배정된 참가자가 없습니다.
                  <br />
                  {adminSession.role === 'master' && '하단 [명단 CSV 관리]에서 참가자 명단을 등록해 주세요.'}
                </p>
              ) : (
                busRoster.map((p) => {
                  const isBusy = adminPendingActions.has(`status:${p.id}`);
                  const isBoarded = p.status === '탑승';
                  const isException = p.status === '불참' || p.status === '개별이동';

                  return (
                    <React.Fragment key={p.id}>
                      <div className="person compact">
                        <div className="who">
                          <span className="seq">{p.seq}.</span>
                          <strong>{p.name}</strong>
                          <span className="school-inline">
                            {p.dept.split(' / ')[0].trim()}
                          </span>
                        </div>

                        <div className="actions">
                          <button
                            type="button"
                            className={`board-toggle ${isBoarded ? 'is-boarded' : isException ? 'is-exception' : ''}`}
                            disabled={isBusy}
                            onClick={() => handleToggleBoarding(p.id, p.name, p.status)}
                            aria-label={`${p.name} 탑승 상태 전환`}
                          >
                            {isBusy ? '…' : isBoarded ? '✓ 탑승' : isException ? p.status : '미탑승'}
                          </button>

                          <button
                            type="button"
                            className="exception-toggle"
                            disabled={isBusy}
                            onClick={() =>
                              setOpenExceptionMenuId(
                                openExceptionMenuId === p.id ? null : p.id
                              )
                            }
                            aria-label={`${p.name} 불참 및 개별이동`}
                          >
                            ⋯
                          </button>
                        </div>
                      </div>

                      {/* Exception drop-down sub-menu */}
                      {openExceptionMenuId === p.id && (
                        <div className="exception-menu">
                          <button
                            type="button"
                            onClick={() => handleStatusChange(p.id, p.name, '불참')}
                          >
                            불참
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusChange(p.id, p.name, '개별이동')}
                          >
                            개별이동
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusChange(p.id, p.name, '미탑승')}
                          >
                            미탑승 복원
                          </button>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </div>
          </div>

          {/* Discreet Management Tools for Master Admin */}
          {adminSession.role === 'master' && (
            <div style={{ textAlign: 'center', marginTop: '16px', padding: '8px 0' }}>
              <div style={{ display: 'inline-flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setIsCsvModalOpen(true)}
                  style={{ fontSize: '12px', color: '#495057', background: '#fff', border: '1px solid #ced4da', borderRadius: '8px' }}
                >
                  📁 명단 CSV 관리
                </button>
                <button
                  type="button"
                  onClick={() => setIsSettingsModalOpen(true)}
                  style={{ fontSize: '12px', color: '#495057', background: '#fff', border: '1px solid #ced4da', borderRadius: '8px' }}
                >
                  ⚙️ 연락처 및 비밀번호 설정
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- CSV Import Modal (Master Admin) ---------------- */}
      {isCsvModalOpen && adminSession && (
        <CsvImportModal
          isOpen={isCsvModalOpen}
          onClose={() => setIsCsvModalOpen(false)}
          role={adminSession.role}
          currentPeople={people}
          onImportComplete={(msg) => showMsg(msg)}
        />
      )}

      {/* ---------------- Admin Settings Modal (Master Admin) ---------------- */}
      {isSettingsModalOpen && adminSession && (
        <AdminSettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          role={adminSession.role}
          contacts={contacts}
          onSuccess={(msg) => showMsg(msg)}
        />
      )}
    </main>
  );
}
