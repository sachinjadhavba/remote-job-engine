import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const api = async (path, method = "GET", body = null) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.ok ? res.json() : null;
};

const claude = async (prompt, max = 600) => {
  if (!ANTHROPIC_KEY) {
    console.error("VITE_ANTHROPIC_KEY not set — add it in Vercel Environment Variables");
    return "⚠️ AI tools require VITE_ANTHROPIC_KEY to be set in Vercel settings. See setup guide.";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: max,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Claude API error:", res.status, err);
    return `⚠️ AI error (${res.status}): ${err?.error?.message || "check console"}`;
  }
  const d = await res.json();
  return d.content?.[0]?.text || "";
};

const STATUS = {
  pending:   { l: "Pending",   c: "#64748b", bg: "#1e293b" },
  applied:   { l: "Applied",   c: "#60a5fa", bg: "#1e3a5f" },
  viewed:    { l: "Viewed",    c: "#a78bfa", bg: "#2d1b69" },
  responded: { l: "Responded", c: "#34d399", bg: "#064e3b" },
  interview: { l: "Interview", c: "#fbbf24", bg: "#451a03" },
  offer:     { l: "Offer 🎉",  c: "#f472b6", bg: "#500724" },
  closed:    { l: "Closed",    c: "#334155", bg: "#0f172a" },
};

