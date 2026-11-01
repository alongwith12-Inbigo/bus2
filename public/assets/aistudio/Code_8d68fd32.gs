/** 워크숍 버스 탑승 확인 - Google Apps Script */
const SHEETS={people:'명단',records:'탑승기록',settings:'운영설정',logs:'변경기록'};
const HEADERS={명단:['ID','이름','부서','출발버스','귀가버스'],탑승기록:['ID','구간','상태','확인시각','확인방식'],운영설정:['구간','버스','마감','최종확인','최종확인시각'],변경기록:['시각','관리자','작업','대상ID','상세']};
const PHASES=['출발','귀가']; const STATES=['미탑승','탑승','불참','개별이동'];
function doGet(){return HtmlService.createHtmlOutputFromFile('Index').setTitle('워크숍 버스 탑승 확인').addMetaTag('viewport','width=device-width,initial-scale=1');}
function setup(){const props=PropertiesService.getScriptProperties();let id=props.getProperty('SHEET_ID');if(!id){const ss=SpreadsheetApp.create('워크숍 버스 탑승 확인 데이터');id=ss.getId();props.setProperty('SHEET_ID',id);}const ss=SpreadsheetApp.openById(id);Object.keys(HEADERS).forEach(name=>{let sh=ss.getSheetByName(name)||ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(HEADERS[name]);sh.setFrozenRows(1);}});const settings=ss.getSheetByName(SHEETS.settings);if(settings.getLastRow()===1)PHASES.forEach(p=>[1,2].forEach(b=>settings.appendRow([p,b,false,false,''])));// 첨부 명단 41명 최초 등록(기존 데이터가 있으면 덮어쓰지 않음)
const peopleSheet=ss.getSheetByName(SHEETS.people);
if(peopleSheet.getLastRow()===1){const seed=INITIAL_PEOPLE.map(r=>[r[0],r[1],r[2],r[3],r[4]]);peopleSheet.getRange(2,1,seed.length,5).setValues(seed);}
Logger.log('스프레드시트: '+ss.getUrl());return ss.getUrl();}
/** 관리자 비밀번호 초기 설정: 프로젝트 설정 > 스크립트 속성에
 * SETUP_PASSWORD_BUS1 / SETUP_PASSWORD_BUS2 / SETUP_PASSWORD_MASTER 값을 각각 입력한 뒤
 * initializeAdminPasswords()를 1회 실행하세요. 임시 속성은 자동 삭제됩니다.
 * 비밀번호는 코드에 입력하지 않으며, 솔트가 포함된 해시만 저장합니다.
 */
