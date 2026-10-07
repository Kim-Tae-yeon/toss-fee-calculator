import {loadReport} from "./app.js";
try{const r=await fetch("/api/report");if(r.ok)loadReport(await r.json());}
catch{document.getElementById("status").textContent="로컬 보고서를 불러오지 못했습니다. 파일을 직접 선택하세요.";}
