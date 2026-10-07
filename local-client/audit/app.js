import {showAudit,clearAudit} from './audit-ui.js?v=1.2.0';
import {parseCSV,guessColumns,fromCSV,fromJSON,fromText,summarize,format,exportCSV} from './engine.js?v=1.2.0';
const $=id=>document.getElementById(id);
let parsed=null,report=null,demo=false,readGeneration=0,sourceName='';
const fields={currency:'통화',fee:'매매 수수료',fx:'환전 수수료',tax:'세금',date:'날짜',symbol:'종목',id:'거래·주문번호',account:'계좌 구분',kind:'매매 구분',other:'기타 수수료',refund:'수수료 환급 (양수)',interest:'지급 이자 (별도)',paidKrw:'수수료 원화 부과액',rate:'참고 환율 (원/USD)',rateDate:'환율 기준일시',evidence:'환산 근거·출처',settlement:'결제일'};
const example='date,currency,symbol,commission,fxfee,tax,orderId\n2026-01-02,KRW,가상 국내주식,15,0,0,demo-1\n2026-01-03,USD,가상 해외주식,0.25,0,0.01,demo-2\n2026-01-04,KRW,가상 환전,0,120,0,demo-3';
function message(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function node(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function discardResult(){clearAudit();report=null;$('results').hidden=true;$('rows').replaceChildren();$('totals').replaceChildren();}
function show(records){
  discardResult(); const next=summarize(records);report=next;
  $('result-label').textContent=demo?'가상 예시 · 실제 거래가 아니에요':(sourceName||'불러온 자료의 결과');
  for(const [c,t] of Object.entries(report.totals)){
    const card=node('article');card.append(node('h3',c==='KRW'?'원화 수수료':'달러 수수료'));
    const value=node('p',(t.known?format(t.fee+t.fx+t.other-t.refund):'미확인')+' '+(c==='KRW'?'원':'USD'));value.className='amount';card.append(value);
    if(report.missing){const badge=node('span','미확인 항목이 있는 부분 합계');badge.className='status-chip';card.append(badge);}
    const lines=node('dl');lines.className='fee-lines';
    for(const [label,v,key] of [['매매',t.fee,'fee'],['환전',t.fx,'fx'],['기타 수수료',t.other,'other'],['환급 차감',t.refund,'refund'],['세금 · 별도',t.tax,'tax'],['이자 · 별도',t.interest,'interest']]){
      const rows=report.rows.filter(r=>r.currency===c),known=rows.some(r=>r[key]!=null),unknown=rows.some(r=>r[key+'Expected']&&r[key]==null);
      const line=node('div');if(key==='tax')line.className='separate';line.append(node('dt',label),node('dd',known?`${format(v)} ${c}${unknown?' · 일부 미확인':''}`:'자료 없음'));lines.append(line);
    }card.append(lines);$('totals').append(card);
  }
  $('coverage').textContent=`${demo?'가상 데이터입니다. ':''}입력한 ${records.length}개 중 ${report.rows.length}개를 계산했어요. 같은 식별자의 중복 ${report.duplicates}개 제외. ${report.missing?`수수료 빈 값 ${report.missing}개는 0으로 처리하지 않은 부분 합계입니다. `:''}선택한 기간·파일에 포함된 내역만의 합계이며, 계좌 전체 비용을 보장하지 않습니다.`;
  $('warnings').textContent=`세금 항목 미표시 ${report.unknownTax}개. 거래번호 없는 ${report.unidentified}개는 중복 여부를 판단할 수 없어 각각 계산했어요. 서로 다른 계좌의 파일을 합칠 때는 계좌 구분도 포함하세요.`;
  showAudit(report);
  for(const r of report.rows.slice(0,300)){const tr=node('tr');for(const value of [r.date,r.symbol||r.kind,r.currency,...['fee','fx','other','refund','tax','interest'].map(k=>r[k]==null?'—':format(r[k]))])tr.append(node('td',value));$('rows').append(tr);}
  $('results').hidden=false;message(demo?'가상 예시를 계산했어요. 본인의 파일로 바꿔보세요.':'계산을 완료했어요. 내역은 이 브라우저에만 있어요.');
}
function loadCSV(text){discardResult();parsed=parseCSV(text);const guess=guessColumns(parsed.headers);$('columns').replaceChildren();$('extra-columns').replaceChildren();$('extra-mapping').open=false;for(const [key,label] of Object.entries(fields)){const wrap=node('label',label);const select=node('select');select.id='map-'+key;const empty=node('option','선택하지 않음');empty.value='-1';select.append(empty);parsed.headers.forEach((h,i)=>{const option=node('option',h);option.value=String(i);select.append(option);});select.value=String(guess[key]);wrap.append(select);$(['currency','fee','fx','date','symbol'].includes(key)?'columns':'extra-columns').append(wrap);} $('fixed-currency').value='';$('file-info').textContent=`${sourceName?sourceName+' · ':''}${parsed.rows.length}개 행. 통화와 수수료 열이 올바른지 확인해주세요.`;$('mapping').hidden=false;message('열 선택을 확인한 뒤 계산하기를 눌러주세요.');}
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>{for(const t of document.querySelectorAll('[data-tab]'))t.setAttribute('aria-pressed',String(t===b));for(const key of ['file','paste','api'])$(key+'-panel').hidden=b.dataset.tab!==key;});
$('file').addEventListener('change',async()=>{const file=$('file').files[0];if(!file)return;const generation=++readGeneration;discardResult();parsed=null;demo=false;sourceName=file.name;$('mapping').hidden=true;message('파일을 읽고 있어요…');try{if(!/\.(csv|tsv|json)$/i.test(file.name))throw Error('CSV·TSV·JSON 파일을 선택해주세요. PDF·XLSX는 지원하지 않아요.');if(file.size>15*1024*1024)throw Error('15MB 이하 파일을 선택해주세요.');const bytes=await file.arrayBuffer();if(generation!==readGeneration)return;let text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);if(text.includes('\ufffd'))text=new TextDecoder('euc-kr').decode(bytes);if(file.name.toLowerCase().endsWith('.json'))loadReport(JSON.parse(text),file.name);else loadCSV(text);}catch(e){message(e.message,true);$('file').value='';}});
$('calculate').addEventListener('click',()=>{discardResult();try{if(!parsed)throw Error('파일을 먼저 선택해주세요.');const map=Object.fromEntries(Object.keys(fields).map(k=>[k,Number($('map-'+k).value)]));show(fromCSV(parsed,map,$('fixed-currency').value));$('results').focus();}catch(e){message(e.message,true);}});
$('calculate-paste').addEventListener('click',()=>{readGeneration++;discardResult();parsed=null;$('mapping').hidden=true;$('file').value='';demo=false;sourceName='직접 붙여넣은 내역';try{show(fromText($('paste').value));$('results').focus();}catch(e){message(e.message,true);}});
$('demo').addEventListener('click',()=>{readGeneration++;demo=true;sourceName='가상 예시';$('file').value='';loadCSV(example);$('calculate').click();$('mapping').hidden=true;$('results').focus();});
$('template').addEventListener('click',()=>download('\uFEFFdate,currency,symbol,commission,fxfee,tax,orderId,account,otherFee,refund,interest,paidKrw,rate,rateDate,evidence,settlementDate\r\n','fee-template.csv'));
$('export').addEventListener('click',()=>{if(report)download(exportCSV(report),demo?'example-fees.csv':'my-fees.csv');});
$('clear').addEventListener('click',()=>{readGeneration++;discardResult();parsed=null;demo=false;sourceName='';$('file').value='';$('paste').value='';$('columns').replaceChildren();$('extra-columns').replaceChildren();$('mapping').hidden=true;message('파일과 계산 결과를 지웠어요.');$('start').focus();});

export function loadReport(payload,name=''){readGeneration++;parsed=null;demo=false;sourceName=name||payload.source||'불러온 JSON';$("mapping").hidden=true;show(fromJSON(payload));document.querySelector('[data-tab="file"]').click();$('results').focus();}