function initializeAdminPasswords(){
  const props=PropertiesService.getScriptProperties();
  const roles=[['1','BUS1'],['2','BUS2'],['master','MASTER']];
  const pending=roles.map(([role,key])=>({role,key,password:props.getProperty('SETUP_PASSWORD_'+key)}));
  if(pending.some(x=>!x.password||!/^\d{4}$/.test(x.password)))
    throw Error('SETUP_PASSWORD_BUS1 / BUS2 / MASTER를 모두 서로 다른 숫자 4자리로 입력하세요.');
  if(new Set(pending.map(x=>x.password)).size!==3)throw Error('세 관리자 비밀번호는 서로 달라야 합니다.');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    pending.forEach(x=>{
      const salt=Utilities.getUuid()+Utilities.getUuid();
      props.setProperty('AUTH_HASH_'+x.key,salt+':'+hashPassword_(salt,x.password));
      props.deleteProperty('SETUP_PASSWORD_'+x.key);
      props.deleteProperty('PASSWORD_'+x.key);
      props.deleteProperty('LOGIN_FAIL_'+x.key);
    });
    props.setProperty('AUTH_VERSION',Utilities.getUuid());
    Logger.log('관리자 비밀번호 설정 완료. 기존 관리자 세션은 무효화되었습니다.');
  }finally{lock.releaseLock();}
}
function hashPassword_(salt,password){
  let bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,salt+':'+password,Utilities.Charset.UTF_8);
  // Apps Script 기본 기능만 사용하는 반복 해시. 고보안 비밀번호 저장소의 KDF를 대체하지 않음.
  for(let i=0;i<2500;i++)bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes);
  return Utilities.base64Encode(bytes);
}
function same_(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function authKey_(role){return role==='master'?'MASTER':'BUS'+role;}
// 읽기 캐시: 명단 45초, 탑승기록/운영설정 3초. 변경 직후 해당 캐시 무효화.
// 스프레드시트 직접 수정은 캐시 만료 후 반영됩니다.
let REQUEST_SS_ = null;
function ss_(){
 if(REQUEST_SS_)return REQUEST_SS_;
 const id=PropertiesService.getScriptProperties().getProperty('SHEET_ID');
 if(!id)throw Error('먼저 setup()을 실행하세요.');
 REQUEST_SS_=SpreadsheetApp.openById(id);return REQUEST_SS_;
}
function rows_(name){const sh=ss_().getSheetByName(name);if(!sh)throw Error('시트 없음: '+name);const v=sh.getDataRange().getValues();return {sh,rows:v.slice(1)};}
function cached_(key,ttl,build){
 const cache=CacheService.getScriptCache(),k='bus:v11:'+key;
 const raw=cache.get(k);
 if(raw){try{return JSON.parse(raw);}catch(e){}}
 const result=build();
 try{cache.put(k,JSON.stringify(result),ttl);}catch(e){} // 캐시 실패 시에도 시트 사용
 return result;
}
function clearCache_(...names){
 const cache=CacheService.getScriptCache();
 names.forEach(n=>cache.remove('bus:v11:'+n));
}
function people_(){return cached_('people',45,()=>rows_(SHEETS.people).rows.filter(r=>String(r[0]).trim()).map(r=>({id:String(r[0]).trim(),name:String(r[1]).trim(),dept:String(r[2]),out:Number(r[3]),back:Number(r[4])})));}
function records_(){return cached_('records',3,()=>{const m={};rows_(SHEETS.records).rows.forEach(r=>{if(r[0])m[String(r[0])+'|'+r[1]]={status:String(r[2]),at:r[3] instanceof Date?r[3].toISOString():String(r[3]||''),by:String(r[4]||'')};});return m;});}
function settings_(){return cached_('settings',3,()=>{const m={};rows_(SHEETS.settings).rows.forEach(r=>{m[String(r[0])+'|'+Number(r[1])]={closed:r[2]===true||String(r[2]).toLowerCase()==='true',final:r[3]===true||String(r[3]).toLowerCase()==='true',at:String(r[4]||'')};});return m;});}
function phase_(v){if(!PHASES.includes(v))throw Error('잘못된 구간');return v;}
function bus_(v){const n=Number(v);if(![1,2].includes(n))throw Error('잘못된 버스');return n;}
function member_(id){const p=people_().find(x=>x.id===String(id));if(!p)throw Error('명단에 없는 교직원');return p;}
function assigned_(p,phase){return phase==='출발'?p.out:p.back;}
function maskName_(name){const n=String(name||'').trim();return n.length===3?n[0]+'*'+n[2]:n.length>2?n[0]+'*'.repeat(n.length-2)+n.slice(-1):n;}
/** 관리자연락처 시트: A열 호차(1/2), B열 담당자, C열 전화번호. */
function contactForBus_(bus){return cached_('contact:'+bus,45,()=>{
 const sh=ss_().getSheetByName('관리자연락처');
 if(!sh||sh.getLastRow()<2)return '';
 const rows=sh.getRange(2,1,sh.getLastRow()-1,3).getDisplayValues();
 const match=rows.find(r=>Number(String(r[0]).replace(/[^0-9]/g,''))===Number(bus));
 if(!match)return '';
 const phone=String(match[2]||'').replace(/[^0-9+]/g,'');
 return /^(?:\+82|0)1[016789][0-9]{7,8}$/.test(phone)?phone:'';
});}
function findMyName(fullName,phase){
 phase_(phase);const name=String(fullName||'').trim();
 if(!/^[가-힣]{3}$/.test(name))throw Error('이름 3글자를 정확히 입력해 주세요.');
 const matches=people_().filter(p=>p.name.trim()===name);
 if(!matches.length)return [];
 const r=records_(),s=settings_();
 const phones={};matches.forEach(p=>{const bus=assigned_(p,phase);if(!(bus in phones))phones[bus]=contactForBus_(bus);});
 return matches.filter(p=>p.name.trim()===name).map(p=>({id:p.id,name:maskName_(p.name),dept:p.dept,bus:assigned_(p,phase),status:(r[p.id+'|'+phase]||{}).status||'미탑승',closed:!!(s[phase+'|'+assigned_(p,phase)]||{}).closed,contact:phones[assigned_(p,phase)]}));
}
function selfCheck(fullName,id,phase){
 phase_(phase);const name=String(fullName||'').trim();
 if(!/^[가-힣]{3}$/.test(name))throw Error('이름 3글자를 정확히 입력해 주세요.');
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{clearCache_('settings','records');const p=member_(id);if(p.name.trim()!==name)throw Error('이름과 명단이 일치하지 않습니다.');
 const b=assigned_(p,phase),s=settings_()[phase+'|'+b];if(!s||s.closed||s.final)throw Error('해당 버스 체크가 마감되었습니다.');
 const r=records_()[p.id+'|'+phase];if(r&&r.status!=='미탑승')throw Error('이미 처리된 상태입니다. 담당자에게 문의하세요.');
 writeRecord_(p.id,phase,'탑승','본인');return '탑승 확인 완료';
 }finally{lock.releaseLock();}
}
function login(bus,password){
  const role=String(bus);
  if(!['1','2','master'].includes(role))throw Error('관리자 구분 오류');
  const key=authKey_(role),props=PropertiesService.getScriptProperties();
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const stored=props.getProperty('AUTH_HASH_'+key);
    if(!stored)throw Error('관리자 비밀번호가 설정되지 않았습니다.');
    const now=Date.now(),failKey='LOGIN_FAIL_'+key;
    let attempts={count:0,until:0};
    try{attempts=JSON.parse(props.getProperty(failKey)||'{}');}catch(e){}
    if(attempts.until>now)throw Error('로그인 시도가 많습니다. 잠시 후 다시 시도하세요.');
    const pos=stored.indexOf(':'),salt=stored.slice(0,pos),digest=stored.slice(pos+1);
    const valid=typeof password==='string'&&password.length<=128&&pos>0&&same_(hashPassword_(salt,password),digest);
    if(!valid){
      const count=(attempts.last&&now-attempts.last<15*60*1000?attempts.count||0:0)+1;
      props.setProperty(failKey,JSON.stringify({count,last:now,until:count>=5?now+15*60*1000:0}));
      throw Error(count>=5?'로그인 시도 제한: 15분 후 다시 시도하세요.':'비밀번호가 일치하지 않습니다.');
    }
    props.deleteProperty(failKey);
    const token=Utilities.getUuid()+Utilities.getUuid();
    const version=props.getProperty('AUTH_VERSION')||'';
    CacheService.getScriptCache().put('session:'+token,JSON.stringify({role,version}),3600);
    return {token,role};
  }finally{lock.releaseLock();}
}
function auth_(token,b){
  if(typeof token!=='string'||!token||token.length>100)throw Error('로그인이 필요합니다.');
  const raw=CacheService.getScriptCache().get('session:'+token);
  if(!raw)throw Error('로그인이 만료되었습니다.');
  let session;try{session=JSON.parse(raw);}catch(e){throw Error('세션 오류');}
  if(session.version!==(PropertiesService.getScriptProperties().getProperty('AUTH_VERSION')||''))throw Error('로그인이 만료되었습니다.');
  if(b!==undefined&&session.role!=='master'&&Number(session.role)!==Number(b))throw Error('담당 버스 권한이 없습니다.');
  return session.role;
}
function logout(token){CacheService.getScriptCache().remove('session:'+String(token));return true;}
function dashboard(token,phase){phase_(phase);const role=auth_(token),r=records_(),s=settings_();return {role,people:people_().filter(p=>role==='master'||assigned_(p,phase)===Number(role)).map(p=>({...p,name:p.name,bus:assigned_(p,phase),status:(r[p.id+'|'+phase]||{}).status||'미탑승',at:(r[p.id+'|'+phase]||{}).at||'',by:(r[p.id+'|'+phase]||{}).by||''})),settings:s};}
function writeRecord_(id,phase,status,by){const {sh,rows}=rows_(SHEETS.records),idx=rows.findIndex(r=>String(r[0])===String(id)&&r[1]===phase);const vals=[String(id),phase,status,new Date(),by];if(idx>=0)sh.getRange(idx+2,1,1,5).setValues([vals]);else sh.appendRow(vals);clearCache_('records');}
function log_(role,action,id,detail){ss_().getSheetByName(SHEETS.logs).appendRow([new Date(),role,action,id,detail]);}
function setStatus(token,id,phase,status){phase_(phase);if(!STATES.includes(status))throw Error('잘못된 상태');const lock=LockService.getScriptLock();lock.waitLock(20000);try{clearCache_('settings');const p=member_(id),b=assigned_(p,phase),role=auth_(token,b),s=settings_()[phase+'|'+b];if(s.closed||s.final)throw Error('마감 또는 최종 확인 상태입니다. 먼저 해제하세요.');writeRecord_(p.id,phase,status,'관리자');log_(role,'상태변경',p.id,phase+': '+status);return true;}finally{lock.releaseLock();}}
/** v16: 중간 정차 시 현재 구간의 선택한 호차만 다시 전원 미탑승으로 시작.
 * 기존 출발/귀가 탭과 명단/버스 배정은 유지. 변경 전 상태는 변경기록에 저장.
 * 마감/최종확인은 재개 처리. 다른 호차와 다른 구간의 기록은 유지.
 */
