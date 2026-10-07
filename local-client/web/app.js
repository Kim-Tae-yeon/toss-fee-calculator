"use strict";
const $ = id => document.getElementById(id);
let csrf = "", polling = false;
function amount(value) {
  if (value === null || value === undefined) return "미확인";
  const [whole, fraction] = String(value).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction && /[1-9]/.test(fraction) ? "." + fraction.replace(/0+$/, "") : "");
}
function element(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function tableRow(target, values) {
  const tr = element("tr");
  values.forEach(value => tr.append(element("td", value)));
  target.append(tr);
}
function show(report) {
  $("source-limitation").textContent = report.source + " · " + report.limitation;
  $("results").hidden = false;
  $("connect").open = false;
  const count=report.filledCount,unknown=Object.values(report.totals).reduce((sum,t)=>sum+t.missingCommission,0);
  const confirmed=count-unknown;
  $("quality").replaceChildren(element('p',`수수료 금액 확인률 · ${count?((Math.floor(confirmed*10000/count))/100).toFixed(2)+'%':'산정 불가'}`,'amount'),element('p',`조회된 ${count}건 중 금액이 있는 ${confirmed}건 기준입니다. 전체 기간의 확보율이나 정확도를 의미하지 않아요.`));
  const retrieval=report.retrieval;
  $("quality").append(element('p',retrieval?`${report.accountCount}개 반환 계좌 · ${retrieval.groups.reduce((n,g)=>n+g.pages,0)}페이지 확인 · 날짜 필터 없이 CLOSED·OPEN 조회 완료`:'이 저장 자료에는 페이지 조회 완료 기록이 없어요. 새로 조회하면 조회 범위 기록도 남겨요.','hint'));
  $("quality").append(element('p','전체 비용 오차 상한: 산정 불가. API 밖에서 누락된 금액을 알 수 없어요. 거래내역서와 대조하면 선택한 두 자료의 차이율을 확인할 수 있어요.','notice'));
  const conversion=report.referenceConversion;
  $("reference-conversion").hidden=!conversion;
  if(conversion)$("reference-conversion").textContent=(conversion.complete?`매매 수수료 참고 원화 환산: ${amount(conversion.roundedKrw)}원`:`과거 환율 누락 ${conversion.missingCount}건 · 전체 환산 미확정`)+` · ${conversion.basis} 환전·기타 수수료는 내역서와 대조해 추가해야 합니다.`;
  $("cards").replaceChildren(); $("months").replaceChildren(); $("rows").replaceChildren();
  $("period").textContent = `${report.firstFill || "체결 없음"} ~ ${report.lastFill || "—"} · 계좌 ${report.accountCount}개 · ${report.observationCount ? '합산 거래' : '체결 주문'} ${report.filledCount.toLocaleString()}건 · 중복 제외 ${report.duplicatesRemoved}건`;
  let missing = 0;
  for (const [currency, data] of Object.entries(report.totals)) {
    missing += data.missingCommission + (report.observationCount ? 0 : data.missingTax);
    const card = element("article", undefined, "card");
    card.append(element("h3", currency === "KRW" ? "원화 수수료" : "달러 수수료"));
    card.append(element("div", data.missingCommission===data.count?'미확인':`${amount(data.commission)} ${currency === "KRW" ? "원" : "USD"}`, "amount"));
    for (const [label, value] of [["결제일 있는 주문", data.settledCommission], ["결제일 미확인 주문", data.unsettledCommission], ["세금 별도", data.tax]]) {
      const detail = element("div", undefined, "detail");
      detail.append(element("span", label), element("b", `${amount(value)} ${currency}`)); card.append(detail);
    }
    card.append(element("p", `수수료 미확인 ${data.missingCommission}건 · 세금 ${report.observationCount ? '항목 미표시' : '미확인'} ${data.missingTax}건`, "hint"));
    $("cards").append(card);
  }
  if (report.fx && report.fx.count) {
    const card=element('article',undefined,'card');
    card.append(element('h3','환전 수수료'),element('div',amount(report.fx.commission)+' 원','amount'),element('p',`${report.fx.count}건 · 원화 거래 내역에서 한 번만 집계`,'hint'));
    $("cards").append(card);
    $("cards").append(element('p',`확인된 매매·환전 수수료 합계: ${amount(report.knownFees.KRW)}원 + ${amount(report.knownFees.USD || '0')} USD (세금·이자 별도)`,'notice'));
  }
  if (!report.filledCount) $("cards").append(element("p", "조회 범위에서 체결된 주문을 찾지 못했어요. 전체 수수료가 0원이라는 뜻은 아니에요."));
  $("missing").hidden = !missing;
  $("missing").textContent = `금액이 없는 항목 ${missing}개가 있어요. 표시된 금액은 확인 가능한 값의 부분 합계입니다. 미확인 항목은 0원으로 계산하지 않았어요.`;
  for (const row of report.months) tableRow($("months"), [row.month, row.currency, row.count, amount(row.commission), amount(row.tax)]);
  for (const row of report.rows.slice(0, 300)) tableRow($("rows"), [row.filledAt ? new Date(row.filledAt).toLocaleDateString("ko-KR", {timeZone:"Asia/Seoul"}) : "미확인", row.account, row.symbol, ({BUY:"매수",SELL:"매도"})[row.side] || row.side, row.currency, amount(row.commission), amount(row.tax)]);
}
async function refresh() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw Error("상태를 가져오지 못했어요.");
    const state = await response.json(); csrf = state.csrf;
    $("status").textContent = state.message;
    $("status").className = state.status === "error" ? "error" : state.status === "running" ? "progress" : "";
    $("submit").disabled = state.status === "running";
    $("submit").textContent = state.status === "running" ? "조회 중…" : "API 빠른 조회 시작 →";
    for(const id of ['clientId','clientSecret','reference-rates'])$(id).disabled=state.status==='running';
    if (state.status === "done") {
      const response = await fetch("/api/report");
      if (!response.ok) throw Error("완료된 보고서를 읽지 못했어요.");
      show(await response.json());
    }
    polling = state.status === "running";
    if (polling) setTimeout(refresh, 1000);
  } catch (error) { polling = false; for(const id of ["clientId","clientSecret","reference-rates"])$(id).disabled=false; $("submit").textContent="API 빠른 조회 시작 →"; $("status").textContent = error.message + " 실행 창을 확인하고 페이지를 새로고침하세요."; $("status").className = "error"; $("submit").disabled = false; }
}
$("form").addEventListener("submit", async event => {
  event.preventDefault(); if (polling) return;polling=true;
  $("submit").disabled = true; $("results").hidden = true;
  $("status").textContent='토스 API에 연결하고 있어요…';$("status").className='progress';
  try {
    const body = JSON.stringify({clientId:$("clientId").value, clientSecret:$("clientSecret").value,referenceRates:$("reference-rates").checked});
    $("clientId").value = ""; $("clientSecret").value = "";
    const response = await fetch("/api/analyze", {method:"POST", headers:{"Content-Type":"application/json", "X-CSRF-Token":csrf}, body});
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    await refresh();
  } catch (error) { polling=false;$("status").textContent = error.message; $("status").className = "error"; $("submit").disabled = false; }
});
refresh();
$("import-ui")?.addEventListener("click", async () => {
  try {
    const response = await fetch('/api/import-ui', {method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:$("observations").value});
    const result=await response.json();
    if(!response.ok) throw Error(result.error);
    $("observations").value=''; await refresh();
  } catch(error) { $("status").textContent=error.message; }
});
