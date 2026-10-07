import {fromJSON,fromCSV,parseCSV,guessColumns,format} from './engine.js';
import {convert,formatProduct,reconcile,auditCSV} from './audit.js';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
let current=null,conversion=null,generation=0;
export function clearAudit(){generation++;current=conversion=null;$('audit-section').hidden=true;$('compare-file').value='';$('comparison').replaceChildren();}
export function showAudit(report){
  clearAudit();current=report;conversion=convert(report);$('audit-section').hidden=false;
  const box=$('conversion');box.replaceChildren();
  box.append(node('h3',conversion.actualComplete?'입력 자료의 원화 부과액 합계':'원화 환산: 추가 확인 필요'));
  box.append(node('p',`원화 원금액 + 근거를 입력한 원화 부과액: ${formatProduct(conversion.posted)}원`));
  if(conversion.referenceRows)box.append(node('p',`참고 환율로 환산한 달러 수수료: ${formatProduct(conversion.reference)}원 · ${conversion.referenceRows}건 (실제 원화 출금액 아님)`));
  if(conversion.complete){
    box.append(node('strong',`${conversion.referenceRows?'참고 환산 합계':'입력 자료 원화 합계'}: ${formatProduct(conversion.combined,true)}원`));
    box.append(node('p',`반올림 전 ${formatProduct(conversion.combined)}원. 거래별 중간 반올림 없이 합산 후 1원 단위 반올림.`));
  }else box.append(node('strong',`전체 원화 합계 미확정 · 확인 필요 ${conversion.issues.length}건 · 미환산 ${format(conversion.unconvertedUSD)} USD`));
  box.append(node('p','원화 부과액은 세금·이자 제외, 해당 행의 순수수료만 입력합니다. 달러 마련 비용에 환전 수수료를 포함한 뒤 환전 수수료를 다시 더하면 중복입니다. 참고 환율은 거래일 또는 결제일 기준이며 달러 취득 원가와 다릅니다. 전체 계좌·기간의 자료 완전성은 별도 대조해야 합니다.'));
  const issues=$('conversion-issues');issues.replaceChildren();
  for(const r of conversion.issues.slice(0,50))issues.append(node('li',`${r.date||'날짜 없음'} · ${r.currency} · ${r.reason}`));
  $('conversion-status').textContent='';
}
$('audit-export').addEventListener('click',()=>{
  if(!conversion)return;
  const url=URL.createObjectURL(new Blob([auditCSV(conversion)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='fee-conversion-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('compare-file').addEventListener('change',async()=>{
  const selected=++generation,primary=current;$('comparison').replaceChildren();
  const file=$('compare-file').files[0];if(!file||!primary)return;
  try{
    if(file.size>15*1024*1024)throw Error('15MB 이하 파일을 선택해주세요.');
    const bytes=await file.arrayBuffer();if(selected!==generation)return;
    let text=new TextDecoder().decode(bytes);if(text.includes('\ufffd'))text=new TextDecoder('euc-kr').decode(bytes);
    const parsed=file.name.toLowerCase().endsWith('.json')?null:parseCSV(text);
    const rows=parsed?fromCSV(parsed,guessColumns(parsed.headers)):fromJSON(JSON.parse(text));
    const r=reconcile(primary.rows,rows),out=$('comparison');
    out.append(node('h3','대조 결과 — 두 파일을 더하지 않습니다'));
    out.append(node('p',`계좌·통화·거래번호 일치 및 금액 동일 ${r.matched}건 / 금액 충돌 ${r.conflicts}건 / 기준에만 ${r.primaryOnly}건 / 대조에만 ${r.comparisonOnly}건 / 계좌 또는 식별자 없음 ${r.unidentified}건`));
    out.append(node('p',`계좌·통화·날짜별 불일치 또는 누락 ${r.mismatchDays}개 / 날짜 미확인 ${r.undated}건 / 수수료 빈 값 ${r.primaryMissing+r.comparisonMissing}개. 계좌 이름이 다른 자료는 먼저 같은 계좌 구분으로 맞춰주세요. 일별 합계 일치는 거래별 일치나 전체 기간 완전성을 증명하지 않습니다.`));
    const table=document.createElement('table');const head=document.createElement('tr');
    for(const t of ['계좌','날짜','통화','기준 자료','대조 자료','차이'])head.append(node('th',t));table.append(head);
    for(const d of r.daily.filter(d=>d.difference!==0n||!d.primaryCount||!d.comparisonCount||d.missing).slice(0,100)){
      const tr=document.createElement('tr');for(const t of [d.account||'미확인',d.date,d.currency,format(d.primary),format(d.comparison),format(d.difference)])tr.append(node('td',t));table.append(tr);
    }
    const wrap=document.createElement('div');wrap.className='table-scroll';wrap.append(table);out.append(wrap);
    $('conversion-status').textContent='대조 완료. 합계는 처음 선택한 기준 자료를 유지합니다. 정정·환급과 누락 내역은 원본을 확인해 기준 자료에 반영하세요.';
  }catch(e){$('conversion-status').textContent=e.message;}
});