function resetBoardingForStop(token,phase,b){
 phase_(phase);b=bus_(b);
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  const role=auth_(token,b);
  // 반드시 시트에서 최신 배정/기록을 읽어 재설정 대상 확정
  const {rows:members}=rows_(SHEETS.people);
  const idSet=new Set(members.filter(r=>Number(r[phase==='출발'?3:4])===b).map(r=>String(r[0]).trim()).filter(Boolean));
  if(!idSet.size)throw Error('초기화할 탑승 명단이 없습니다.');
  const {sh,rows}=rows_(SHEETS.records);
  const before=[];let changed=0;
  const updated=rows.map(r=>{
   const row=r.slice(0,5),id=String(row[0]).trim();
   if(row[1]===phase&&idSet.has(id)){
    before.push([id,String(row[2]||'미탑승')]);
    if(String(row[2])!=='미탑승')changed++;
    row[2]='미탑승';row[3]=new Date();row[4]='관리자 초기화';
   }
   return row;
  });
  // 하나의 시트 쓰기로 기록 일괄 초기화. 기존 기록이 없는 인원은 원래 미탑승으로 표시됨.
  if(rows.length&&changed)sh.getRange(2,1,updated.length,5).setValues(updated);
  const {sh:settingsSh,rows:settingsRows}=rows_(SHEETS.settings);
  const index=settingsRows.findIndex(r=>r[0]===phase&&Number(r[1])===b);
  if(index<0)throw Error('운영 설정이 없습니다.');
  settingsSh.getRange(index+2,3,1,3).setValues([[false,false,'']]);
  // 명단 전체 스냅샷을 변경기록에 보관하여 이전 상태 추적 가능
  log_(role,'중간정차 초기화','',JSON.stringify({phase,b,people:idSet.size,changed,before}));
  clearCache_('records','settings');
  return {phase,b,count:idSet.size,changed};
 }finally{lock.releaseLock();}
}
function updateSetting_(phase,b,patch){const {sh,rows}=rows_(SHEETS.settings),i=rows.findIndex(r=>r[0]===phase&&Number(r[1])===b);if(i<0)throw Error('운영 설정 누락');const current=rows[i];sh.getRange(i+2,1,1,5).setValues([[phase,b,patch.closed===undefined?current[2]:patch.closed,patch.final===undefined?current[3]:patch.final,patch.at===undefined?current[4]:patch.at]]);clearCache_('settings');}
function setClosed(token,phase,b,closed){phase_(phase);b=bus_(b);const lock=LockService.getScriptLock();lock.waitLock(20000);try{clearCache_('settings');const role=auth_(token,b);const current=settings_()[phase+'|'+b];if(!closed&&current.final)throw Error('최종 확인을 먼저 해제하세요.');updateSetting_(phase,b,{closed:!!closed});log_(role,'마감변경','',phase+' '+b+'호차: '+closed);return true;}finally{lock.releaseLock();}}
function setFinal(token,phase,b,value){phase_(phase);b=bus_(b);const lock=LockService.getScriptLock();lock.waitLock(20000);try{clearCache_('settings','records');const role=auth_(token,b);if(value){const setting=settings_()[phase+'|'+b];if(!setting.closed)throw Error('체크를 먼저 마감한 후 최종 확인하세요.');const rec=records_();const pending=people_().filter(p=>assigned_(p,phase)===b&&(!rec[p.id+'|'+phase]||rec[p.id+'|'+phase].status==='미탑승'));if(pending.length)throw Error('미확인 '+pending.length+'명이 남아 있습니다.');}updateSetting_(phase,b,{final:!!value,at:value?new Date():''});log_(role,'최종확인','',phase+' '+b+'호차: '+value);return true;}finally{lock.releaseLock();}}
function moveBus(token,id,phase,newBus){phase_(phase);newBus=bus_(newBus);const lock=LockService.getScriptLock();lock.waitLock(20000);try{clearCache_('people','settings');const role=auth_(token);if(role!=='master')throw Error('버스 변경은 총괄 관리자만 가능합니다.');const p=member_(id),old=assigned_(p,phase);if(old===newBus)return true;const s=settings_();if(s[phase+'|'+old].final||s[phase+'|'+newBus].final||s[phase+'|'+old].closed||s[phase+'|'+newBus].closed)throw Error('양쪽 버스의 마감·최종 확인을 먼저 해제하세요.');const {sh,rows}=rows_(SHEETS.people),i=rows.findIndex(r=>String(r[0])===p.id);sh.getRange(i+2,phase==='출발'?4:5).setValue(newBus);clearCache_('people');log_(role,'버스변경',p.id,phase+': '+old+'→'+newBus);return true;}finally{lock.releaseLock();}}

