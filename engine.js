// Monetary arithmetic stays in scaled integers. Nothing here performs network I/O.
export const SCALE = 100000000n;
export function money(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  let text = String(value).trim().replace(/,/g, '').replace(/(?:KRW|USD|원|₩|\$)/gi, '').trim();
  if (/^\(.*\)$/.test(text)) text = '-' + text.slice(1, -1);
  const match = /^([+-]?)(\d+)(?:\.(\d{1,8}))?$/.exec(text);
  if (!match || match[2].length > 20) throw Error(`금액을 읽을 수 없습니다: ${String(value).slice(0,40)}`);
  return (match[1] === '-' ? -1n : 1n) * (BigInt(match[2]) * SCALE + BigInt((match[3] || '').padEnd(8, '0')));
}
export function format(value) {
  if (value === null || value === undefined) return '미확인';
  const negative = value < 0n; const n = negative ? -value : value;
  const fraction = (n % SCALE).toString().padStart(8,'0').replace(/0+$/,'');
  return (negative ? '-' : '') + (n / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
}
export function currency(value) {
  const text = String(value || '').trim().toUpperCase();
  if (['KRW','원','원화','₩','WON'].includes(text)) return 'KRW';
  if (['USD','달러','$','미국달러','미국 달러'].includes(text)) return 'USD';
  throw Error(`통화를 확인해주세요: ${text || '빈 값'} (KRW 또는 USD)`);
}
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0];
  const sep = first.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') {cell += '"'; i++;}
      else if (!quoted && cell !== '') throw Error('CSV 따옴표 형식이 올바르지 않습니다.');
      else quoted = !quoted;
    } else if (c === sep && !quoted) {row.push(cell); cell='';}
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(cell); if (row.some(s=>s.trim())) rows.push(row); row=[];cell='';
    } else cell += c;
  }
  if (quoted) throw Error('CSV 따옴표가 닫히지 않았습니다.');
  row.push(cell); if (row.some(s=>s.trim())) rows.push(row);
  if (rows.length < 2) throw Error('제목 행과 거래 행이 있는 CSV가 필요합니다.');
  const headers = rows.shift().map(s=>s.trim());
  if (headers.some(s=>!s) || new Set(headers).size !== headers.length) throw Error('CSV 제목이 비어 있거나 중복됐습니다.');
  for (const [i,r] of rows.entries()) if (r.length !== headers.length) throw Error(`${i+2}행의 열 개수가 제목과 다릅니다. 쉼표가 있는 금액은 큰따옴표로 감싸주세요.`);
  return {headers, rows};
}
export const aliases = {
  currency:['currency','통화','통화코드'], fee:['commission','fee','수수료','매매수수료','거래수수료'],
  fx:['exchangefee','fxfee','fxcommission','환전수수료'], tax:['tax','세금','제세금'],
  date:['filledat','date','거래일','거래일자','체결일','일시'], symbol:['symbol','종목','종목명'],
  id:['orderid','transactionid','거래번호','주문번호'], account:['account','계좌','계좌번호'], kind:['type','구분','거래유형','side'],
  other:['otherfee','기타수수료'],refund:['refund','수수료환급'],interest:['interest','지급이자'],
  paidKrw:['paidkrw','수수료원화부과액'],rate:['rate','referenceRate'.toLowerCase(),'참고환율'],
  rateDate:['ratedate','환율기준일시'],evidence:['evidence','근거'],settlement:['settlementdate','결제일']
};
export function guessColumns(headers) {
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headers.findIndex(h=>names.includes(h.toLowerCase().replace(/[\s_]/g,'')))]));
}
export function fromCSV(parsed, mapping, fixedCurrency='') {
  const numeric = ['fee','fx','tax','other','refund','interest','paidKrw','rate'].map(k=>mapping[k]).filter(i=>i>=0);
  if (new Set(numeric).size !== numeric.length) throw Error('매매 수수료·환전 수수료·세금에는 서로 다른 열을 선택해주세요.');
  if (!['fee','fx','other','refund'].some(k=>mapping[k]>=0)) throw Error('수수료·환전·기타 수수료·환급 중 하나의 열을 선택해주세요.');
  if (mapping.currency < 0 && !fixedCurrency) throw Error('통화 열 또는 파일의 통화를 선택해주세요.');
  return parsed.rows.map((r,i)=>{
    const get=k=>mapping[k]>=0 ? r[mapping[k]] : '';
    const scopeIndex=parsed.headers.indexOf('feeScope');
    const scope=scopeIndex>=0?r[scopeIndex].split('|'):null;
    if(scope?.some(k=>!['fee','fx','other','refund',''].includes(k)))throw Error('feeScope 형식을 확인하세요.');
    const expected=k=>scope?scope.includes(k):mapping[k]>=0;
    const c=currency(fixedCurrency || get('currency'));
    for (const key of ['fee','fx','tax','other','refund','interest']) {
      if ((c==='KRW' && /\$|USD/i.test(get(key))) || (c==='USD' && /원|₩|KRW/i.test(get(key)))) throw Error(`${i+2}행의 통화와 금액 단위가 다릅니다.`);
    }
    const fee=money(get('fee')), fx=money(get('fx'));
    if (fee===null && fx===null && get('tax').trim()==='' && r.every(s=>!s.trim())) return null;
    return {currency:c,fee,fx,tax:money(get('tax')),date:get('date'),symbol:get('symbol'),kind:get('kind'),id:get('id'),account:get('account'),line:i+2,feeExpected:expected('fee'),fxExpected:expected('fx'),
      other:money(get('other')),refund:money(get('refund')),interest:money(get('interest')),otherExpected:expected('other'),refundExpected:expected('refund'),
      paidKrw:money(get('paidKrw')),rate:money(get('rate')),rateDate:get('rateDate'),evidence:get('evidence'),settlement:get('settlement')};
  }).filter(Boolean);
}
function dateText(text) {
  const m=/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(text||'');
  return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : String(text||'').slice(0,10);
}
export function detail(text, index=0) {
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const pos=lines.indexOf('거래유형');
  if (pos<2) throw Error('거래유형·날짜·수수료가 보이는 토스 거래 상세 내용을 복사해주세요.');
  const get=k=>{const i=lines.indexOf(k);return i>=0?lines[i+1]:undefined;};
  const kind=get('거래유형'), symbol=lines[pos-2], net=lines[pos-1];
  if (kind.includes('환전')) {
    const match=/환전 수수료\s+([\d,]+)원/.exec(text);
    if (!match) throw Error('환전 수수료 항목이 빠져 있습니다.');
    return {currency:'KRW',fee:null,fx:money(match[1]),tax:null,date:dateText(get('일시')),symbol:'환전',kind, id:'',account:'',line:index+1,feeExpected:false,fxExpected:true};
  }
  if (!['주식구매','주식판매'].includes(kind)) throw Error('주식 매매 또는 환전 상세만 지원합니다.');
  const c=net.includes('$')?'USD':net.includes('원')?'KRW':null;
  if (!c) throw Error('상세 내역에서 통화를 찾지 못했습니다.');
  const fee=money(get('수수료')), tax=money(get('제세금'));
  const date=dateText(get(kind==='주식구매'?'구매일':'판매일'));
  if (!date) throw Error('거래 날짜가 없습니다.');
  const settlement=dateText(get(kind==='주식구매'?'출금일':'입금일'));
  // KR details combine same-day fills. US details are separate ledger transactions.
  const id=c==='KRW'?['KR_DETAIL',symbol,kind,date,settlement].join('|'):'';
  return {currency:c,fee,fx:null,tax,date,symbol,kind,id,account:'',settlement,line:index+1,feeExpected:true,fxExpected:false,net:money(net),gross:money(get(kind==='주식구매'?'총 구매금액':'총 판매금액'))};
}
export function fromText(text) {
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const positions=lines.map((s,i)=>s==='거래유형'?i:-1).filter(i=>i>=2);
  if (!positions.length) throw Error('복사한 내용에서 거래 상세 항목을 찾지 못했습니다.');
  return positions.map((p,i)=>detail(lines.slice(p-2,i+1<positions.length?positions[i+1]-2:lines.length).join('\n'),i));
}
export function fromJSON(payload) {
  if (payload && Array.isArray(payload.observations)) {
    const rows=payload.observations.map((o,i)=>{
      const r=detail(o.detail,i);
      r.account=o.account||payload.account||'';
      if (o.currency!==r.currency) throw Error('수집 자료의 통화가 일치하지 않습니다.');
      if (r.currency==='USD') {
        if (!Number.isInteger(o.index) || !o.row) throw Error('해외 거래 행 번호가 없습니다.');
        if (money(o.row.trim().split(/\r?\n/).at(-2))!==r.net) throw Error('해외 거래 목록과 상세 금액이 다릅니다.');
        r.id=`US_DETAIL|${r.date}|${o.index}`;
      }
      return r;
    });
    for (const [i,o] of (payload.fxObservations||[]).entries()) {
      const r=detail(o.detail,i); r.account=o.account||payload.account||'';r.id=Number.isInteger(o.index)?`FX_DETAIL|${r.date}|${o.index}`:'';rows.push(r);
    }
    return rows;
  }
  const data=Array.isArray(payload)?payload:payload?.rows;
  if (!Array.isArray(data)||!data.length) throw Error('거래 배열 또는 분석 도구에서 저장한 JSON이 필요합니다.');
  const rows = data.map((o,i)=>({currency:currency(o.currency),fee:money(o.commission),fx:money(o.fxCommission),tax:money(o.tax),date:o.filledAt||o.date||'',symbol:o.symbol||'',kind:o.side||o.kind||'',id:o.orderId||o.id||'',account:o.account||'',line:i+1,feeExpected:Object.hasOwn(o,'commission'),fxExpected:Object.hasOwn(o,'fxCommission'),
    other:money(o.otherFee),refund:money(o.refund),interest:money(o.interest),otherExpected:Object.hasOwn(o,'otherFee'),refundExpected:Object.hasOwn(o,'refund'),paidKrw:money(o.paidKrw),rate:money(o.referenceRate??o.rate),rateDate:o.rateDate||'',evidence:o.evidence||'',settlement:o.settlementDate||''}));
  for (const [i,o] of (payload?.fx?.rows||[]).entries()) rows.push({currency:'KRW',fee:null,fx:money(o.commission),tax:null,date:o.date||'',symbol:'환전',kind:o.kind||'',id:`FX_REPORT|${o.date}|${o.index??i}`,account:'',line:i+1,feeExpected:false,fxExpected:true});
  return rows;
}
export function summarize(records) {
  if (!records.length) throw Error('계산할 거래가 없습니다.');
  const totals={}, seen=new Map(), rows=[]; let duplicates=0,missing=0,unknownTax=0,unidentified=0;
  for (const original of records) {
    const r={other:null,refund:null,interest:null,paidKrw:null,rate:null,rateDate:'',evidence:'',settlement:'',...original};
    if(r.refund!==null && r.refund<0n) throw Error('수수료환급은 양수로 입력하세요. 음수 수수료와 같은 환급을 중복 입력하지 마세요.');
    if(r.rate!==null && r.rate<=0n) throw Error('환율은 0보다 커야 합니다.');
    currency(r.currency);
    if (r.id) {
      const key=JSON.stringify([r.account,r.currency,r.id]);
      const signature=JSON.stringify([r.fee,r.fx,r.tax,r.date,r.symbol,r.kind,r.net,r.gross,r.other,r.refund,r.interest,r.paidKrw,r.rate,r.rateDate,r.evidence,r.settlement,r.feeExpected,r.fxExpected,r.otherExpected,r.refundExpected],(_,v)=>typeof v==='bigint'?v.toString():v);
      if (seen.has(key)) {if(seen.get(key)!==signature) throw Error('같은 거래번호의 금액 또는 상세 내용이 다릅니다. 중복·정정 내역을 확인해주세요.');duplicates++;continue;}
      seen.set(key,signature);
    } else unidentified++;
    const t=totals[r.currency] ||= {fee:0n,fx:0n,tax:0n,other:0n,refund:0n,interest:0n,known:0,count:0};
    t.count++;
    if(r.fee!==null){t.fee+=r.fee;t.known++;} else if(r.feeExpected)missing++;
    if(r.fx!==null){t.fx+=r.fx;t.known++;} else if(r.fxExpected)missing++;
    for(const key of ['other','refund']){if(r[key]!==null){t[key]+=r[key];t.known++;}else if(r[key+'Expected'])missing++;}
    if(r.interest!==null)t.interest+=r.interest;
    if(r.tax!==null)t.tax+=r.tax;else unknownTax++;
    rows.push(r);
  }
  if (!Object.values(totals).some(t=>t.known)) throw Error('확인 가능한 수수료 금액이 없습니다. 수수료 열을 다시 선택해주세요.');
  return {totals,rows,duplicates,missing,unknownTax,unidentified};
}
export function exportCSV(report) {
  const escape=(s,numeric=false)=>{s=String(s??'');if(!numeric && /^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const fields=[['date','date'],['currency','currency'],['symbol','symbol'],['commission','fee'],['fxCommission','fx'],['tax','tax'],['otherFee','other'],['refund','refund'],['interest','interest'],['paidKrw','paidKrw'],['rate','rate'],['rateDate','rateDate'],['evidence','evidence'],['orderId','id'],['account','account'],['side','kind'],['settlementDate','settlement']];
  const nums=new Set(['fee','fx','tax','other','refund','interest','paidKrw','rate']);
  const lines=[[...fields.map(([name])=>name),'feeScope']];
  for(const r of report.rows)lines.push([...fields.map(([,key])=>nums.has(key)?r[key]==null?'':format(r[key]).replace(/,/g,''):r[key]||''),['fee','fx','other','refund'].filter(k=>r[k+'Expected']).join('|')]);
  return '\uFEFF'+lines.map((r,ri)=>r.map((v,i)=>escape(v,ri>0&&i<fields.length&&nums.has(fields[i][1]))).join(',')).join('\r\n');
}
