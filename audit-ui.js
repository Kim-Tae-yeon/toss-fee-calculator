import {fromJSON,fromCSV,parseCSV,guessColumns,format} from './engine.js?v=1.2.0';
import {convert,formatProduct,reconcile,auditCSV,evidenceCoverage} from './audit.js?v=1.2.0';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
let current=null,conversion=null,generation=0;
export function clearAudit(){generation++;current=conversion=null;$('audit-section').hidden=true;$('compare-file').value='';$('comparison').replaceChildren();}
function stats(items){const list=document.createElement('dl');list.className='comparison-stats';for(const [label,value] of items){const cell=document.createElement('div');cell.append(node('dt',label),node('dd',value));list.append(cell);}return list;}
export function showAudit(report){
  clearAudit();current=report;conversion=convert(report);$('audit-section').hidden=false;
  const box=$('conversion');box.replaceChildren();
  const coverage=evidenceCoverage(report,conversion);
  box.append(node('h3',conversion.actualComplete?'입력 자료의 원화 부과액 합계':conversion.complete?'참고 환산 완료 · 실제 원화 지출과 달라요':'원화 환산에 필요한 자료가 더 있어요'));
  box.append(stats([['수수료 금액 확인률',coverage.feePercent||'계산 불가'],['원화 환산 근거 확보율',coverage.conversionPercent||'계산 불가']]));
  box.append(node('p',`불러온 ${coverage.total}건 중 수수료 금액 확인 ${coverage.feeRows}건 · 환산 근거 확보 ${coverage.convertedRows}건. 건수 기준이며 금액 비중·정확도·전체 기간의 확보율이 아닙니다. 입력한 근거의 진위는 자동 검증하지 않습니다. 비율은 소수 둘째 자리 아래를 버립니다.`));
  box.append(node('p',`원화 원금액 + 근거를 입력한 원화 부과액: ${formatProduct(conversion.posted)}원`));
  if(conversion.referenceRows)box.append(node('p',`참고 환율로 환산한 달러 수수료: ${formatProduct(conversion.reference)}원 · ${conversion.referenceRows}건 (실제 원화 출금액 아님)`));
  if(conversion.complete){
    box.append(node('strong',`${conversion.referenceRows?'참고 환산 합계':'입력 자료 원화 합계'}: ${formatProduct(conversion.combined,true)}원`));
    box.append(node('p',`반올림 전 ${formatProduct(conversion.combined)}원. 거래별 중간 반올림 없이 합산 후 1원 단위 반올림.`));
  }else box.append(node('strong',`전체 원화 합계 미확정 · 확인 필요 ${conversion.issues.length}건 · 미환산 ${format(conversion.unconvertedUSD)} USD`));
  box.append(node('h3','전체 비용의 오차 상한: 산정 불가'));
  box.append(node('p','자료 밖의 거래·환전·기타 비용이 얼마나 누락됐는지 알 수 없어 “오차 ±몇 % 이내”를 보장할 수 없습니다. 확인률이 100%여도 전체 비용이 정확하다는 뜻은 아닙니다.'));
  const why=document.createElement('details');why.append(node('summary','확정할 수 없는 이유와 확인 방법'));
  const reasons=document.createElement('ul');
  for(const {reason,count} of coverage.reasons)reasons.append(node('li',`${reason} · ${count}건. 아래 거래 목록과 원본 자료를 확인해주세요.`));
  for(const text of ['전체 계좌·기간: 입력 자료 밖의 누락 건수와 금액은 알 수 없습니다. 계좌 개설일부터 전체 계좌의 거래내역서와 대조해야 합니다.','API 조회 범위: 일부 시간외 주문, 환전·입출금 비용은 주문 API로 확인되지 않습니다. 해당 거래내역서의 수수료·환급 항목이 필요합니다.','달러의 실제 원화 비용: 참고 환율은 실제 환전·원화 출금액과 다를 수 있습니다. 실제 부과액 또는 외화 입출금 원장과 비용 배분 기준이 필요합니다.','계산 정밀도: 원본 소수점 8자리와 환율 8자리를 정수로 계산하며 중간 반올림을 하지 않습니다. 최종 원 단위 표시의 반올림 차이는 최대 0.5원이며, 자료 누락이나 환율 차이의 오차 상한이 아닙니다.'])reasons.append(node('li',text));
  why.append(reasons);box.append(why);
  const issues=$('conversion-issues');issues.replaceChildren();
  for(const r of conversion.issues.slice(0,50))issues.append(node('li',`${r.date||'날짜 없음'} · ${r.currency} · ${r.reason}`));
  $('issues-details').hidden=!conversion.issues.length;$('issues-details').open=false;
  $('issues-summary').textContent=`확인이 필요한 ${conversion.issues.length}건 보기 (최대 50건 표시)`;
  $('conversion-status').textContent='';
  $('conversion-status').className='';
}
$('audit-export').addEventListener('click',()=>{
  if(!conversion)return;
  const url=URL.createObjectURL(new Blob([auditCSV(conversion)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='fee-conversion-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('compare-file').addEventListener('change',async()=>{
  const selected=++generation,primary=current;$('comparison').replaceChildren();
  const file=$('compare-file').files[0];$('conversion-status').textContent='';$('conversion-status').className='';if(!file||!primary)return;
  $('conversion-status').textContent='대조 파일을 읽고 있어요…';
  try{
    if(!/\.(csv|tsv|json)$/i.test(file.name))throw Error('CSV·TSV·JSON 파일을 선택해주세요.');
    if(file.size>15*1024*1024)throw Error('15MB 이하 파일을 선택해주세요.');
    const bytes=await file.arrayBuffer();if(selected!==generation)return;
    let text=new TextDecoder().decode(bytes);if(text.includes('\ufffd'))text=new TextDecoder('euc-kr').decode(bytes);
    const parsed=file.name.toLowerCase().endsWith('.json')?null:parseCSV(text);
    const rows=parsed?fromCSV(parsed,guessColumns(parsed.headers)):fromJSON(JSON.parse(text));
    const r=reconcile(primary.rows,rows),out=$('comparison');
    out.append(node('h3','자료 대조 결과'));
    out.append(node('p',`대조 파일: ${file.name}`));
    out.append(stats([['식별자·금액 일치',`${r.matched}건`],['금액 불일치',`${r.conflicts}건`],['기준 자료에만',`${r.primaryOnly}건`],['대조 자료에만',`${r.comparisonOnly}건`]]));
    for(const a of r.amounts)out.append(node('p',`${a.currency} 합계 차이율: ${a.percent??'산정 불가'} · 기준 ${format(a.primary)} / 대조 ${format(a.comparison)} / 차이 ${format(a.difference)} ${a.currency}${a.reason?' · '+a.reason:''}`));
    out.append(node('p','차이율 = |기준 합계 − 대조 합계| ÷ |대조 합계| × 100. 선택한 두 파일의 금액 차이이며 전체 비용의 오차 상한이 아닙니다. 기간·계좌·비용 항목이 같아야 의미가 있고, 서로 다른 오류가 상쇄되어 0%가 될 수도 있습니다.'));
    out.append(node('p',`계좌 또는 식별자가 없는 내역 ${r.unidentified}건은 거래별 자동 대조가 불가능합니다.`));
    out.append(node('p',`계좌·통화·날짜별 불일치 또는 누락 ${r.mismatchDays}개 / 날짜 미확인 ${r.undated}건 / 수수료 빈 값 ${r.primaryMissing+r.comparisonMissing}개. 계좌 이름이 다른 자료는 먼저 같은 계좌 구분으로 맞춰주세요. 일별 합계 일치는 거래별 일치나 전체 기간 완전성을 증명하지 않습니다.`));
    if(r.details.length){const detail=document.createElement('details'),list=document.createElement('ul');detail.append(node('summary',`거래별 불일치·누락 사유 ${r.details.length}건 (최대 100건 표시)`));for(const row of r.details.slice(0,100))list.append(node('li',`${row.account} · ${row.id} · ${row.status}`));detail.append(list);out.append(detail);}
    const table=document.createElement('table');const head=document.createElement('tr');
    for(const t of ['계좌','날짜','통화','기준 자료','대조 자료','차이'])head.append(node('th',t));table.append(head);
    for(const d of r.daily.filter(d=>d.difference!==0n||!d.primaryCount||!d.comparisonCount||d.missing).slice(0,100)){
      const tr=document.createElement('tr');for(const t of [d.account||'미확인',d.date,d.currency,format(d.primary),format(d.comparison),format(d.difference)])tr.append(node('td',t));table.append(tr);
    }
    if(r.mismatchDays){const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','일별 금액 차이');wrap.append(table);out.append(wrap);out.append(node('p','일별 차이는 최대 100개 표시합니다. 해외 현지 거래일과 한국 날짜 차이도 확인해주세요.'));}
    else{const empty=node('p','날짜별 합계에서 차이를 찾지 못했어요. 위의 거래 식별자 대조 결과도 함께 확인해주세요.');empty.className='table-empty';out.append(empty);}
    $('conversion-status').textContent='대조 완료. 합계는 처음 선택한 기준 자료를 유지합니다. 정정·환급과 누락 내역은 원본을 확인해 기준 자료에 반영하세요.';
  }catch(e){$('conversion-status').textContent=e.message;$('conversion-status').className='error';$('compare-file').value='';}
});