const INITIAL_PEOPLE=[["001", "송○금", "인천시교육청 / 장학사", 1, 1], ["002", "김○연", "인천시교육청 / 주무관", 1, 1], ["003", "이름입력필요", "소속확인필요 / 교사", 1, 1], ["004", "서○지", "문곡고등학교 / 교사", 1, 1], ["005", "이○림", "문곡고등학교 / 교사", 1, 1], ["006", "나○은", "문학정보고등학교 / 교사", 1, 1], ["007", "안○진", "문학정보고등학교 / 교사", 1, 1], ["008", "심○이", "영종국제물류고등학교 / 교사", 1, 1], ["009", "유○백", "영종국제물류고등학교 / 교사", 1, 1], ["010", "신○성", "영화국제관광고등학교 / 교사", 1, 1], ["011", "윤○훈", "영화국제관광고등학교 / 교사", 1, 1], ["012", "김○건", "인천기계공업고등학교 / 교사", 1, 1], ["013", "임○홍", "인천기계공업고등학교 / 교사", 1, 1], ["014", "박○원", "인천미래생활고등학교 / 교사", 1, 1], ["015", "이○현", "인천미래생활고등학교 / 교사", 1, 1], ["016", "곽○순", "인천바이오과학고등학교 / 교사", 1, 1], ["017", "김○호", "인천바이오과학고등학교 / 교사", 1, 1], ["018", "안○상", "인천반도체고등학교 / 교사", 1, 1], ["019", "윤○연", "인천반도체고등학교 / 교사", 1, 1], ["020", "박○수", "인천보건고등학교 / 교사", 1, 1], ["021", "박○수", "인천보건고등학교 / 교사", 1, 1], ["022", "우○늘", "인천뷰티예술고등학교 / 교사", 2, 2], ["023", "오○선", "인천비즈니스고등학교 / 교사", 2, 2], ["024", "오○하", "인천비즈니스고등학교 / 교사", 2, 2], ["025", "허○영", "인천생활과학고등학교 / 교사", 2, 2], ["026", "신○식", "인천소방고등학교 / 교사", 2, 2], ["027", "원○희", "인천소방고등학교 / 교사", 2, 2], ["028", "김○룡", "인천여자상업고등학교 / 교사", 2, 2], ["029", "정○원", "인천여자상업고등학교 / 교사", 2, 2], ["030", "이○원", "인천전자마이스터고등학교 / 교사", 2, 2], ["031", "최○우", "인천전자마이스터고등학교 / 교사", 2, 2], ["032", "박○선", "인천중앙여자고등학교 / 교사", 2, 2], ["033", "엄○경", "인천중앙여자고등학교 / 교사", 2, 2], ["034", "서○혁", "인천해양과학고등학교 / 교사", 2, 2], ["035", "이○희", "인천해양과학고등학교 / 교사", 2, 2], ["036", "김○연", "인평자동차고등학교 / 교사", 2, 2], ["037", "홍○진", "인평자동차고등학교 / 교사", 2, 2], ["038", "신○권", "재능고등학교 / 교사", 2, 2], ["039", "박○일", "정석항공과학고등학교 / 교사", 2, 2], ["040", "오○구", "정석항공과학고등학교 / 교사", 2, 2], ["041", "강○미", "한국글로벌셰프고등학교 / 교사", 2, 2], ["042", "박○호", "부평공업고등학교 / 교사", 2, 2]];


