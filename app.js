// app.js — Auto mode ON by default, live update on input
(function () {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, PASSWORD } = window.APP_CONFIG;
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const qs = new URLSearchParams(location.search);

  // 自动决定周期；可用 ?period=MT / ?period=FS 临时覆盖
  function todayPeriodKey() {
    const ov = qs.get("period");
    if (ov === "MT" || ov === "FS") return ov;
    const d = new Date().getDay();            // 0 Sun, 3 Wed
    if (d === 0) return "FS";                 // 周日 → Fri–Sun
    if (d === 3) return "MT";                 // 周三 → Mon–Thu
    if (d >= 1 && d <= 4) return "MT";
    return "FS";
  }
  const escapeHtml = (s) => (s || "").replace(/[&<>]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));

  // 进入即自动模式
  let STATE = { authed:false, name:"", period:todayPeriodKey(), items:[], stocks:{}, submitting:false };

  function render(){
    const root = $("app"); root.innerHTML = "";
    if (!STATE.authed) { root.appendChild(ViewLogin()); return; }
    if (!STATE.items.length) { root.appendChild(ViewLoading()); fetchItems(); return; }
    root.appendChild(ViewMain());
  }

  function ViewLogin(){
    const wrap = el("div","wrap");
    const card = el("div","card section");
    card.appendChild(el("h1",null,"Par Order"));
    card.appendChild(el("p","muted","Enter password to proceed."));
    const row = el("div","row");
    const pwd = el("input"); pwd.type="password"; pwd.placeholder="Password";
    const name= el("input"); name.type="text"; name.placeholder="Your name/initials (optional)";
    const btn = el("button","primary","Continue");
    btn.onclick=()=>{ if(pwd.value===PASSWORD){ STATE.authed=true; STATE.name=name.value.trim(); render(); } else alert("Wrong password."); };
    [pwd,name].forEach(i=>i.addEventListener("keydown",e=>{ if(e.key==="Enter") btn.click(); }));
    setTimeout(()=>pwd.focus(),0);
    row.append(pwd,name,btn); card.appendChild(row); card.appendChild(el("div","hr"));
    const label = STATE.period==='MT'?'Mon–Thu':'Fri–Sun';
    const tip = qs.get("period") ? ` (overridden by ?period=${qs.get("period")})` : "";
    card.appendChild(el("p","muted",`Auto period: <b>${label}</b>${tip}`));
    wrap.appendChild(card); return wrap;
  }

  function ViewLoading(){ const w=el("div","wrap"); const c=el("div","card section"); c.appendChild(el("p",null,"Loading items from Supabase…")); w.appendChild(c); return w; }

  function ViewMain(){
    const period = STATE.period; // 固定为自动判定结果

    // 生成行数据
    const rows = STATE.items.map(it=>{
      const par   = period==='MT' ? Number(it.par_mt||0) : Number(it.par_fs||0);
      const stock = Number(STATE.stocks[it.id]||0);
      const need  = Math.max(par - stock, 0);
      return { ...it, par, stock, need };
    });

    // 订单列表 & 文本摘要
    const orderList = rows.filter(r=>r.need>0).map(r=>({ item:r.item, unit:r.unit||"", qty:r.need, notes:r.notes||"" }));
    const summaryText = `Order for ${period==='MT'?'Mon–Thu':'Fri–Sun'} (auto)\n` +
      (orderList.map(t=>`- ${t.item} — ${t.qty} ${t.unit}`).join("\n") || "(No items)");

    const wrap = el("div","wrap");

    // 顶部（不再显示 Mon–Thu / Fri–Sun / Auto）
    const head = el("div","card section");
    head.appendChild(el("div",null,`<header><h1>Par Order – ${period==='MT'?'Mon–Thu':'Fri–Sun'}</h1></header>
      <p class="muted small">Auto-selected by weekday（可用 ?period=MT/FS 临时覆盖）.</p>`));
    const controls = el("div","row");
    const btnCopy = el("button","ghost","Copy Summary"); btnCopy.onclick=()=>{ navigator.clipboard.writeText(summaryText); alert("Copied."); };
    const btnCSV  = el("button","ghost","Export CSV");   btnCSV.onclick = ()=> exportCSV(orderList, period);
    controls.append(btnCopy, btnCSV); head.appendChild(controls); wrap.appendChild(head);

    // 表格
    const tableCard = el("div","card section");
    const table = el("table");
    table.innerHTML = `<thead><tr>
        <th>Item</th><th>Unit</th><th>Par</th><th>Current Stock</th><th>This Order</th><th>Notes</th>
      </tr></thead>`;
    const tbody = el("tbody");

    rows.forEach(r=>{
      const tr = el("tr");

      // “立即更新”版本：输入时只更新当前行的 pill，不整页重渲染
      const stockInput = el("input"); stockInput.type="number"; stockInput.step="0.01"; stockInput.min="0";
      stockInput.value = STATE.stocks[r.id] ?? "";
      const pill = el("span","pill " + (r.need>0?"ok":"zero"), r.need>0 ? String(r.need) : "0");

      stockInput.oninput = ()=>{
        const val = Number(stockInput.value || 0);
        STATE.stocks[r.id] = val;
        const need = Math.max(r.par - val, 0);
        pill.textContent = String(need);
        pill.className = "pill " + (need>0 ? "ok" : "zero");
      };

      tr.appendChild(el("td",null,escapeHtml(r.item)));
      tr.appendChild(el("td",null,escapeHtml(r.unit||"")));
      tr.appendChild(el("td",null,String(r.par)));
      const tdS = el("td"); tdS.appendChild(stockInput); tr.appendChild(tdS);
      const tdNeed = el("td"); tdNeed.appendChild(pill); tr.appendChild(tdNeed);
      tr.appendChild(el("td",null,escapeHtml(r.notes||"")));
      tbody.appendChild(tr);
    });

    table.appendChild(tbody); tableCard.appendChild(table); wrap.appendChild(tableCard);

    // 底部：保存日志（可选）
    const foot = el("div","card section");
    const row = el("div","row");
    const btnSubmit = el("button","primary", STATE.submitting ? "Submitting…" : "Save Log to Supabase");
    btnSubmit.disabled = STATE.submitting;
    btnSubmit.onclick = async ()=>{
      // 重新根据当前输入生成 orderList（因为 pill是即时更新的）
      const freshList = STATE.items.map(it=>{
        const par   = period==='MT' ? Number(it.par_mt||0) : Number(it.par_fs||0);
        const stock = Number(STATE.stocks[it.id]||0);
        const need  = Math.max(par - stock, 0);
        return { item:it.item, unit:it.unit||"", qty:need, notes:it.notes||"" };
      }).filter(x=>x.qty>0);

      if (freshList.length===0 && !confirm("No items to order. Save an empty log?")) return;

      STATE.submitting = true; render();
      try{
        const payload = { period, operator: STATE.name || "anon", items: freshList, stocks: STATE.stocks, generated_at: new Date().toISOString() };
        const { error } = await db.from("order_logs").insert({ period, made_by: STATE.name || "anon", payload });
        if (error) throw error;
        alert("Saved to Supabase (order_logs).");
      }catch(e){ console.error(e); alert("Failed to save log: " + (e.message || e)); }
      finally{ STATE.submitting=false; render(); }
    };
    row.append(btnSubmit);
    foot.appendChild(row);
    foot.appendChild(el("div","hr"));
    foot.appendChild(el("div","list small", `<div><span class="k">Preview:</span></div>
      <pre class="v" style="white-space:pre-wrap;margin:6px 0 0">${escapeHtml(summaryText)}</pre>`));
    wrap.appendChild(foot);

    return wrap;
  }

  function exportCSV(list, period){
    const lines = [["Item","Unit","Qty","Notes"].join(",")];
    list.forEach(it=>lines.push([it.item, it.unit||"", String(it.qty), (it.notes||"").replaceAll(",",";")].join(",")));
    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href=url; a.download=`order-${period==='MT'?'Mon-Thu':'Fri-Sun'}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchItems(){
    try{
      const { data, error } = await db.from("items").select("*").order("item");
      if (error) throw error;
      STATE.items = data || [];
      render();
    }catch(e){ console.error(e); alert("Failed to load items: " + (e.message || e)); }
  }

  render();
})();
