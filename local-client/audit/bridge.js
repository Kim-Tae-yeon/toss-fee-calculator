import {loadReport} from "./app.js?v=1.2.0";
try{const r=await fetch("/api/report");if(r.ok){loadReport(await r.json());const section=document.getElementById("audit-section");section.tabIndex=-1;section.focus();}}
catch{document.getElementById("status").textContent="로컬 보고서를 불러오지 못했습니다. 파일을 직접 선택하세요.";}