// v12: 관리자 동작과 갱신을 한 번의 서버 왕복으로 처리
function loginWithDashboard(bus,password,phase){
 const session=login(bus,password);
 return {session:session,data:dashboard(session.token,phase)};
}
function setStatusWithDashboard(token,id,phase,status){
 setStatus(token,id,phase,status);
 return dashboard(token,phase);
}
function setClosedWithDashboard(token,phase,b,closed){
 setClosed(token,phase,b,closed);
 return dashboard(token,phase);
}
function setFinalWithDashboard(token,phase,b,value){
 setFinal(token,phase,b,value);
 return dashboard(token,phase);
}
function moveBusWithDashboard(token,id,phase,newBus){
 moveBus(token,id,phase,newBus);
 return dashboard(token,phase);
}


/** v13: mutation-only responses. Client updates its in-memory view after confirmed writes. */
function quickSetStatus(token,id,phase,status){setStatus(token,id,phase,status);return {id:String(id),status,phase};}
function quickSetClosed(token,phase,b,closed){setClosed(token,phase,b,closed);return {phase,b:Number(b),closed:!!closed};}
function quickSetFinal(token,phase,b,value){setFinal(token,phase,b,value);return {phase,b:Number(b),final:!!value};}
function quickMoveBus(token,id,phase,newBus){moveBus(token,id,phase,newBus);return {id:String(id),phase,bus:Number(newBus)};}
/** Measures backend execution independently from browser/network overhead. */
function speedDiagnostic(token,phase){
 const t=Date.now();const role=auth_(token);const authMs=Date.now()-t;
 const a=Date.now();const people=people_();const peopleMs=Date.now()-a;
 const b=Date.now();records_();const recordsMs=Date.now()-b;
 const c=Date.now();settings_();const settingsMs=Date.now()-c;
 return {role,authMs,peopleMs,recordsMs,settingsMs,serverMs:Date.now()-t,peopleCount:people.length};
}

/** 로그인 전 이름 구분용 최소 명단. 개인정보가 접속자에게 제공되므로 행사 전용 주소로 운영하세요. */
function getNameDirectory(){return people_().map(p=>({name:p.name,dept:p.dept}));}
