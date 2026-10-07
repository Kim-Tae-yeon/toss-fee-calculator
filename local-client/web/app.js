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
    card.append(element("div", `${amount(data.commission)} ${currency === "KRW" ? "원" : "USD"}`, "amount"));
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
    $("status").className = state.status === "error" ? "error" : "";
    $("submit").disabled = state.status === "running";
    if (state.status === "done") {
      const response = await fetch("/api/report");
      if (!response.ok) throw Error("완료된 보고서를 읽지 못했어요.");
      show(await response.json());
    }
    polling = state.status === "running";
    if (polling) setTimeout(refresh, 1000);
  } catch (error) { polling = false; $("status").textContent = error.message + " 실행 창을 확인하고 페이지를 새로고침하세요."; $("status").className = "error"; $("submit").disabled = false; }
}
$("form").addEventListener("submit", async event => {
  event.preventDefault(); if (polling) return;
  $("submit").disabled = true; $("results").hidden = true;
  try {
    const body = JSON.stringify({clientId:$("clientId").value, clientSecret:$("clientSecret").value,referenceRates:$("reference-rates").checked});
    $("clientId").value = ""; $("clientSecret").value = "";
    const response = await fetch("/api/analyze", {method:"POST", headers:{"Content-Type":"application/json", "X-CSRF-Token":csrf}, body});
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    await refresh();
  } catch (error) { $("status").textContent = error.message; $("status").className = "error"; $("submit").disabled = false; }
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
