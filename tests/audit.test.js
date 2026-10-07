import test from 'node:test';
import assert from 'node:assert/strict';
import {money,format,parseCSV,guessColumns,fromCSV,fromJSON,summarize,exportCSV} from '../engine.js';
import {netFees,convert,formatProduct,reconcile,percentage,evidenceCoverage} from '../audit.js';
const csv=s=>{const p=parseCSV(s);return fromCSV(p,guessColumns(p.headers));};
const base={currency:'USD',commission:'0.1',date:'2025-01-02',orderId:'x',account:'A'};
const report=rows=>summarize(fromJSON(rows));
test('each historical rate uses its own row, exact sum then rounding',()=>{
 const r=convert(report([{...base,referenceRate:'1300',rateDate:base.date,evidence:'historical source'}, {...base,orderId:'y',commission:'0.2',referenceRate:'1500',rateDate:base.date,evidence:'historical source'}]));
 assert.equal(formatProduct(r.combined),'430');assert.equal(r.complete,true);assert.equal(r.actualComplete,false);
});
test('no current-rate fallback and no exact claim without rate evidence',()=>{
 for(const row of [{...base},{...base,referenceRate:'1400',rateDate:base.date},{...base,referenceRate:'1400',rateDate:'2026-10-08',evidence:'current'}]){
  const r=convert(report([row]));assert.equal(r.complete,false);assert.equal(format(r.unconvertedUSD),'0.1');
 }
});
test('documented KRW debit takes precedence over indicative rate',()=>{
 const r=convert(report([{...base,paidKrw:'129',evidence:'statement row 2',referenceRate:'1400',rateDate:base.date}]));
 assert.equal(formatProduct(r.posted),'129');assert.equal(r.actualComplete,true);assert.equal(r.referenceRows,0);
 assert.equal(convert(report([{...base,paidKrw:'129'}])).complete,false);
});
test('refunds, other fees, taxes and interest have separate arithmetic',()=>{
 const r=report([{currency:'KRW',commission:'20',fxCommission:'10',otherFee:'5',refund:'3',tax:'100',interest:'200'}]);
 assert.equal(netFees(r.rows[0]),money('32'));assert.equal(formatProduct(convert(r).posted),'32');
 assert.equal(r.totals.KRW.tax,money('100'));assert.equal(r.totals.KRW.interest,money('200'));
});
test('unknowns and zero cannot be conflated or silently converted',()=>{
 const r=convert(report([{...base,commission:null},{...base,orderId:'y',commission:'0'}]));
 assert.equal(r.issues.length,1);assert.equal(r.complete,false);
 assert.equal(convert(report([{...base,commission:'0'}])).actualComplete,true);
});
test('negative refund conversion keeps sign and rejects inverted documented amount',()=>{
 assert.equal(formatProduct(convert(report([{...base,commission:'-1',referenceRate:'1300',rateDate:base.date,evidence:'source'}])).reference),'-1,300');
 assert.equal(convert(report([{...base,paidKrw:'-100',evidence:'bad'}])).complete,false);
 assert.throws(()=>report([{...base,refund:'-1'}]));assert.throws(()=>report([{...base,referenceRate:'0'}]));
});
test('multiplication retains all 16 decimal places; only final sum rounds',()=>{
 const r=convert(report([{...base,commission:'0.12345678',referenceRate:'1234.56789123',rateDate:base.date,evidence:'source'}]));
 assert.equal(formatProduct(r.reference),'152.4157765426460394');
 const s=convert(report([{...base,commission:'0.001',referenceRate:'400',rateDate:base.date,evidence:'source'},{...base,orderId:'y',commission:'0.001',referenceRate:'400',rateDate:base.date,evidence:'source'}]));
 assert.equal(formatProduct(s.reference,true),'1');
});
test('cross-source reconciliation never sums or matches by amount alone',()=>{
 const a=fromJSON([base]),b=fromJSON([{...base,orderId:'y'}]);const r=reconcile(a,b);
 assert.equal(r.matched,0);assert.equal(r.primaryOnly,1);assert.equal(r.comparisonOnly,1);assert.equal(r.mismatchDays,0);
 assert.equal(format(a[0].fee),'0.1');
});
test('same transaction conflict, unmatched accounts and daily missing values are flagged',()=>{
 assert.equal(reconcile(fromJSON([base]),fromJSON([{...base,commission:'0.2'}])).conflicts,1);
 assert.equal(reconcile(fromJSON([base]),fromJSON([{...base,account:'B'}])).matched,0);
 assert.equal(reconcile(fromJSON([base]),fromJSON([{...base,commission:null},{...base,orderId:'zero',commission:'0'}])).comparisonMissing,1);
});
test('export retains identity and conversion evidence for re-import',()=>{
 const a=report([{...base,referenceRate:'1300',rateDate:base.date,evidence:'source'}]);
 const b=summarize(csv(exportCSV(a)));
 assert.equal(convert(b).complete,true);assert.equal(b.missing,0);assert.equal(b.rows[0].id,'x');assert.equal(b.rows[0].account,'A');assert.equal(b.rows[0].rate,money('1300'));assert.equal(b.rows[0].evidence,'source');
});

test('coverage counts complete rows, not fields or monetary accuracy',()=>{
 const r=report([{...base,commission:null},{...base,orderId:'y',commission:'0'},{...base,orderId:'z'}]);
 const c=evidenceCoverage(r);
 assert.equal(c.feeRows,2);assert.equal(c.convertedRows,1);
 assert.equal(c.feePercent,'66.66%');assert.equal(c.conversionPercent,'33.33%');assert.equal(c.errorBound,null);
 assert.equal(percentage(999999,1000000),'99.99%');assert.equal(percentage(1,1000000),'<0.01%');assert.equal(percentage(0,0),null);
});

test('comparison difference percentage uses comparison denominator and supports refunds',()=>{
 const a=fromJSON([{...base,commission:'90'}]),b=fromJSON([{...base,commission:'100'}]);
 assert.equal(reconcile(a,b).amounts[0].percent,'10.00%');
 assert.equal(reconcile(fromJSON([{...base,commission:'-90'}]),fromJSON([{...base,commission:'-100'}])).amounts[0].percent,'10.00%');
 assert.equal(reconcile(a,fromJSON([{...base,commission:'0'}])).amounts[0].percent,null);
 assert.equal(reconcile(a,fromJSON([{...base,commission:null},{...base,orderId:'zero',commission:'0'}])).amounts[0].percent,null);
});

test('matching aggregate totals never erase conflicting transactions',()=>{
 const a=fromJSON([{...base,commission:'1'},{...base,orderId:'y',commission:'3'}]);
 const b=fromJSON([{...base,commission:'2'},{...base,orderId:'y',commission:'2'}]);
 const r=reconcile(a,b);assert.equal(r.amounts[0].percent,'0.00%');assert.equal(r.conflicts,2);
});

test('specific historical lookup issue survives JSON analysis',()=>{
 const r=convert(report([{...base,referenceIssue:'해당 시각의 환율 API 요청 실패'}]));
 assert.equal(r.issues[0].reason,'해당 시각의 환율 API 요청 실패');
});
