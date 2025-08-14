
function(){
  const { SUPABASE_URL, SUPABASE_ANON_KEY, PASSWORD } = window.APP_CONFIG;
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (id)=>document.getElementById(id);
  const el = (tag, cls, html)=>{ const n=document.createElement(tag); if(cls) n.className=cls; if(html!=null) n.innerHTML=html; return n; };

  function todayPeriodKey(){
    const d = new Date().getDay(); // 0 Sun, 3 Wed
    if (d === 0) return 'FS';   // Sunday -> next Fri–Sun
    if (d === 3) return 'MT';   // Wednesday -> next Mon–Thu
    if (d >= 1 && d <= 4) return 'MT';
    return 'FS';
  }
  function ceilToMultiple(x, m){ m = Number(m||1); if(m<=0) m=1; return Math.ceil((Number(x)+1e-9)/m)*m; }

  let STATE = {
    authed: false,
    name: "",
    period: todayPeriodKey(),
    items: [],
    stocks: {},
    summary: null,
    submitting: false,
  };

  function render(){
    const root = $("app");
    root.innerHTML = "";
    if(!STATE.authed){
      root.appendChild(ViewLogin());
      return;
    }
    if(!STATE.items.length){
      root.appendChild(ViewLoading());
      fetchItems();
      return;
    }
    root.appendChild(ViewMain());
  }

  function ViewLogin(){
    const wrap = el("div","wrap");
    const card = el("div","card section");
    card.appendChild(el("h1",null,"Par Order Login"));
    card.appendChild(el("p","muted","Enter password to proceed."));

    const row = el("div","row");
    const pwd = el("input"); pwd.type="password"; pwd.placeholder="Password";
    const name = el("input"); name.type="text"; name.placeholder="Your name/initials (optional)";
    const btn = el("button","primary","Continue");
    btn.onclick = ()=>{
      if(pwd.value === PASSWORD){
        STATE.authed = true;
        STATE.name = name.value.trim();
        render();
      }else{
        alert("Wrong password.");
      }
    };
    row.append(pwd,name,btn);
    card.appendChild(row);
    card.appendChild(el("div","hr"));
    card.appendChild(el("p","muted",`Today suggests ordering for: <b>${STATE.period==='MT'?'Mon–Thu':'Fri–Sun'}</b>`));
    wrap.appendChild(card);
    return wrap;
  }

  function ViewLoading(){
    const wrap = el("div","wrap");
    const card = el("div","card section");
    card.appendChild(el("p",null,"Loading items from Supabase…"));
    wrap.appendChild(card);
    return wrap;
  }

  function ViewMain(){
    // Compute current order suggestions
    const period = STATE.period;
    const rows = STATE.items.map(it=>{
      const par = period==='MT' ? Number(it.par_mt||0) : Number(it.par_fs||0);
      const stock = Number(STATE.stocks[it.id]||0);
      const multiple = Number(it.min_multiple||1);
      const needRaw = Math.max(par - stock, 0);
      const need = ceilToMultiple(needRaw, multiple);
      return { ...it, par, stock, need, needRaw };
    });

    const orderList = rows.filter(r=>r.need>0).map(r=>({ item:r.item, unit:r.unit||"", qty:r.need, notes:r.notes||"" }));
    const totalsLines = orderList.map(t=>`- ${t.item} — ${t.qty} ${t.unit}`);
    const summaryText = `Order for ${period==='MT'?'Mon–Thu':'Fri–Sun'} (auto)\n` + (totalsLines.join("\n")||"(No items)");

    const wrap = el("div","wrap");

    const head = el("div","card section");
    const title = el("div",null,`
      <header>
        <h1>Par Order – ${period==='MT'?'Mon–Thu':'Fri–Sun'}</h1>
      </header>
      <p class="muted small">Rule: Wednesday night → next Mon–Thu; Sunday night → next Fri–Sun.</p>
    `);
    head.appendChild(title);

    const controls = el("div","row");
    const btnMT = el("button","ghost","Mon–Thu"); btnMT.onclick=()=>{ STATE.period='MT'; render(); };
    const btnFS = el("button","ghost","Fri–Sun"); btnFS.onclick=()=>{ STATE.period='FS'; render(); };
    const btnAuto = el("button","ghost","Auto"); btnAuto.onclick=()=>{ STATE.period=todayPeriodKey(); render(); };
    const btnCopy = el("button","ghost","Copy Summary"); btnCopy.onclick=()=>{ navigator.clipboard.writeText(summaryText); alert("Copied."); };
    const btnCSV = el("button","ghost","Export CSV"); btnCSV.onclick=()=>{ exportCSV(orderList, period); };
    controls.append(btnMT,btnFS,btnAuto,btnCopy,btnCSV);
    head.appendChild(controls);
    wrap.appendChild(head);

    // Table
    const tableCard = el("div","card section");
    const table = el("table"); 
    const thead = el("thead",null,`
      <tr>
        <th>Item</th><th>Unit</th><th>Par</th><th>Current Stock</th><th>This Order</th><th>Notes</th>
      </tr>`);
    table.appendChild(thead);
    const tbody = el("tbody");
    rows.forEach(r=>{
      const tr = el("tr");
      const stockInput = el("input"); stockInput.type="number"; stockInput.value = STATE.stocks[r.id]||"";
      stockInput.oninput = ()=>{ STATE.stocks[r.id] = Number(stockInput.value||0); };
      tr.appendChild(el("td",null,escapeHtml(r.item)));
      tr.appendChild(el("td",null,escapeHtml(r.unit||"")));
      tr.appendChild(el("td",null,String(r.par)));
      const tdStock = el("td"); tdStock.appendChild(stockInput); tr.appendChild(tdStock);
      const tdOrder = el("td"); tdOrder.appendChild(el("span", "pill " + (r.need>0?"ok":"zero"), r.need>0?String(r.need):"0")); tr.appendChild(tdOrder);
      tr.appendChild(el("td",null,escapeHtml(r.notes||"")));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableCard.appendChild(table);
    wrap.appendChild(tableCard);

    // Footer actions (submit log)
    const foot = el("div","card section");
    const btnSubmit = el("button","primary", STATE.submitting ? "Submitting…" : "Save Log to Supabase");
    btnSubmit.disabled = STATE.submitting;
    btnSubmit.onclick = async ()=>{
      STATE.submitting = true; render();
      try {
        const payload = {
          period,
          operator: STATE.name || "anon",
          items: orderList,
          stocks: STATE.stocks,
          generated_at: new Date().toISOString(),
        };
        const { error } = await db.from("order_logs").insert({ period, made_by: STATE.name||"anon", payload });
        if(error) throw error;
        alert("Saved to Supabase (order_logs).");
      } catch (e){
        console.error(e);
        alert("Failed to save log: " + (e.message||e));
      } finally {
        STATE.submitting = false; render();
      }
    };
    foot.appendChild(btnSubmit);
    foot.appendChild(el("div","hr"));
    foot.appendChild(el("div","list small", `<div><span class="k">Preview:</span></div><pre class="v" style="white-space:pre-wrap;margin:6px 0 0">${escapeHtml(summaryText)}</pre>`));
    wrap.appendChild(foot);

    return wrap;
  }

  function exportCSV(orderList, period){
    const header = ["Item","Unit","Qty","Notes"];
    const lines = [header.join(",")];
    orderList.forEach(it=>{
      const row = [it.item, it.unit||"", String(it.qty), (it.notes||"").replaceAll(",",";")];
      lines.push(row.join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `order-${period==='MT'?'Mon-Thu':'Fri-Sun'}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(s){ return (s||"").replace(/[&<>]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c])); }

  async function fetchItems(){
    try{
      const { data, error } = await db.from("items").select("*").eq("active", true).order("item");
      if(error) throw error;
      STATE.items = data || [];
      render();
    }catch(e){
      console.error(e);
      alert("Failed to load items from Supabase: " + (e.message||e));
    }
  }

  // init
  render();
})();
