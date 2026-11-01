export type Phase = '출발' | '귀가';
export type BoardingStatus = '미탑승' | '탑승' | '불참' | '개별이동';
export type AdminRole = '1' | '2' | 'master';

export interface Person {
  id: string;
  name: string;
  dept: string;
  out: number; // 1 or 2
  back: number; // 1 or 2
}

export interface BoardingRecord {
  id: string; // matches Person.id
  phase: Phase;
  status: BoardingStatus;
  at: string;
  by: string; // '본인' | '관리자' | '관리자 초기화'
}

export interface OperationalSetting {
  phase: Phase;
  bus: number;
  closed: boolean;
  final: boolean;
  at?: string;
}

export interface BusContact {
  bus: number;
  name: string;
  phone: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  role: string;
  action: string;
  targetId?: string;
  detail?: string;
}

export const INITIAL_PEOPLE_SEED: Person[] = [
  { id: "001", name: "송원금", dept: "인천시교육청 / 장학사", out: 1, back: 1 },
  { id: "002", name: "김소연", dept: "인천시교육청 / 주무관", out: 1, back: 1 },
  { id: "003", name: "이서준", dept: "교육청지원단 / 교사", out: 1, back: 1 },
  { id: "004", name: "서민지", dept: "문곡고등학교 / 교사", out: 1, back: 1 },
  { id: "005", name: "이예림", dept: "문곡고등학교 / 교사", out: 1, back: 1 },
  { id: "006", name: "나다은", dept: "문학정보고등학교 / 교사", out: 1, back: 1 },
  { id: "007", name: "안유진", dept: "문학정보고등학교 / 교사", out: 1, back: 1 },
  { id: "008", name: "심솔이", dept: "영종국제물류고등학교 / 교사", out: 1, back: 1 },
  { id: "009", name: "유하백", dept: "영종국제물류고등학교 / 교사", out: 1, back: 1 },
  { id: "010", name: "신우성", dept: "영화국제관광고등학교 / 교사", out: 1, back: 1 },
  { id: "011", name: "윤정훈", dept: "영화국제관광고등학교 / 교사", out: 1, back: 1 },
  { id: "012", name: "김동건", dept: "인천기계공업고등학교 / 교사", out: 1, back: 1 },
  { id: "013", name: "임재홍", dept: "인천기계공업고등학교 / 교사", out: 1, back: 1 },
  { id: "014", name: "박지원", dept: "인천미래생활고등학교 / 교사", out: 1, back: 1 },
  { id: "015", name: "이도현", dept: "인천미래생활고등학교 / 교사", out: 1, back: 1 },
  { id: "016", name: "곽효순", dept: "인천바이오과학고등학교 / 교사", out: 1, back: 1 },
  { id: "017", name: "김태호", dept: "인천바이오과학고등학교 / 교사", out: 1, back: 1 },
  { id: "018", name: "안준상", dept: "인천반도체고등학교 / 교사", out: 1, back: 1 },
  { id: "019", name: "윤서연", dept: "인천반도체고등학교 / 교사", out: 1, back: 1 },
  { id: "020", name: "박상수", dept: "인천보건고등학교 / 교사", out: 1, back: 1 },
  { id: "021", name: "박진수", dept: "인천보건고등학교 / 교사", out: 1, back: 1 },
  { id: "022", name: "우하늘", dept: "인천뷰티예술고등학교 / 교사", out: 2, back: 2 },
  { id: "023", name: "오지선", dept: "인천비즈니스고등학교 / 교사", out: 2, back: 2 },
  { id: "024", name: "오주하", dept: "인천비즈니스고등학교 / 교사", out: 2, back: 2 },
  { id: "025", name: "허선영", dept: "인천생활과학고등학교 / 교사", out: 2, back: 2 },
  { id: "026", name: "신현식", dept: "인천소방고등학교 / 교사", out: 2, back: 2 },
  { id: "027", name: "원선희", dept: "인천소방고등학교 / 교사", out: 2, back: 2 },
  { id: "028", name: "김기룡", dept: "인천여자상업고등학교 / 교사", out: 2, back: 2 },
  { id: "029", name: "정혜원", dept: "인천여자상업고등학교 / 교사", out: 2, back: 2 },
  { id: "030", name: "이태원", dept: "인천전자마이스터고등학교 / 교사", out: 2, back: 2 },
  { id: "031", name: "최시우", dept: "인천전자마이스터고등학교 / 교사", out: 2, back: 2 },
  { id: "032", name: "박혜선", dept: "인천중앙여자고등학교 / 교사", out: 2, back: 2 },
  { id: "033", name: "엄유경", dept: "인천중앙여자고등학교 / 교사", out: 2, back: 2 },
  { id: "034", name: "서민혁", dept: "인천해양과학고등학교 / 교사", out: 2, back: 2 },
  { id: "035", name: "이은희", dept: "인천해양과학고등학교 / 교사", out: 2, back: 2 },
  { id: "036", name: "김나연", dept: "인평자동차고등학교 / 교사", out: 2, back: 2 },
  { id: "037", name: "홍서진", dept: "인평자동차고등학교 / 교사", out: 2, back: 2 },
  { id: "038", name: "신동권", dept: "재능고등학교 / 교사", out: 2, back: 2 },
  { id: "039", name: "박종일", dept: "정석항공과학고등학교 / 교사", out: 2, back: 2 },
  { id: "040", name: "오진구", dept: "정석항공과학고등학교 / 교사", out: 2, back: 2 },
  { id: "041", name: "강수미", dept: "한국글로벌셰프고등학교 / 교사", out: 2, back: 2 },
  { id: "042", name: "박태호", dept: "부평공업고등학교 / 교사", out: 2, back: 2 }
];

export const INITIAL_CONTACTS_SEED: BusContact[] = [
  { bus: 1, name: "1호차 담당자", phone: "010-1234-5678" },
  { bus: 2, name: "2호차 담당자", phone: "010-9876-5432" }
];