const today = new Date().toISOString().split("T")[0];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [apps, setApps] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [appFilter, setAppFilter] = useState("all");
  const [search, setSearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [a, j, s] = await Promise.all([
      api("rje_applications?select=*&order=created_at.desc"),
      api("rje_raw_jobs?select=*&order=match_score.desc,created_at.desc&limit=100"),
      api("rje_job_stats?select=*"),
    ]);
    setApps(Array.isArray(a) ? a : []);
    setJobs(Array.isArray(j) ? j : []);
    setStats(Array.isArray(s) && s.length ? s[0] : {});
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const appStats = {
    total: apps.length,
    applied: apps.filter(a => a.status === "applied").length,
    responded: apps.filter(a => a.status === "responded").length,
    interview: apps.filter(a => a.status === "interview").length,
    offer: apps.filter(a => a.status === "offer").length,
    followup: apps.filter(a => a.follow_up_date <= today && a.status === "applied").length,
    week: apps.filter(a => new Date(a.created_at) >= new Date(Date.now() - 7*86400000)).length,
  };

  const filteredJobs = jobs.filter(j => {
    const fs = jobFilter === "all" ? true : jobFilter === "high" ? j.match_score >= 80 : jobFilter === "new" ? !j.is_applied : j.is_applied;
    const ss = !search || j.job_title?.toLowerCase().includes(search.toLowerCase()) || j.company?.toLowerCase().includes(search.toLowerCase());
    return fs && ss;
  });

  const filteredApps = apps.filter(a => {
    const fs = appFilter === "all" ? true : appFilter === "followup" ? (a.follow_up_date <= today && a.status === "applied") : a.status === appFilter;
    const ss = !search || a.job_title?.toLowerCase().includes(search.toLowerCase()) || a.company?.toLowerCase().includes(search.toLowerCase());
    return fs && ss;
  });

  const markApplied = async (job) => {
    await api(`rje_raw_jobs?id=eq.${job.id}`, "PATCH", { is_applied: true, applied_date: today });
    await api("rje_applications", "POST", {
      platform: job.source, job_title: job.job_title, company: job.company,
      job_url: job.job_url, budget: job.salary, match_score: job.match_score,
      match_reasons: job.match_reasons, proposal_text: job.proposal_draft,
      status: "applied", follow_up_date: new Date(Date.now() + 5*86400000).toISOString().split("T")[0]
    });
    loadAll();
  };

  const updateStatus = async (id, status) => {
    await api(`rje_applications?id=eq.${id}`, "PATCH", { status });
    loadAll();
  };

  const doAI = async (type, item) => {
    setAiLoading(true);
    setAiText("");
    const prompts = {
      proposal: `Write a 150-word tailored proposal for Sachin Jadhav (19yr credit risk consultant, Rs500Cr portfolios, CAIIB) for: ${item.job_title} at ${item.company}. Budget: ${item.salary || item.budget}. Lead with most relevant experience. End with a specific question.`,
      followup: `3-sentence professional follow-up for Sachin Jadhav (credit risk consultant) who applied for ${item.job_title} at ${item.company} ${Math.ceil((Date.now()-new Date(item.applied_date||item.created_at))/86400000)} days ago. Brief, adds value.`,
      cover: `200-word cover letter for Sachin Jadhav (19yr banking, credit risk, analytics, Rs500Cr portfolios) for ${item.job_title} at ${item.company}. Outcome-focused, ends with CTA.`,
    };
    const r = await claude(prompts[type]);
    setAiText(r);
    setAiLoading(false);
  };

  // ── STYLES ──
  const C = {
    app: { minHeight: "100vh", background: "#060d18", color: "#cbd5e1", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace", fontSize: "12px" },
    nav: { background: "#0a1628", borderBottom: "1px solid #1e3a5f", padding: "0 20px", display: "flex", alignItems: "center", gap: "4px", height: "52px", position: "sticky", top: 0, zIndex: 100 },
    logo: { color: "#38bdf8", fontWeight: "700", fontSize: "14px", marginRight: "20px", letterSpacing: "0.1em" },
    tab: (a) => ({ background: a?"#1e3a5f":"transparent", color: a?"#38bdf8":"#475569", border:"none", padding:"6px 12px", borderRadius:"5px", cursor:"pointer", fontSize:"11px", letterSpacing:"0.05em" }),
    main: { padding: "20px", maxWidth: "1440px", margin: "0 auto" },
    grid4: { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px", marginBottom:"20px" },
    grid3: { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginBottom:"20px" },
    grid2: { display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px", marginBottom:"20px" },
    card: (border="#1e3a5f") => ({ background:"#0a1628", border:`1px solid ${border}`, borderRadius:"8px", padding:"16px" }),
    stat: (c) => ({ background:"#0a1628", border:`1px solid ${c}33`, borderRadius:"8px", padding:"14px 18px" }),
    sv: (c) => ({ fontSize:"28px", fontWeight:"700", color:c, lineHeight:1, margin:"3px 0" }),
    sl: { color:"#334155", fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase" },
    badge: (s) => ({ background:STATUS[s]?.bg||"#1e293b", color:STATUS[s]?.c||"#64748b", padding:"2px 7px", borderRadius:"4px", fontSize:"10px", display:"inline-block", whiteSpace:"nowrap" }),
    scoreBadge: (n) => ({ background: n>=80?"#064e3b":n>=65?"#451a03":"#1e293b", color: n>=80?"#34d399":n>=65?"#fbbf24":"#64748b", padding:"2px 7px", borderRadius:"4px", fontSize:"10px" }),
    btn: (c="#60a5fa") => ({ background:`${c}15`, color:c, border:`1px solid ${c}33`, padding:"5px 12px", borderRadius:"5px", cursor:"pointer", fontSize:"11px" }),
    btnS: (c="#38bdf8") => ({ background:c, color:"#000", border:"none", padding:"7px 16px", borderRadius:"5px", cursor:"pointer", fontSize:"11px", fontWeight:"600" }),
    inp: { background:"#060d18", border:"1px solid #1e3a5f", color:"#cbd5e1", padding:"7px 10px", borderRadius:"5px", fontSize:"12px", width:"100%", boxSizing:"border-box" },
    sel: { background:"#060d18", border:"1px solid #1e3a5f", color:"#cbd5e1", padding:"7px 10px", borderRadius:"5px", fontSize:"12px", width:"100%" },
    modal: { position:"fixed", inset:0, background:"#000000cc", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:"16px" },
    mbox: { background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:"10px", padding:"24px", width:"100%", maxWidth:"620px", maxHeight:"88vh", overflowY:"auto" },
    lbl: { color:"#334155", fontSize:"10px", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:"4px", display:"block" },
    aibox: { background:"#060d18", border:"1px solid #1e3a5f", borderRadius:"6px", padding:"14px", marginTop:"10px", color:"#94a3b8", lineHeight:"1.7", whiteSpace:"pre-wrap", fontSize:"12px" },
    divider: { border:"none", borderTop:"1px solid #1e3a5f", margin:"14px 0" },
    row: { display:"flex", gap:"10px", alignItems:"flex-start", marginBottom:"10px" },
    scoreBar: (n) => ({ height:"3px", borderRadius:"2px", marginTop:"3px", background:`linear-gradient(90deg, ${n>=80?"#34d399":n>=65?"#fbbf24":"#ef4444"} ${n}%, #1e293b ${n}%)` }),
    sourceTag: (s) => ({ background:"#1e293b", color:"#64748b", padding:"1px 6px", borderRadius:"3px", fontSize:"10px" }),
    alert: { background:"#451a0322", border:"1px solid #fbbf2444", borderRadius:"6px", padding:"10px 14px", marginBottom:"14px", color:"#fbbf24", fontSize:"11px" },
  };

  // ── JOB CARD ──
  const JobCard = ({ job, compact = false }) => (
    <div style={{ ...C.card(`${job.match_score >= 80 ? "#34d399" : job.match_score >= 65 ? "#fbbf24" : "#1e3a5f"}33`), marginBottom:"8px", opacity: job.is_applied ? 0.5 : 1 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"12px" }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:"#e2e8f0", fontWeight:"600", fontSize:"13px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {job.job_title || "Untitled"}
            {job.is_applied && <span style={{ color:"#34d399", marginLeft:"8px", fontSize:"10px" }}>✓ Applied</span>}
          </div>
          <div style={{ color:"#475569", marginTop:"2px", fontSize:"11px" }}>
            {job.company} · <span style={C.sourceTag(job.source)}>{job.source}</span>
            {job.location && <span style={{ marginLeft:"6px", color:"#334155" }}>{job.location}</span>}
          </div>
          {job.salary && <div style={{ color:"#34d399", fontSize:"11px", marginTop:"2px" }}>{job.salary}</div>}
          {job.match_reasons && !compact && <div style={{ color:"#475569", fontSize:"11px", marginTop:"6px", lineHeight:"1.5" }}>{job.match_reasons}</div>}
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <span style={C.scoreBadge(job.match_score)}>{job.match_score}% match</span>
          <div style={C.scoreBar(job.match_score)} />
          <div style={{ color:"#334155", fontSize:"10px", marginTop:"4px" }}>{new Date(job.created_at).toLocaleDateString()}</div>
        </div>
      </div>
      {!compact && (
        <div style={{ display:"flex", gap:"6px", marginTop:"10px", flexWrap:"wrap" }}>
          {job.job_url && <a href={job.job_url} target="_blank" rel="noopener noreferrer" style={{ ...C.btn("#60a5fa"), textDecoration:"none" }}>View Job ↗</a>}
          {!job.is_applied && <button style={C.btnS("#34d399")} onClick={() => markApplied(job)}>✓ Mark Applied</button>}
          <button style={C.btn("#a78bfa")} onClick={() => { setSelected({...job, _type:"job"}); setAiText(""); }}>AI Tools</button>
        </div>
      )}
    </div>
  );

  // ── APP CARD ──
  const AppCard = ({ app }) => (
    <div style={{ ...C.card(), marginBottom:"8px", cursor:"pointer" }}
      onClick={() => { setSelected({...app, _type:"app"}); setAiText(""); }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ flex:1 }}>
          <div style={{ color:"#e2e8f0", fontWeight:"600" }}>{app.job_title || "Untitled"}</div>
          <div style={{ color:"#475569", fontSize:"11px", marginTop:"2px" }}>{app.company} · {app.platform}</div>
          {app.budget && <div style={{ color:"#34d399", fontSize:"11px" }}>{app.budget}</div>}
        </div>
        <div style={{ textAlign:"right", marginLeft:"12px" }}>
          <span style={C.badge(app.status)}>{STATUS[app.status]?.l}</span>
          {app.match_score && <div style={{ marginTop:"4px" }}><span style={C.scoreBadge(parseInt(app.match_score))}>{app.match_score}%</span></div>}
          {app.follow_up_date <= today && app.status === "applied" && <div style={{ color:"#fbbf24", fontSize:"10px", marginTop:"3px" }}>⚠ Follow-up due</div>}
        </div>
      </div>
      <div style={{ display:"flex", gap:"6px", marginTop:"8px", flexWrap:"wrap" }}>
        {Object.entries(STATUS).slice(0,4).map(([s, cfg]) => (
          <button key={s} style={app.status===s ? C.btnS(cfg.c) : C.btn(cfg.c)}
            onClick={e => { e.stopPropagation(); updateStatus(app.id, s); }}>
            {cfg.l}
          </button>
        ))}
      </div>
    </div>
  );

  // ── DASHBOARD ──
  const Dashboard = () => (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"18px" }}>
        <div>
          <div style={{ color:"#38bdf8", fontSize:"18px", fontWeight:"700" }}>Remote Job Engine ⚡</div>
          <div style={{ color:"#334155", fontSize:"11px" }}>Sachin Jadhav · Credit Risk & Banking Analytics · 19 Yrs BFSI</div>
        </div>
        <div style={{ display:"flex", gap:"8px" }}>
          <button style={C.btn()} onClick={loadAll}>↻ Refresh</button>
          <button style={C.btnS()} onClick={() => setShowAdd(true)}>+ Add Application</button>
        </div>
      </div>

      {appStats.followup > 0 && <div style={C.alert}>⚠ {appStats.followup} follow-up{appStats.followup>1?"s":""} due today — go to Applications tab</div>}

      <div style={C.grid4}>
        {[
          { v:appStats.total, l:"Applications", c:"#38bdf8" },
          { v:stats.fetched_today||0, l:"Jobs Fetched Today", c:"#a78bfa" },
          { v:stats.high_match||0, l:"High Matches (65+)", c:"#34d399" },
          { v:appStats.offer, l:"Offers", c:"#f472b6" },
        ].map((s,i) => (
          <div key={i} style={C.stat(s.c)}>
            <div style={C.sl}>{s.l}</div>
            <div style={C.sv(s.c)}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={C.grid3}>
        <div style={C.card()}>
          <div style={{ color:"#334155", fontSize:"10px", letterSpacing:"0.07em", marginBottom:"12px" }}>APPLICATION PIPELINE</div>
          {Object.entries(STATUS).filter(([k])=>k!=="closed").map(([s,cfg]) => {
            const n = apps.filter(a=>a.status===s).length;
            const p = appStats.total ? Math.round(n/appStats.total*100) : 0;
            return (
              <div key={s} style={{ marginBottom:"7px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"2px" }}>
                  <span style={{ color:cfg.c, fontSize:"10px" }}>{cfg.l}</span>
                  <span style={{ color:"#334155", fontSize:"10px" }}>{n}</span>
                </div>
                <div style={{ height:"2px", background:"#1e293b", borderRadius:"1px" }}>
                  <div style={{ height:"2px", width:`${p}%`, background:cfg.c, borderRadius:"1px" }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={C.card()}>
          <div style={{ color:"#334155", fontSize:"10px", letterSpacing:"0.07em", marginBottom:"12px" }}>JOB SOURCES LIVE</div>
          {["Himalayas","Remotive","Jobicy","WeWorkRemotely","LinkedIn","Gmail Alert"].map(src => {
            const n = jobs.filter(j=>j.source===src).length;
            return (
              <div key={src} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #0a1628" }}>
                <span style={{ color:"#64748b" }}>{src}</span>
                <span style={{ color: n>0?"#34d399":"#334155", fontWeight:"600" }}>{n} jobs</span>
              </div>
            );
          })}
          <div style={{ marginTop:"10px", color:"#334155", fontSize:"10px" }}>
            Total in DB: {jobs.length} · Pending: {stats.pending_review||0}
          </div>
        </div>

        <div style={C.card()}>
          <div style={{ color:"#334155", fontSize:"10px", letterSpacing:"0.07em", marginBottom:"12px" }}>TOP MATCHES TODAY</div>
          {jobs.filter(j=>j.match_score>=75&&!j.is_applied).slice(0,4).map(j => (
            <div key={j.id} style={{ padding:"6px 0", borderBottom:"1px solid #0a1628", cursor:"pointer" }}
              onClick={() => { setTab("jobs"); setSearch(j.job_title||""); }}>
              <div style={{ color:"#e2e8f0", fontSize:"11px" }}>{j.job_title}</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:"2px" }}>
                <span style={{ color:"#475569", fontSize:"10px" }}>{j.company}</span>
                <span style={C.scoreBadge(j.match_score)}>{j.match_score}%</span>
              </div>
            </div>
          ))}
          {!jobs.filter(j=>j.match_score>=75).length && (
            <div style={{ color:"#334155", fontSize:"11px" }}>
              Waiting for high-match jobs (65+)...<br/>
              <span style={{ fontSize:"10px" }}>n8n workflows auto-fetch every 2 hours</span>
            </div>
          )}
          <button style={{ ...C.btn(), marginTop:"10px", width:"100%", textAlign:"center" }} onClick={() => setTab("jobs")}>
            View all {jobs.filter(j=>!j.is_applied).length} unreviewed jobs →
          </button>
        </div>
      </div>

      <div style={C.card()}>
        <div style={{ color:"#334155", fontSize:"10px", letterSpacing:"0.07em", marginBottom:"12px" }}>RECENT APPLICATIONS</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px" }}>
          {apps.slice(0,4).map(a => (
            <div key={a.id} style={{ background:"#060d18", borderRadius:"6px", padding:"10px", cursor:"pointer" }}
              onClick={() => { setSelected({...a,_type:"app"}); setAiText(""); }}>
              <div style={{ color:"#e2e8f0", fontSize:"12px", fontWeight:"500" }}>{a.job_title}</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:"4px" }}>
                <span style={{ color:"#475569", fontSize:"10px" }}>{a.company}</span>
                <span style={C.badge(a.status)}>{STATUS[a.status]?.l}</span>
              </div>
            </div>
          ))}
        </div>
        {!apps.length && <div style={{ color:"#334155", textAlign:"center", padding:"20px" }}>No applications yet — jobs are being fetched automatically!</div>}
      </div>
    </div>
  );

  // ── JOBS TAB ──
  const JobsTab = () => (
    <div>
      <div style={{ display:"flex", gap:"10px", marginBottom:"14px", flexWrap:"wrap", alignItems:"center" }}>
        <input style={{ ...C.inp, width:"200px" }} placeholder="Search jobs..." value={search} onChange={e=>setSearch(e.target.value)} />
        {["all","high","new","applied"].map(f => (
          <button key={f} style={C.tab(jobFilter===f)} onClick={() => setJobFilter(f)}>
            {f==="all"?`All (${jobs.length})`:f==="high"?`High Match (${jobs.filter(j=>j.match_score>=80).length})`:f==="new"?`Unreviewed (${jobs.filter(j=>!j.is_applied).length})`:`Applied (${jobs.filter(j=>j.is_applied).length})`}
          </button>
        ))}
        <div style={{ marginLeft:"auto", color:"#334155", fontSize:"10px" }}>
          Auto-fetched from 6 sources every 2 hours · {stats.fetched_today||0} today
        </div>
      </div>
      {jobsLoading && <div style={{ color:"#475569", padding:"20px", textAlign:"center" }}>Fetching latest jobs...</div>}
      {filteredJobs.map(j => <JobCard key={j.id} job={j} />)}
      {!filteredJobs.length && (
        <div style={{ textAlign:"center", padding:"60px", color:"#334155" }}>
          <div style={{ fontSize:"28px", marginBottom:"8px" }}>🔍</div>
          <div>No jobs found yet</div>
          <div style={{ fontSize:"11px", marginTop:"4px" }}>n8n workflows auto-populate this — new jobs appear within 2 hours</div>
        </div>
      )}
    </div>
  );

  // ── APPLICATIONS TAB ──
  const AppsTab = () => (
    <div>
      <div style={{ display:"flex", gap:"10px", marginBottom:"14px", flexWrap:"wrap", alignItems:"center" }}>
        <input style={{ ...C.inp, width:"200px" }} placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} />
        {["all","applied","responded","interview","offer","followup"].map(f => (
          <button key={f} style={C.tab(appFilter===f)} onClick={() => setAppFilter(f)}>
            {f==="followup"?`⚠ Follow-ups (${appStats.followup})`:f==="all"?`All (${apps.length})`:f}
            {f==="offer"&&appStats.offer>0?` 🎉`:""}
          </button>
        ))}
        <button style={C.btnS()} onClick={()=>setShowAdd(true)}>+ Add</button>
      </div>
      {filteredApps.map(a => <AppCard key={a.id} app={a} />)}
      {!filteredApps.length && (
        <div style={{ textAlign:"center", padding:"60px", color:"#334155" }}>
          <div style={{ fontSize:"28px", marginBottom:"8px" }}>📭</div>
          <div>No applications here</div>
          <button style={{ ...C.btnS(), marginTop:"12px" }} onClick={()=>setShowAdd(true)}>Add manually</button>
        </div>
      )}
    </div>
  );

  // ── AI TOOLS TAB ──
  const AITab = () => {
    const [jd, setJd] = useState("");
    const [cvOut, setCvOut] = useState("");
    const [cvLoad, setCvLoad] = useState(false);
    const [q, setQ] = useState("");
    const [ans, setAns] = useState("");
    const [fb, setFb] = useState("");
    const [iLoad, setILoad] = useState(false);

    return (
      <div>
        <div style={{ color:"#38bdf8", fontWeight:"700", fontSize:"14px", marginBottom:"16px" }}>AI Tools</div>
        <div style={C.grid2}>
          <div style={C.card()}>
            <div style={{ color:"#a78bfa", fontWeight:"600", marginBottom:"8px" }}>📄 CV Tailoring Engine</div>
            <div style={{ color:"#475569", fontSize:"11px", marginBottom:"10px" }}>Paste any job description → get a tailored professional summary</div>
            <textarea style={{ ...C.inp, height:"100px", resize:"vertical" }} placeholder="Paste job description..." value={jd} onChange={e=>setJd(e.target.value)} />
            <button style={{ ...C.btnS("#a78bfa"), marginTop:"8px", width:"100%" }} onClick={async()=>{
              setCvLoad(true); setCvOut("");
              const r = await claude(`Write a tailored 3-paragraph professional summary for Sachin Jadhav (19yr BFSI, credit risk, banking analytics, Rs500Cr portfolios, CAIIB, remote available) for this role:\n${jd}\n\nP1: match their need. P2: achievements with numbers. P3: tools match + availability. Under 250 words, ATS-optimised.`);
              setCvOut(r); setCvLoad(false);
            }} disabled={cvLoad||!jd}>{cvLoad?"Tailoring...":"Generate Tailored Summary"}</button>
            {cvOut && <div style={C.aibox}>{cvOut}<button style={{ ...C.btn(), marginTop:"8px", fontSize:"10px" }} onClick={()=>navigator.clipboard.writeText(cvOut)}>Copy</button></div>}
          </div>

          <div style={C.card()}>
            <div style={{ color:"#f472b6", fontWeight:"600", marginBottom:"8px" }}>🎤 Mock Interview</div>
            <div style={{ color:"#475569", fontSize:"11px", marginBottom:"10px" }}>Practice with AI — get scored on STAR format and domain expertise</div>
            <button style={{ ...C.btnS("#f472b6"), width:"100%" }} onClick={async()=>{
              setILoad(true); setFb(""); setAns("");
              const r = await claude("Give ONE tough interview question for a senior credit risk and banking analytics consultant at a global fintech. 19yr experience. Specific and challenging. Just the question.");
              setQ(r); setILoad(false);
            }} disabled={iLoad}>{iLoad?"Loading...":"Get Question"}</button>
            {q && <div style={{ ...C.aibox, color:"#f472b6", marginTop:"10px" }}>{q}</div>}
            {q && <textarea style={{ ...C.inp, height:"80px", marginTop:"8px", resize:"vertical" }} placeholder="Your answer..." value={ans} onChange={e=>setAns(e.target.value)} />}
            {q && ans && <button style={{ ...C.btnS("#fbbf24"), marginTop:"6px" }} onClick={async()=>{
              setILoad(true);
              const r = await claude(`Q: ${q}\nA: ${ans}\n\nScore this answer (1-10) on: specific numbers used, STAR structure, banking domain shown, measurable impact. One improvement tip. Be direct.`);
              setFb(r); setILoad(false);
            }} disabled={iLoad}>{iLoad?"Scoring...":"Get AI Feedback"}</button>}
            {fb && <div style={C.aibox}>{fb}</div>}
          </div>
        </div>

        <div style={C.card()}>
          <div style={{ color:"#34d399", fontWeight:"600", marginBottom:"8px" }}>⚡ Quick AI Actions</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px" }}>
            {[
              { label:"Proposal for latest job", action: () => { const j=jobs.find(x=>!x.is_applied&&x.match_score>=65); if(j) doAI("proposal",j); } },
              { label:"Follow-up for oldest app", action: () => { const a=apps.filter(x=>x.status==="applied").slice(-1)[0]; if(a) doAI("followup",a); } },
              { label:"Daily motivation", action: async()=>{ setAiLoading(true); const r=await claude(`Give Sachin Jadhav (credit risk consultant, applied to ${appStats.total} jobs, ${appStats.responded} responses so far) a 2-sentence motivational insight about his job search momentum. Be specific and encouraging.`); setAiText(r); setAiLoading(false); } },
            ].map((a,i) => (
              <button key={i} style={{ ...C.btn("#34d399"), padding:"10px", textAlign:"center" }} onClick={a.action}>{a.label}</button>
            ))}
          </div>
          {aiLoading && <div style={{ color:"#475569", marginTop:"10px" }}>Claude is thinking...</div>}
          {aiText && <div style={C.aibox}>{aiText}<button style={{ ...C.btn(), marginTop:"6px", fontSize:"10px" }} onClick={()=>navigator.clipboard.writeText(aiText)}>Copy</button></div>}
        </div>
      </div>
    );
  };

  // ── ADD MODAL ──
  const AddModal = () => {
    const [f, setF] = useState({ platform:"LinkedIn", job_title:"", company:"", job_url:"", budget:"", match_score:"", status:"applied", notes:"", follow_up_date: new Date(Date.now()+5*86400000).toISOString().split("T")[0] });
    return (
      <div style={C.modal} onClick={e=>e.target===e.currentTarget&&setShowAdd(false)}>
        <div style={C.mbox}>
          <div style={{ color:"#38bdf8", fontWeight:"700", fontSize:"14px", marginBottom:"16px" }}>Add Application</div>
          <div style={C.grid3}>
            <div><label style={C.lbl}>Platform</label><select style={C.sel} value={f.platform} onChange={e=>setF({...f,platform:e.target.value})}>
              {["LinkedIn","Indeed","Upwork","PPH","Fiverr","Freelancer","Toptal","Braintrust","Direct","Agency","Other"].map(p=><option key={p}>{p}</option>)}
            </select></div>
            <div><label style={C.lbl}>Status</label><select style={C.sel} value={f.status} onChange={e=>setF({...f,status:e.target.value})}>
              {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.l}</option>)}
            </select></div>
            <div><label style={C.lbl}>Match %</label><input style={C.inp} type="number" min="0" max="100" value={f.match_score} onChange={e=>setF({...f,match_score:e.target.value})} placeholder="75" /></div>
          </div>
          <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Job Title *</label><input style={C.inp} value={f.job_title} onChange={e=>setF({...f,job_title:e.target.value})} placeholder="Credit Risk Analyst" /></div>
          <div style={C.grid2}>
            <div><label style={C.lbl}>Company</label><input style={C.inp} value={f.company} onChange={e=>setF({...f,company:e.target.value})} placeholder="Company" /></div>
            <div><label style={C.lbl}>Budget/Rate</label><input style={C.inp} value={f.budget} onChange={e=>setF({...f,budget:e.target.value})} placeholder="$45/hr" /></div>
          </div>
          <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Job URL</label><input style={C.inp} value={f.job_url} onChange={e=>setF({...f,job_url:e.target.value})} placeholder="https://..." /></div>
          <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Follow-up Date</label><input style={C.inp} type="date" value={f.follow_up_date} onChange={e=>setF({...f,follow_up_date:e.target.value})} /></div>
          <div style={{ marginBottom:"16px" }}><label style={C.lbl}>Notes</label><textarea style={{ ...C.inp, height:"60px", resize:"vertical" }} value={f.notes} onChange={e=>setF({...f,notes:e.target.value})} /></div>
          <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end" }}>
            <button style={C.btn()} onClick={()=>setShowAdd(false)}>Cancel</button>
            <button style={C.btnS()} onClick={async()=>{ if(!f.job_title) return; await api("rje_applications","POST",f); setShowAdd(false); loadAll(); }}>Add Application</button>
          </div>
        </div>
      </div>
    );
  };

  // ── DETAIL MODAL ──
  const DetailModal = ({ item }) => (
    <div style={C.modal} onClick={e=>e.target===e.currentTarget&&(setSelected(null),setAiText(""))}>
      <div style={C.mbox}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"16px" }}>
          <div>
            <div style={{ color:"#e2e8f0", fontWeight:"700", fontSize:"14px" }}>{item.job_title||item.title}</div>
            <div style={{ color:"#475569", fontSize:"11px" }}>{item.company||item.company_name} · {item.platform||item.source}</div>
          </div>
          {item._type==="app" ? <span style={C.badge(item.status)}>{STATUS[item.status]?.l}</span> : <span style={C.scoreBadge(item.match_score)}>{item.match_score}% match</span>}
        </div>

        {item.match_reasons && <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Match Reasons</label><div style={{ color:"#64748b", fontSize:"11px", lineHeight:"1.6" }}>{item.match_reasons}</div></div>}
        {item.salary && <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Salary/Rate</label><div style={{ color:"#34d399" }}>{item.salary}</div></div>}
        {item.budget && <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Budget</label><div style={{ color:"#34d399" }}>{item.budget}</div></div>}
        {(item.job_url||item.url) && <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Job URL</label><a href={item.job_url||item.url} target="_blank" rel="noopener noreferrer" style={{ color:"#38bdf8", fontSize:"11px" }}>{item.job_url||item.url}</a></div>}
        {item.notes && <div style={{ marginBottom:"10px" }}><label style={C.lbl}>Notes</label><div style={{ color:"#64748b", fontSize:"11px" }}>{item.notes}</div></div>}

        {item._type==="app" && (
          <>
            <div style={C.divider} />
            <label style={C.lbl}>Update Status</label>
            <div style={{ display:"flex", gap:"5px", flexWrap:"wrap", marginBottom:"12px" }}>
              {Object.entries(STATUS).map(([s,cfg])=>(
                <button key={s} style={item.status===s?C.btnS(cfg.c):C.btn(cfg.c)}
                  onClick={()=>{ updateStatus(item.id,s); setSelected({...item,status:s}); }}>
                  {cfg.l}
                </button>
              ))}
            </div>
          </>
        )}

        {item._type==="job" && !item.is_applied && (
          <>
            <div style={C.divider} />
            <button style={{ ...C.btnS("#34d399"), width:"100%", marginBottom:"10px" }} onClick={()=>{ markApplied(item); setSelected(null); }}>
              ✓ Mark as Applied — Auto-log to tracker
            </button>
          </>
        )}

        <div style={C.divider} />
        <label style={C.lbl}>AI Tools</label>
        <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"10px" }}>
          <button style={C.btn("#a78bfa")} onClick={()=>doAI("proposal",item)}>Generate Proposal</button>
          <button style={C.btn("#fbbf24")} onClick={()=>doAI("followup",item)}>Follow-up Draft</button>
          <button style={C.btn("#34d399")} onClick={()=>doAI("cover",item)}>Cover Letter</button>
        </div>
        {aiLoading && <div style={{ color:"#475569" }}>Claude is generating...</div>}
        {aiText && (
          <div>
            <div style={C.aibox}>{aiText}</div>
            <button style={{ ...C.btn(), marginTop:"6px", fontSize:"10px" }} onClick={()=>navigator.clipboard.writeText(aiText)}>Copy to clipboard</button>
          </div>
        )}

        <div style={C.divider} />
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          {item._type==="app" && <button style={C.btn("#ef4444")} onClick={async()=>{ if(confirm("Delete?")){ await api(`rje_applications?id=eq.${item.id}`,"DELETE"); setSelected(null); loadAll(); } }}>Delete</button>}
          <button style={{ ...C.btn(), marginLeft:"auto" }} onClick={()=>{ setSelected(null); setAiText(""); }}>Close</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={C.app}>
      <nav style={C.nav}>
        <span style={C.logo}>RJE ⚡</span>
        {[
          { id:"dashboard", label:"Dashboard" },
          { id:"jobs", label:`Jobs (${jobs.filter(j=>!j.is_applied).length} new)` },
          { id:"applications", label:`Applications (${appStats.total})` },
          { id:"aitools", label:"AI Tools" },
        ].map(v => (
          <button key={v.id} style={C.tab(tab===v.id)} onClick={()=>{ setTab(v.id); setSearch(""); setAiText(""); }}>
            {v.label}
            {v.id==="applications"&&appStats.followup>0 && <span style={{ background:"#fbbf24", color:"#000", borderRadius:"8px", padding:"0 5px", fontSize:"9px", marginLeft:"5px" }}>{appStats.followup}</span>}
          </button>
        ))}
        <div style={{ marginLeft:"auto", color:"#1e3a5f", fontSize:"10px" }}>
          {loading ? "Loading..." : `Last updated ${new Date().toLocaleTimeString()}`}
        </div>
      </nav>

      <main style={C.main}>
        {loading ? (
          <div style={{ textAlign:"center", padding:"80px", color:"#1e3a5f" }}>
            <div style={{ fontSize:"32px", marginBottom:"8px" }}>⚡</div>
            <div>Connecting to Remote Job Engine...</div>
          </div>
        ) : (
          <>
            {tab==="dashboard" && <Dashboard />}
            {tab==="jobs" && <JobsTab />}
            {tab==="applications" && <AppsTab />}
            {tab==="aitools" && <AITab />}
          </>
        )}
      </main>

      {showAdd && <AddModal />}
      {selected && <DetailModal item={selected} />}
    </div>
  );
}
