import React, { useState } from 'react';
import { Person, AdminRole } from '../types';
import { batchImportParticipants, clearAllPeopleAndRecords } from '../lib/firestoreService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  role: AdminRole;
  currentPeople: Person[];
  onImportComplete: (msg: string) => void;
}

export function CsvImportModal({
  isOpen,
  onClose,
  role,
  currentPeople,
  onImportComplete
}: Props) {
  const [csvText, setCsvText] = useState('');
  const [previewList, setPreviewList] = useState<Person[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleParse = (text: string) => {
    setParseError(null);
    const lines = text.trim().split('\n');
    if (!lines.length || (lines.length === 1 && !lines[0].trim())) {
      setPreviewList([]);
      return;
    }

    const parsed: Person[] = [];
    const errors: string[] = [];

    // Check if header is present
    let startIndex = 0;
    const firstLine = lines[0].toLowerCase();
    if (
      firstLine.includes('id') ||
      firstLine.includes('이름') ||
      firstLine.includes('부서') ||
      firstLine.includes('호차')
    ) {
      startIndex = 1;
    }

    const parseBus = (val: any) => {
      const num = Number(String(val || '').replace(/[^0-9]/g, ''));
      return num === 2 ? 2 : 1;
    };

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle CSV comma, tab, or multi-space separated
      const delimiter = line.includes('\t') ? '\t' : line.includes(',') ? ',' : /\s{2,}/;
      const cols = line.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''));

      if (cols.length < 2) {
        errors.push(`${i + 1}번째 줄: 컬럼이 부족합니다.`);
        continue;
      }

      let id = '';
      let name = '';
      let dept = '';
      let outBus = 1;
      let backBus = 1;

      if (cols.length >= 5) {
        id = cols[0];
        name = cols[1];
        dept = cols[2];
        outBus = parseBus(cols[3]);
        backBus = parseBus(cols[4]);
      } else if (cols.length === 4) {
        id = cols[0];
        name = cols[1];
        dept = cols[2];
        outBus = parseBus(cols[3]);
        backBus = outBus;
      } else if (cols.length === 3) {
        id = cols[0];
        name = cols[1];
        dept = cols[2];
      } else {
        // Only 2 columns (Name, Dept)
        id = String(i + 1).padStart(3, '0');
        name = cols[0];
        dept = cols[1];
      }

      id = id.trim();
      name = name.trim();
      dept = dept.trim();

      if (!id) {
        id = String(i + 1).padStart(3, '0');
      }

      if (!name) {
        errors.push(`${i + 1}번째 줄: 이름이 비어 있습니다.`);
        continue;
      }

      parsed.push({
        id,
        name,
        dept: dept || '소속 미지정',
        out: outBus,
        back: backBus
      });
    }

    if (errors.length > 0) {
      setParseError(errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n... 외 ${errors.length - 5}건` : ''));
    }

    setPreviewList(parsed);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content);
      handleParse(content);
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleApplyImport = async () => {
    if (!previewList.length) return;
    setIsSubmitting(true);
    setParseError(null);
    try {
      const result = await batchImportParticipants(previewList, role);
      onImportComplete(`명단 가져오기 완료: 신규 ${result.added}명, 갱신 ${result.updated}명 등록됨`);
      onClose();
    } catch (e: any) {
      let rawMsg = e.message || String(e);
      try {
        const parsed = JSON.parse(rawMsg);
        if (parsed.error) rawMsg = parsed.error;
      } catch {
        // keep rawMsg
      }
      setParseError('저장 실패: ' + rawMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadSampleData = () => {
    const sample = `ID,이름,부서,출발호차,귀가호차
051,홍길동,인천하이텍고 / 교사,1,1
052,이순신,인천해사고 / 교사,1,1
053,강감찬,인천과학고 / 교사,2,2
054,신사임당,인천예술고 / 교사,2,2`;
    setCsvText(sample);
    handleParse(sample);
  };

  const existingIds = new Set(currentPeople.map((p) => p.id));

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
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          margin: 0,
          background: 'white',
          borderRadius: '16px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
        }}
      >
        <div className="row" style={{ marginBottom: '10px' }}>
          <h2>명단 가져오기 (CSV)</h2>
          <button onClick={onClose} style={{ padding: '4px 10px', fontSize: '13px' }}>
            ✕ 닫기
          </button>
        </div>

        <p className="muted">
          기존 구글 시트나 엑셀에서 복사한 명단을 붙여넣거나 CSV 파일을 업로드하여 Firestore에 일괄 등록합니다.
          기존 ID가 있으면 정보를 갱신하고, 없으면 신규 추가합니다.
        </p>

        <div style={{ margin: '10px 0', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <label
            className="btn"
            style={{
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              margin: 0,
              fontSize: '12px'
            }}
          >
            📁 CSV 파일 선택
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
          <button type="button" onClick={loadSampleData} style={{ fontSize: '12px' }}>
            가상 테스트 데이터 입력
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('현재 등록된 참가자 명단과 탑승 기록을 모두 삭제할까요?')) return;
              if (!window.confirm('삭제 후에는 되돌릴 수 없습니다. 진행하시겠습니까?')) return;
              setIsSubmitting(true);
              try {
                const res = await clearAllPeopleAndRecords(role);
                onImportComplete(`명단 ${res.peopleCount}명 전체 삭제 완료`);
                setPreviewList([]);
                setCsvText('');
              } catch (e: any) {
                setParseError('삭제 실패: ' + (e.message || String(e)));
              } finally {
                setIsSubmitting(false);
              }
            }}
            style={{ fontSize: '12px', color: '#b93838', borderColor: '#f1c1c1', background: '#fff9f9' }}
          >
            🗑️ 현재 명단 전체 비우기
          </button>
        </div>

        <label style={{ fontSize: '12px', fontWeight: 650 }}>CSV 데이터 직접 입력 / 붙여넣기</label>
        <textarea
          rows={5}
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            handleParse(e.target.value);
          }}
          placeholder="ID,이름,부서(소속),출발호차,귀가호차&#10;001,송원금,인천시교육청 / 장학사,1,1"
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            border: '1px solid #cbd9e7',
            borderRadius: '6px',
            boxSizing: 'border-box'
          }}
        />

        {parseError && (
          <div
            style={{
              padding: '8px',
              backgroundColor: '#fff0ef',
              color: '#a12828',
              borderRadius: '6px',
              fontSize: '11px',
              marginTop: '6px',
              whiteSpace: 'pre-wrap'
            }}
          >
            {parseError}
          </div>
        )}

        {previewList.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
              미리보기 (총 {previewList.length}명)
            </div>
            <div
              style={{
                maxHeight: '160px',
                overflowY: 'auto',
                border: '1px solid #e1e8f2',
                borderRadius: '6px',
                fontSize: '11px'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f5f8fc', borderBottom: '1px solid #e1e8f2' }}>
                    <th style={{ padding: '6px' }}>구분</th>
                    <th style={{ padding: '6px' }}>ID</th>
                    <th style={{ padding: '6px' }}>이름</th>
                    <th style={{ padding: '6px' }}>소속</th>
                    <th style={{ padding: '6px' }}>출발</th>
                    <th style={{ padding: '6px' }}>귀가</th>
                  </tr>
                </thead>
                <tbody>
                  {previewList.map((p, idx) => {
                    const exists = existingIds.has(p.id);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f0f4f8' }}>
                        <td style={{ padding: '5px 6px' }}>
                          <span
                            className={`chip ${exists ? 'warn' : 'ok'}`}
                            style={{ fontSize: '9px', padding: '2px 4px' }}
                          >
                            {exists ? '기존 갱신' : '신규 추가'}
                          </span>
                        </td>
                        <td style={{ padding: '5px 6px', fontWeight: 650 }}>{p.id}</td>
                        <td style={{ padding: '5px 6px' }}>{p.name}</td>
                        <td style={{ padding: '5px 6px', color: '#65748c' }}>{p.dept}</td>
                        <td style={{ padding: '5px 6px' }}>{p.out}호차</td>
                        <td style={{ padding: '5px 6px' }}>{p.back}호차</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={isSubmitting}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleApplyImport}
            disabled={isSubmitting || previewList.length === 0}
          >
            {isSubmitting ? '저장 중...' : `Firestore에 ${previewList.length}명 등록`}
          </button>
        </div>
      </div>
    </div>
  );
}
