import {parseCSV,guessColumns,fromCSV,fromJSON,fromText,summarize,format,exportCSV} from './engine.js';
const $=id=>document.getElementById(id);
let parsed=null,report=null,demo=false,readGeneration=0;
const fields={currency:'통화',fee:'매매 수수료',fx:'환전 수수료',tax:'세금',date:'날짜',symbol:'종목',id:'거래·주문번호',account:'계좌 구분',kind:'매매 구분'};
const example='date,currency,symbol,commission,fxfee,tax,orderId\n2026-01-02,KRW,가상 국내주식,15,,0,demo-1\n2026-01-03,USD,가상 해외주식,0.25,,0.01,demo-2\n2026-01-04,KRW,가상 환전,,120,,demo-3';
function message(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function node(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function discardResult(){report=null;$('results').hidden=true;$('rows').replaceChildren();$('totals').replaceChildren();}
function show(records){
  discardResult(); const next=summarize(records);report=next;
  $('result-label').textContent=demo?'DEMO · 가상 예시 결과':'YOUR RESULTS · 내 파일의 결과';
  for(const [c,t] of Object.entries(report.totals)){
    const card=node('article');card.append(node('h3',c==='KRW'?'원화 수수료':'달러 수수료'));
    const value=node('p',(t.known?format(t.fee+t.fx):'미확인')+' '+(c==='KRW'?'원':'USD'));value.className='amount';card.append(value);
    for(const [label,v] of [['매매',t.fee],['환전',t.fx],['세금 (별도)',t.tax]]){const line=node('p',`${label}  ${format(v)} ${c}`);line.className='hint';card.append(line);} $('totals').append(card);
  }
  $('coverage').textContent=`${demo?'가상 데이터입니다. ':''}입력한 ${records.length}개 중 ${report.rows.length}개를 계산했어요. 같은 식별자의 중복 ${report.duplicates}개 제외. ${report.missing?`수수료 빈 값 ${report.missing}개는 0으로 처리하지 않은 부분 합계입니다. `:''}선택한 기간·파일에 포함된 내역만의 합계이며, 계좌 전체 비용을 보장하지 않습니다.`;
  $('warnings').textContent=`세금 항목 미표시 ${report.unknownTax}개. 거래번호 없는 ${report.unidentified}개는 중복 여부를 판단할 수 없어 각각 계산했어요. 서로 다른 계좌의 파일을 합칠 때는 계좌 구분도 포함하세요.`;
  for(const r of report.rows.slice(0,300)){const tr=node('tr');for(const value of [r.date,r.symbol||r.kind,r.currency,format(r.fee),format(r.fx),format(r.tax)])tr.append(node('td',value));$('rows').append(tr);}
  $('results').hidden=false;message(demo?'가상 예시를 계산했어요. 본인의 파일로 바꿔보세요.':'계산을 완료했어요. 내역은 이 브라우저에만 있어요.');
}
function loadCSV(text){discardResult();parsed=parseCSV(text);const guess=guessColumns(parsed.headers);$('columns').replaceChildren();for(const [key,label] of Object.entries(fields)){const wrap=node('label',label);const select=node('select');select.id='map-'+key;const empty=node('option','선택하지 않음');empty.value='-1';select.append(empty);parsed.headers.forEach((h,i)=>{const option=node('option',h);option.value=String(i);select.append(option);});select.value=String(guess[key]);wrap.append(select);$('columns').append(wrap);} $('fixed-currency').value='';$('file-info').textContent=`${parsed.rows.length}개 행을 읽었어요. 제목과 금액 열이 올바른지 확인해주세요.`;$('mapping').hidden=false;message('열 선택을 확인한 뒤 계산하기를 눌러주세요.');}
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>{for(const t of document.querySelectorAll('[data-tab]'))t.setAttribute('aria-pressed',String(t===b));for(const key of ['file','paste','api'])$(key+'-panel').hidden=b.dataset.tab!==key;});
$('file').addEventListener('change',async()=>{const generation=++readGeneration;discardResult();parsed=null;demo=false;$('mapping').hidden=true;const file=$('file').files[0];if(!file)return;try{if(file.size>15*1024*1024)throw Error('15MB 이하 파일을 선택해주세요.');const bytes=await file.arrayBuffer();if(generation!==readGeneration)return;let text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);if(text.includes('\ufffd'))text=new TextDecoder('euc-kr').decode(bytes);if(file.name.toLowerCase().endsWith('.json'))show(fromJSON(JSON.parse(text)));else loadCSV(text);}catch(e){message(e.message,true);}});
$('calculate').addEventListener('click',()=>{discardResult();try{if(!parsed)throw Error('파일을 먼저 선택해주세요.');const map=Object.fromEntries(Object.keys(fields).map(k=>[k,Number($('map-'+k).value)]));show(fromCSV(parsed,map,$('fixed-currency').value));}catch(e){message(e.message,true);}});
$('calculate-paste').addEventListener('click',()=>{discardResult();demo=false;try{show(fromText($('paste').value));}catch(e){message(e.message,true);}});
$('demo').addEventListener('click',()=>{readGeneration++;demo=true;$('file').value='';loadCSV(example);$('calculate').click();});
$('template').addEventListener('click',()=>download('\uFEFFdate,currency,symbol,commission,fxfee,tax,orderId,account\r\n','fee-template.csv'));
$('export').addEventListener('click',()=>{if(report)download(exportCSV(report),demo?'example-fees.csv':'my-fees.csv');});
$('clear').addEventListener('click',()=>{readGeneration++;discardResult();parsed=null;demo=false;$('file').value='';$('paste').value='';$('columns').replaceChildren();$('mapping').hidden=true;message('파일과 계산 결과를 지웠어요.');});
