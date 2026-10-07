import {SCALE,format,summarize} from './engine.js?v=1.2.0';

export const netFees = r => (r.fee??0n)+(r.fx??0n)+(r.other??0n)-(r.refund??0n);
const fields=['fee','fx','other','refund'];
const missingFees=r=>fields.some(k=>r[k+'Expected'] && r[k]==null);
const hasFees=r=>fields.some(k=>r[k]!=null);
// Percentages describe the supplied sample, never an unknown lifetime error bound.
export function percentage(numerator,denominator){
  const n=BigInt(numerator),d=BigInt(denominator);
  if(d<=0n)return null;
  const value=(n<0n?-n:n)*10000n/d;
  if(n!==0n&&value===0n)return '<0.01%';
  return `${value/100n}.${String(value%100n).padStart(2,'0')}%`;
}
export function evidenceCoverage(report,conversion=convert(report)){
  const total=report.rows.length;
  const feeRows=report.rows.filter(r=>hasFees(r)&&!missingFees(r)).length;
  const convertedRows=conversion.rows.filter(r=>r.converted!==null&&!r.reason).length;
  const reasons=new Map();
  for(const issue of conversion.issues)reasons.set(issue.reason,(reasons.get(issue.reason)||0)+1);
  return {total,feeRows,convertedRows,feePercent:percentage(feeRows,total),conversionPercent:percentage(convertedRows,total),reasons:[...reasons].map(([reason,count])=>({reason,count})),errorBound:null};
}
const day=s=>{
  const text=String(s||'');
  const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if(!match)return '';
  const date=new Date(match[0]+'T00:00:00Z');
  return Number.isFinite(+date)&&date.toISOString().slice(0,10)===match[0]?match[0]:'';
};
export function formatProduct(n,rounded=false){
  const negative=n<0n, value=negative?-n:n, unit=SCALE*SCALE;
  if(rounded)return (negative?'-':'')+((value+unit/2n)/unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const frac=(value%unit).toString().padStart(16,'0').replace(/0+$/,'');
  return (negative?'-':'')+(value/unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+(frac?'.'+frac:'');
}

// Direct KRW postings and reference valuations are deliberately separate.
// An FX purchase's rate cannot establish which dollars funded a later commission.
export function convert(report){
  let posted=0n,reference=0n,referenceRows=0,unconvertedUSD=0n;
  const issues=[],rows=[];
  for(const r of report.rows){
    const fee=netFees(r); let value=null,method='',reason='';
    if(!hasFees(r)||missingFees(r)) reason='수수료 빈 값: 부분 금액만 확인됨';
    if(r.currency==='KRW') {value=fee*SCALE;method='원화 원금액';posted+=value;}
    else if(r.paidKrw!=null){
      if(!r.evidence?.trim())reason='원화 부과액의 내역서·행 근거 없음';
      else if((fee>0n&&r.paidKrw<0n)||(fee<0n&&r.paidKrw>0n)||(fee===0n&&r.paidKrw!==0n))reason='원화 부과액과 수수료의 부호 불일치';
      else if(!reason){value=r.paidKrw*SCALE;method='입력된 원화 부과액';posted+=value;}
    }else if(fee===0n&&!reason){value=0n;method='0 수수료';}
    else if(r.rate!=null){
      if(!day(r.rateDate)||!r.evidence?.trim())reason='환율 기준일시 또는 출처 없음';
      else if(![day(r.date),day(r.settlement)].filter(Boolean).includes(day(r.rateDate)))reason='거래일·결제일과 환율 기준일이 다름';
      else if(!reason){value=fee*r.rate;method='참고 환율 환산 (실제 원화 지출 아님)';reference+=value;referenceRows++;}
    }else reason ||= r.referenceIssue||'원화 부과액 또는 해당 거래의 환율 근거 없음';
    if(reason)issues.push({account:r.account,id:r.id,date:r.date,currency:r.currency,fee,reason});
    if(r.currency==='USD'&&value===null)unconvertedUSD+=fee;
    rows.push({...r,converted:value,method,reason});
  }
  return {posted,reference,referenceRows,combined:posted+reference,unconvertedUSD,issues,rows,
    complete:issues.length===0,actualComplete:issues.length===0&&referenceRows===0};
}

export function reconcile(primary,comparison){
  const a=summarize(primary),b=summarize(comparison);
  const key=r=>r.account&&r.id?JSON.stringify([r.account,r.currency,r.id]):null;
  const values=r=>JSON.stringify([...fields,'tax','interest'].map(k=>r[k]==null?null:r[k].toString()));
  const index=new Map(b.rows.filter(r=>key(r)).map(r=>[key(r),r]));
  let matched=0,conflicts=0,primaryOnly=0,comparisonOnly=0,unidentified=0;
  const details=[],seen=new Set();
  for(const r of a.rows){
    const k=key(r),other=k?index.get(k):null;
    if(!k){unidentified++;continue;}
    if(!other){primaryOnly++;details.push({account:r.account,id:r.id,status:'기준 자료에만 있음'});continue;}
    seen.add(k);
    if(values(r)===values(other)){matched++;}
    else {conflicts++;details.push({account:r.account,id:r.id,status:'동일 거래 식별자의 금액 불일치'});}
  }
  for(const r of b.rows){const k=key(r);if(!k)unidentified++;else if(!seen.has(k)){comparisonOnly++;details.push({account:r.account,id:r.id,status:'대조 자료에만 있음'});}}
  // Daily totals diagnose gaps even when one source groups executions or uses different IDs.
  // Equal daily totals are NOT proof of identical transactions or lifetime coverage.
  const groups=new Map();let undated=0;
  for(const [side,rows] of [['primary',a.rows],['comparison',b.rows]])for(const r of rows){
    const d=day(r.date);if(!d){undated++;continue;}
    const k=JSON.stringify([r.account,r.currency,d]);
    const g=groups.get(k)||{account:r.account,currency:r.currency,date:d,primary:0n,comparison:0n,primaryCount:0,comparisonCount:0,missing:0};
    g[side]+=netFees(r);g[side+'Count']++;if(missingFees(r))g.missing++;groups.set(k,g);
  }
  const daily=[...groups.values()].sort((x,y)=>(x.account+x.currency+x.date).localeCompare(y.account+y.currency+y.date));
  for(const g of daily)g.difference=g.primary-g.comparison;
  const amounts=[];
  for(const currency of new Set([...a.rows,...b.rows].map(r=>r.currency))){
    const ar=a.rows.filter(r=>r.currency===currency),br=b.rows.filter(r=>r.currency===currency);
    const primary=ar.reduce((s,r)=>s+netFees(r),0n),comparison=br.reduce((s,r)=>s+netFees(r),0n);
    const missing=[...ar,...br].some(r=>!hasFees(r)||missingFees(r));
    const denominator=comparison<0n?-comparison:comparison;
    amounts.push({currency,primary,comparison,difference:primary-comparison,missing,
      percent:!missing&&ar.length&&br.length?percentage(primary-comparison,denominator):null,
      reason:missing?'수수료 빈 값이 있어 차이율을 확정할 수 없음':!ar.length||!br.length?'한쪽 자료에 해당 통화가 없음':denominator===0n?'대조 합계가 0이어서 비율 계산 불가':''});
  }
  return {matched,conflicts,primaryOnly,comparisonOnly,unidentified,undated,details,daily,amounts,
    primaryMissing:a.missing,comparisonMissing:b.missing,
    mismatchDays:daily.filter(g=>g.difference!==0n||!g.primaryCount||!g.comparisonCount||g.missing).length};
}

export function auditCSV(conversion){
  const cell=(s,numeric=false)=>{s=String(s??'');if(!numeric&&/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['date','account','orderId','currency','netFees','rate','rateDate','evidence','convertedKrw','method','issue']];
  for(const r of conversion.rows)rows.push([r.date,r.account,r.id,r.currency,format(netFees(r)),r.rate==null?'':format(r.rate),r.rateDate,r.evidence,r.converted===null?'':formatProduct(r.converted),r.method,r.reason]);
  return '\uFEFF'+rows.map((r,i)=>r.map((v,j)=>cell(v,i>0&&[4,5,8].includes(j))).join(',')).join('\r\n');
}
