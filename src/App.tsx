import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Person,
  BoardingRecord,
  OperationalSetting,
  BusContact,
  Phase,
  BoardingStatus,
  AdminRole
} from './types';
import {
  subscribePeople,
  subscribeRecords,
  subscribeSettings,
  subscribeContacts,
  ensureBasicSettings,
  clearAllPeopleAndRecords,
  submitSelfBoarding,
  adminSetStatus,
  adminSetClosed,
  adminSetFinal,
  masterMoveBus,
  adminResetBoardingForStop,
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
import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './lib/firebase';

type AppMode = 'self' | 'login' | 'admin';

export default function App() {
  // Application view state
  const [mode, setMode] = useState<AppMode>('self');
  const [phase, setPhase] = useState<Phase>('출발');
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [selectedMasterBus, setSelectedMasterBus] = useState<number>(1);

  // Firestore real-time state
  const [people, setPeople] = useState<Person[]>([]);
  const [records, setRecords] = useState<Record<string, BoardingRecord>>({});
  const [settings, setSettings] = useState<Record<string, OperationalSetting>>({});
  const [contacts, setContacts] = useState<Record<number, BusContact>>({});
  const [isDbReady, setIsDbReady] = useState(false);

  // Status & Feedback message
  const [message, setMessage] = useState<string>('');
  const [isErrorMsg, setIsErrorMsg] = useState(false);
  const msgTimer = useRef<NodeJS.Timeout | null>(null);

  const showMsg = (text: string, isErr = false, duration = 4500) => {
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
  const [adminSearch, setAdminSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('전체');
  const [openExceptionMenuId, setOpenExceptionMenuId] = useState<string | null>(null);
  const [adminPendingActions, setAdminPendingActions] = useState<Set<string>>(new Set());
  const [speedDiagnosticInfo, setSpeedDiagnosticInfo] = useState<string>('');

  // Modals
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Admin login form
  const [loginRole, setLoginRole] = useState<AdminRole>('1');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Initialize DB and real-time subscriptions
  useEffect(() => {
    // Check existing session
    const existing = getActiveSession();
    if (existing) {
      setAdminSession(existing);
    }

    // Ensure operational settings exist without inserting sample data
    ensureBasicSettings().then(() => {
      setIsDbReady(true);
    });

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

  // Operational settings for current bus & phase
  const currentSetting = useMemo(() => {
    return (
      settings[`${phase}|${currentBus}`] || {
        phase,
        bus: currentBus,
        closed: false,
        final: false,
        at: ''
      }
    );
  }, [settings, phase, currentBus]);

  // Teachers candidate list for autocomplete
  const nameCandidates = useMemo(() => {
    const q = searchText.trim();
    if (!q || searchedPeople !== null) return [];
    return people.filter((p) => p.name.includes(q)).slice(0, 10);
  }, [searchText, people, searchedPeople]);

  // Filtered roster for Admin view
  const busRoster = useMemo(() => {
    return people
      .filter((p) => {
        const assignedBus = phase === '출발' ? p.out : p.back;
        return assignedBus === currentBus;
      })
      .map((p, idx) => {
        const rec = records[`${p.id}|${phase}`];
        const status: BoardingStatus = rec?.status || '미탑승';
        return {
          ...p,
          seq: idx + 1,
          status,
          at: rec?.at || '',
          by: rec?.by || ''
        };
      });
  }, [people, records, phase, currentBus]);

  const filteredRoster = useMemo(() => {
    const q = adminSearch.trim();
    return busRoster.filter((p) => {
      const matchQuery = !q || p.name.includes(q) || p.dept.includes(q);
      const matchFilter = statusFilter === '전체' || p.status === statusFilter;
      return matchQuery && matchFilter;
    });
  }, [busRoster, adminSearch, statusFilter]);

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

  // Handler: Select phase (출발 vs 귀가)
  const choosePhase = (newPhase: Phase) => {
    if (adminPendingActions.size > 0) {
      showMsg('관리자 변경사항 저장 중입니다. 잠시 기다려 주세요.', true);
      return;
    }
    setPhase(newPhase);
    setOpenExceptionMenuId(null);
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
    showMsg('탑승 확인 요청됨 · Firebase 저장 중…', false, 0);

    try {
      await submitSelfBoarding(person, phase, settings, records);
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
      showMsg('관리자로 로그인되었습니다.');
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

  // Handler: Admin toggle Boarding (미탑승 <-> 탑승)
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
    const prevRec = records[`${personId}|${phase}`];
    const optimisticRec: BoardingRecord = {
      id: personId,
      phase,
      status: newStatus,
      at: new Date().toISOString(),
      by: '관리자'
    };
    setRecords((prev) => ({ ...prev, [`${personId}|${phase}`]: optimisticRec }));

    try {
      await adminSetStatus(
        personId,
        personName,
        phase,
        currentBus,
        newStatus,
        adminSession.role,
        settings
      );
      showMsg('탑승 상태가 저장되었습니다.');
    } catch (err: any) {
      // Revert optimistic update
      if (prevRec) {
        setRecords((prev) => ({ ...prev, [`${personId}|${phase}`]: prevRec }));
      }
      showMsg('저장 실패 · 이전 상태 복원: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // Handler: Admin Close toggle
  const handleToggleClosed = async () => {
    if (!adminSession) return;
    const isClosed = currentSetting.closed;
    const confirmPrompt = `${currentBus}호차 ${phase} 체크를 ${isClosed ? '재개' : '마감'}할까요?`;
    if (!window.confirm(confirmPrompt)) return;

    const actionKey = `close:${currentBus}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    try {
      await adminSetClosed(phase, currentBus, !isClosed, adminSession.role, settings);
      showMsg(`${currentBus}호차 ${phase} 체크가 ${!isClosed ? '마감' : '재개'}되었습니다.`);
    } catch (err: any) {
      showMsg('처리 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // Handler: Admin Final toggle
  const handleToggleFinal = async () => {
    if (!adminSession) return;
    const isFinal = currentSetting.final;
    const confirmPrompt = `${currentBus}호차 ${phase} 최종 확인을 ${isFinal ? '해제' : '완료'}할까요?`;
    if (!window.confirm(confirmPrompt)) return;

    const actionKey = `final:${currentBus}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    try {
      await adminSetFinal(
        phase,
        currentBus,
        !isFinal,
        adminSession.role,
        settings,
        people,
        records
      );
      showMsg(`${currentBus}호차 ${phase} 최종 확인이 ${!isFinal ? '완료' : '해제'}되었습니다.`);
    } catch (err: any) {
      showMsg('처리 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // Handler: Master move participant bus
  const handleMoveBus = async (person: Person) => {
    if (!adminSession || adminSession.role !== 'master') return;
    const oldBus = phase === '출발' ? person.out : person.back;
    const nextBus = oldBus === 1 ? 2 : 1;
    if (!window.confirm(`${person.name} 선생님을 ${phase} ${nextBus}호차로 변경할까요?`)) return;

    const actionKey = `move:${person.id}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    try {
      await masterMoveBus(person, phase, nextBus, settings);
      showMsg(`${person.name} 선생님의 ${phase} 배정이 ${nextBus}호차로 변경되었습니다.`);
    } catch (err: any) {
      showMsg('변경 실패: ' + (err.message || String(err)), true);
    } finally {
      setAdminPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  // Handler: Reset boarding for stop (중간 정차 시 전체 미탑승 초기화)
  const handleResetForStop = async () => {
    if (!adminSession) return;
    if (adminPendingActions.size > 0 || selfPendingIds.size > 0) {
      showMsg('저장 중인 작업이 있습니다. 완료 후 초기화해 주세요.', true);
      return;
    }

    const first = `${currentBus}호차 · ${phase} 탑승 현황을 전원 미탑승으로 초기화할까요?\n\n중간 정차 후 재탑승을 확인할 때 사용합니다. 기존 탑승·불참·개별이동 상태가 모두 미탑승으로 바뀌며, 마감과 최종 확인도 해제됩니다. 다른 호차와 다른 구간은 유지되며 변경 전 상태는 기록에 보존됩니다.`;
    if (!window.confirm(first)) return;

    const second = `최종 확인: ${currentBus}호차 ${phase}의 모든 탑승 상태를 초기화합니다. 진행할까요?`;
    if (!window.confirm(second)) return;

    const actionKey = `reset:${phase}:${currentBus}`;
    setAdminPendingActions((prev) => new Set(prev).add(actionKey));
    showMsg('초기화 중… Firebase에 저장 완료될 때까지 기다려 주세요.', false, 0);

    try {
      const result = await adminResetBoardingForStop(
        phase,
        currentBus,
        adminSession.role,
        people,
        records
      );
      showMsg(`${currentBus}호차 ${phase}: ${result.count}명 미탑승으로 초기화 완료. 다시 체크할 수 있습니다.`);
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

  // Speed Diagnostic: Tests live Firestore server response latency
  const handleSpeedDiagnostic = async () => {
    setSpeedDiagnosticInfo('측정 중…');
    const start = performance.now();
    try {
      await getDocFromServer(doc(db, 'settings', `${phase}_${currentBus}`));
      const elapsed = Math.round(performance.now() - start);
      setSpeedDiagnosticInfo(`Firestore 응답 ${elapsed}ms (실시간 동기화 정상)`);
    } catch (e: any) {
      setSpeedDiagnosticInfo('진단 실패: ' + (e.message || String(e)));
    }
  };

  // Phone number resolution for teacher contact bar
  const teacherBusPhone = useMemo(() => {
    if (!searchedPeople || !searchedPeople.length) return '';
    const buses = Array.from(new Set(searchedPeople.map((p) => (phase === '출발' ? p.out : p.back))));
    if (buses.length === 1) {
      return contacts[buses[0]]?.phone?.replace(/[^0-9+]/g, '') || '';
    }
    return '';
  }, [searchedPeople, phase, contacts]);

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
          <div className="muted">2026 교직원 워크숍 · 출발/귀가 탑승 관리</div>
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
          {/* Phase Tabs: 출발 vs 귀가 */}
          <div className="tabs">
            <button
              id="selfOut"
              className={phase === '출발' ? 'primary' : ''}
              onClick={() => choosePhase('출발')}
            >
              출발 탑승
            </button>
            <button
              id="selfBack"
              className={phase === '귀가' ? 'primary' : ''}
              onClick={() => choosePhase('귀가')}
            >
              귀가 탑승
            </button>
          </div>

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
                    const assignedBus = phase === '출발' ? p.out : p.back;
                    const rec = records[`${p.id}|${phase}`];
                    const status: BoardingStatus = rec?.status || '미탑승';
                    const busSetting = settings[`${phase}|${assignedBus}`];
                    const isClosed = !!busSetting?.closed;
                    const isFinal = !!busSetting?.final;
                    const isPending = selfPendingIds.has(p.id);

                    return (
                      <div className="self-check-panel" key={p.id}>
                        <div className="self-check-title">
                          <strong>{maskName(p.name)}</strong>
                          <span className="self-school">{p.dept}</span>
                        </div>
                        <div className="self-bus">
                          {assignedBus}호차 · {phase} · <strong>{status}</strong>
                        </div>

                        {isPending ? (
                          <div className="self-saving">
                            탑승 확인 요청됨
                            <small>
                              Firebase에 저장 중입니다. 완료 안내가 나올 때까지 기다려 주세요.
                            </small>
                          </div>
                        ) : status === '탑승' ? (
                          <div className="self-done">✓ 탑승 확인 완료 · 저장됨</div>
                        ) : status !== '미탑승' ? (
                          <div className="self-closed">
                            현재 상태: {status} · 관리자에게 문의하세요.
                          </div>
                        ) : isClosed || isFinal ? (
                          <div className="self-closed">
                            탑승 확인이 마감되었습니다. 담당자에게 문의하세요.
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
              비밀번호 오류 5회 시 15분간 로그인이 제한됩니다. 담당 버스만 수정할 수 있습니다.
              버스 변경은 총괄 관리자 전용입니다.
              <br />
              <span style={{ color: '#273b55', fontWeight: 600 }}>
                (초기 비밀번호: 1호차 1111 / 2호차 2222 / 총괄 관리자 0000)
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ---------------- 3. ADMIN DASHBOARD VIEW ---------------- */}
      {mode === 'admin' && adminSession && (
        <div id="adminView">
          {/* Quick jump navigation */}
          <nav className="dashboard-nav" aria-label="관리 화면 바로가기">
            <a href="#dashboardSummary">탑승 현황</a>
            <a href="#dashboardRoster">탑승 명단</a>
          </nav>

          {/* Admin Header */}
          <div className="row">
            <h2 id="adminTitle">
              {adminSession.role === 'master' ? '총괄 관리자' : `${currentBus}호차 관리자`} · {phase}
            </h2>
            <button onClick={handleAdminLogout}>로그아웃</button>
          </div>

          {/* Phase Tabs: 출발 vs 귀가 */}
          <div className="tabs">
            <button
              className={phase === '출발' ? 'primary' : ''}
              onClick={() => choosePhase('출발')}
            >
              출발
            </button>
            <button
              className={phase === '귀가' ? 'primary' : ''}
              onClick={() => choosePhase('귀가')}
            >
              귀가
            </button>
          </div>

          {/* Master Bus selector */}
          {adminSession.role === 'master' && (
            <div id="masterBus" style={{ marginBottom: '10px' }}>
              <label>관리 버스</label>
              <select
                value={selectedMasterBus}
                onChange={(e) => {
                  setSelectedMasterBus(Number(e.target.value));
                  setOpenExceptionMenuId(null);
                }}
              >
                <option value="1">1호차</option>
                <option value="2">2호차</option>
              </select>
            </div>
          )}

          {/* Summary Card */}
          <div className="card" id="dashboardSummary">
            <div className="row">
              <h2 id="busTitle">{currentBus}호차 탑승 현황</h2>
              <span className={`chip ${currentSetting.closed ? 'warn' : 'ok'}`}>
                {currentSetting.closed ? '체크 마감' : '체크 진행 중'}
              </span>
            </div>

            {/* Boarding progress bar */}
            <div className="progress-wrap" aria-live="polite">
              <div className="progress-top">
                <span>
                  <strong>{stats.boarded}</strong> / {stats.total}명 탑승
                </span>
                <strong>{stats.pct}%</strong>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={`${currentBus}호차 탑승률`}
                aria-valuenow={stats.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="progress-fill" style={{ width: `${stats.pct}%` }} />
              </div>
            </div>

            {/* Stats Grid */}
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

            <p className="muted" id="extraStats">
              불참 {stats.absent}명 · 개별 이동 {stats.indiv}명 ·{' '}
              {currentSetting.final ? '최종 확인 완료' : '최종 확인 전'}
            </p>

            {/* Main Action Buttons */}
            <div className="actions">
              <button onClick={handleToggleClosed}>
                {currentSetting.closed ? '체크 재개' : '체크 마감'}
              </button>
              <button
                onClick={handleToggleFinal}
                disabled={!currentSetting.final && (stats.unboarded > 0 || !currentSetting.closed)}
              >
                {currentSetting.final ? '최종 확인 해제' : '최종 확인'}
              </button>
              <button
                className="reset-stop-btn"
                onClick={handleResetForStop}
                disabled={adminPendingActions.size > 0}
              >
                전체 미탑승 초기화
              </button>
              <button onClick={() => setIsCsvModalOpen(true)}>
                명단 CSV 관리
              </button>
              <button onClick={() => setIsSettingsModalOpen(true)}>
                설정
              </button>
            </div>

            <p className="muted" style={{ marginTop: '8px' }}>
              체크를 마감하고 현장에서 실제 인원을 대조한 뒤 최종 확인을 눌러주세요.
            </p>

            {/* Diagnostics */}
            <div className="actions" style={{ marginTop: '10px', alignItems: 'center' }}>
              <button onClick={handleSpeedDiagnostic}>속도 진단</button>
              <span className="muted" style={{ fontSize: '11px' }}>
                {speedDiagnosticInfo}
              </span>
            </div>
          </div>

          {/* Roster Card */}
          <div className="card" id="dashboardRoster">
            <h2>탑승 명단</h2>
            <input
              id="adminSearch"
              placeholder="이름 또는 부서 검색"
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
            />

            <label>상태 필터</label>
            <select
              id="statusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="전체">전체 ({busRoster.length}명)</option>
              <option value="미탑승">미탑승 ({stats.unboarded}명)</option>
              <option value="탑승">탑승 ({stats.boarded}명)</option>
              <option value="불참">불참 ({stats.absent}명)</option>
              <option value="개별이동">개별 이동 ({stats.indiv}명)</option>
            </select>

            {/* Roster List */}
            <div id="adminList" style={{ marginTop: '8px' }}>
              {filteredRoster.length === 0 ? (
                <p className="muted">해당 인원이 없습니다.</p>
              ) : (
                filteredRoster.map((p) => {
                  const isLocked = !!(currentSetting.closed || currentSetting.final);
                  const isBusy = adminPendingActions.has(`status:${p.id}`);
                  const isException = p.status === '불참' || p.status === '개별이동';
                  const boardClass =
                    p.status === '탑승'
                      ? 'is-boarded'
                      : isException
                      ? 'is-exception'
                      : '';
                  const label =
                    p.status === '탑승'
                      ? '✓ 탑승'
                      : isException
                      ? p.status === '개별이동'
                        ? '개별'
                        : '불참'
                      : '미탑승';

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
                          {isLocked ? (
                            <span className="chip warn">{p.status} · 잠금</span>
                          ) : (
                            <>
                              <button
                                className={`board-toggle ${boardClass}`}
                                disabled={isBusy}
                                onClick={() => handleToggleBoarding(p.id, p.name, p.status)}
                                aria-label={`${p.name} 탑승 상태 전환`}
                              >
                                {isBusy ? '저장 중…' : label}
                              </button>
                              <button
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
                            </>
                          )}

                          {adminSession.role === 'master' && (
                            <button
                              onClick={() => handleMoveBus(p)}
                              style={{ padding: '3px 6px', fontSize: '11px', height: '28px' }}
                            >
                              호차↔
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Exception drop-down sub-menu */}
                      {!isLocked && openExceptionMenuId === p.id && (
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
        </div>
      )}

      {/* ---------------- CSV Import Modal ---------------- */}
      {isCsvModalOpen && adminSession && (
        <CsvImportModal
          isOpen={isCsvModalOpen}
          onClose={() => setIsCsvModalOpen(false)}
          role={adminSession.role}
          currentPeople={people}
          onImportComplete={(msg) => showMsg(msg)}
        />
      )}

      {/* ---------------- Admin Settings Modal ---------------- */}
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
