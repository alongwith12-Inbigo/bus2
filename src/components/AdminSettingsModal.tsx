import { useState, useEffect } from 'react';
import { BusContact, AdminRole } from '../types';
import { updateBusContact } from '../lib/firestoreService';
import { updateAdminPassword } from '../lib/authService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  role: AdminRole;
  contacts: Record<number, BusContact>;
  onSuccess: (msg: string) => void;
}

export function AdminSettingsModal({
  isOpen,
  onClose,
  role,
  contacts,
  onSuccess
}: Props) {
  const [bus1Name, setBus1Name] = useState('');
  const [bus1Phone, setBus1Phone] = useState('');
  const [bus2Name, setBus2Name] = useState('');
  const [bus2Phone, setBus2Phone] = useState('');

  // Always keep inputs in sync with the real saved contacts in Firestore
  useEffect(() => {
    if (contacts[1]) {
      setBus1Name(contacts[1].name || '');
      setBus1Phone(contacts[1].phone || '');
    } else {
      setBus1Name('');
      setBus1Phone('');
    }

    if (contacts[2]) {
      setBus2Name(contacts[2].name || '');
      setBus2Phone(contacts[2].phone || '');
    } else {
      setBus2Name('');
      setBus2Phone('');
    }
  }, [contacts, isOpen]);

  const [pwRole, setPwRole] = useState<AdminRole>(role);
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveContacts = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      if (role === 'master' || role === '1') {
        await updateBusContact(1, bus1Name, bus1Phone, role);
      }
      if (role === 'master' || role === '2') {
        await updateBusContact(2, bus2Name, bus2Phone, role);
      }
      onSuccess('관리자 연락처가 저장되었습니다.');
      onClose();
    } catch (e: any) {
      setErrorMsg(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPw || newPw.length < 4) {
      setErrorMsg('비밀번호는 최소 4자리 이상 입력해 주세요.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await updateAdminPassword(pwRole, newPw);
      onSuccess(`${pwRole === 'master' ? '총괄' : pwRole + '호차'} 관리자 비밀번호가 클라우드에 저장되었습니다. (모든 기기에 즉시 적용)`);
      setNewPw('');
    } catch (e: any) {
      let rawMsg = e.message || String(e);
      try {
        const parsed = JSON.parse(rawMsg);
        if (parsed.error) rawMsg = parsed.error;
      } catch {}
      setErrorMsg('비밀번호 변경 실패: ' + rawMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(24, 42, 70, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '14px'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '480px',
          maxHeight: '90vh',
          overflowY: 'auto',
          margin: 0,
          background: 'white',
          borderRadius: '16px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
        }}
      >
        <div className="row" style={{ marginBottom: '12px' }}>
          <h2>관리자 및 연락처 설정</h2>
          <button onClick={onClose} style={{ padding: '4px 10px', fontSize: '13px' }}>
            ✕ 닫기
          </button>
        </div>

        {errorMsg && (
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: '#fff0ef',
              color: '#a12828',
              borderRadius: '6px',
              fontSize: '12px',
              marginBottom: '10px'
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Contact settings */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '8px', color: '#1f385c' }}>
            📞 교직원 화면 상단 전화·문자 버튼 연결 번호
          </h3>

          {(role === 'master' || role === '1') && (
            <div style={{ marginBottom: '10px', padding: '8px', background: '#f8fafc', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>1호차 담당자</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  value={bus1Name}
                  onChange={(e) => setBus1Name(e.target.value)}
                  placeholder="이름"
                  style={{ width: '40%' }}
                />
                <input
                  value={bus1Phone}
                  onChange={(e) => setBus1Phone(e.target.value)}
                  placeholder="전화번호 (예: 010-1234-5678)"
                  style={{ width: '60%' }}
                />
              </div>
            </div>
          )}

          {(role === 'master' || role === '2') && (
            <div style={{ marginBottom: '10px', padding: '8px', background: '#f8fafc', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>2호차 담당자</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  value={bus2Name}
                  onChange={(e) => setBus2Name(e.target.value)}
                  placeholder="이름"
                  style={{ width: '40%' }}
                />
                <input
                  value={bus2Phone}
                  onChange={(e) => setBus2Phone(e.target.value)}
                  placeholder="전화번호 (예: 010-9876-5432)"
                  style={{ width: '60%' }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            className="primary"
            onClick={handleSaveContacts}
            disabled={saving}
            style={{ width: '100%', marginTop: '4px' }}
          >
            연락처 저장하기
          </button>
        </div>

        {/* Password change section */}
        <div style={{ borderTop: '1px solid #edf2f7', paddingTop: '14px' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '8px', color: '#1f385c' }}>
            🔒 관리자 비밀번호 변경
          </h3>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            {role === 'master' ? (
              <select
                value={pwRole}
                onChange={(e) => setPwRole(e.target.value as AdminRole)}
                style={{ width: '45%' }}
              >
                <option value="1">1호차 관리자</option>
                <option value="2">2호차 관리자</option>
                <option value="master">총괄 관리자</option>
              </select>
            ) : (
              <input value={`${role}호차 관리자`} disabled style={{ width: '45%', background: '#f1f5f9' }} />
            )}
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="새 비밀번호 (4자리 이상)"
              style={{ width: '55%' }}
            />
          </div>
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={saving || !newPw}
            style={{ width: '100%' }}
          >
            비밀번호 변경 적용
          </button>
        </div>
      </div>
    </div>
  );
}
