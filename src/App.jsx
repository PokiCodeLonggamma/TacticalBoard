import { useState, useEffect, useMemo } from "react";
import {
  Target, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Circle,
  Plus, Trash2, Edit3, Save, X, Download, Upload, BarChart3, DollarSign,
  Percent, Shield, Clock, ChevronRight, ArrowUpRight, ArrowDownRight,
  Activity, BookOpen, ListChecks, Crosshair, Calculator, FileText,
  Eye, Filter, Calendar, Zap, Star, StarOff,
  Search, Flame, Layers, SlidersHorizontal, RefreshCw,
  ArrowRightLeft, Boxes, Sigma, Gauge, Radio
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, LineChart, Line, Area, AreaChart, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ComposedChart, ReferenceLine
} from "recharts";

// ════════════════════════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════════════════════════
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n, d = 2) => n != null && !isNaN(n) ? Number(n).toFixed(d) : "—";
const fmtK = (n) => { if (n == null) return "—"; if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+"M"; if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+"K"; return fmt(n,0); };
const td = () => new Date().toISOString().slice(0,10);
const nt = () => new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

// ════════════════════════════════════════════════════════════════════════
//  GREEKS ENGINE (Black-Scholes)
// ════════════════════════════════════════════════════════════════════════
function normalCDF(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1; x = Math.abs(x)/Math.sqrt(2);
  const t = 1/(1+p*x);
  const y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}
function normalPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

function blackScholes(S, K, T, r, sigma, type="call") {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { price:0, delta:0, gamma:0, theta:0, vega:0 };
  const d1 = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2 = d1 - sigma*Math.sqrt(T);
  let price, delta;
  if (type === "call") {
    price = S*normalCDF(d1) - K*Math.exp(-r*T)*normalCDF(d2);
    delta = normalCDF(d1);
  } else {
    price = K*Math.exp(-r*T)*normalCDF(-d2) - S*normalCDF(-d1);
    delta = normalCDF(d1) - 1;
  }
  const gamma = normalPDF(d1)/(S*sigma*Math.sqrt(T));
  const theta = (-(S*normalPDF(d1)*sigma)/(2*Math.sqrt(T)) - r*K*Math.exp(-r*T)*(type==="call"?normalCDF(d2):normalCDF(-d2)))/365;
  const vega = S*normalPDF(d1)*Math.sqrt(T)/100;
  return { price, delta, gamma, theta, vega };
}

function computePortfolioGreeks(positions) {
  let netDelta=0, netGamma=0, netTheta=0, netVega=0;
  positions.forEach(p => {
    const mult = (p.contracts||p.size||0) * (p.multiplier||100) * (p.direction === "SHORT" ? -1 : 1);
    netDelta += (p.delta||0) * mult;
    netGamma += (p.gamma||0) * mult;
    netTheta += (p.theta||0) * mult;
    netVega  += (p.vega||0) * mult;
  });
  return { netDelta, netGamma, netTheta, netVega };
}

// ════════════════════════════════════════════════════════════════════════
//  TECHNICAL ANALYSIS
// ════════════════════════════════════════════════════════════════════════
function computeSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((s,p)=>s+p,0)/period;
}
function computeMACD(prices) {
  if (prices.length<26) return {macd:null,signal:null,histogram:null};
  const k12=2/13,k26=2/27;
  let e12=prices.slice(0,12).reduce((s,p)=>s+p,0)/12;
  let e26=prices.slice(0,26).reduce((s,p)=>s+p,0)/26;
  const hist=[];
  for (let i=12;i<prices.length;i++){e12=prices[i]*k12+e12*(1-k12); if(i>=26){e26=prices[i]*k26+e26*(1-k26); hist.push(e12-e26);}}
  const macd=hist.length>0?hist[hist.length-1]:null;
  let signal=null;
  if(hist.length>=9){const k9=2/10;signal=hist.slice(0,9).reduce((s,v)=>s+v,0)/9;for(let i=9;i<hist.length;i++)signal=hist[i]*k9+signal*(1-k9);}
  return {macd,signal,histogram:signal!=null?macd-signal:null};
}
function computeBollinger(prices,period=20,mult=2){
  if(prices.length<period) return {upper:null,middle:null,lower:null,width:null,pctB:null};
  const sl=prices.slice(-period); const mean=sl.reduce((s,p)=>s+p,0)/period;
  const std=Math.sqrt(sl.reduce((s,p)=>s+(p-mean)**2,0)/period);
  const upper=mean+mult*std, lower=mean-mult*std;
  const width=(upper-lower)/mean; const pctB=(upper-lower)>0?(prices[prices.length-1]-lower)/(upper-lower):0.5;
  return {upper,middle:mean,lower,width,pctB,std};
}
function detectBBSqueeze(widthHistory){
  if(widthHistory.length<20) return {isSqueeze:false,percentile:50};
  const sorted=[...widthHistory].sort((a,b)=>a-b);
  const current=widthHistory[widthHistory.length-1];
  const rank=sorted.filter(w=>w<=current).length;
  return {isSqueeze:(rank/sorted.length)*100<=10, percentile:(rank/sorted.length)*100};
}

// ════════════════════════════════════════════════════════════════════════
//  SQUEEZE SCORING + ROUTING
// ════════════════════════════════════════════════════════════════════════
function computeSqueezeScore({shortInterest,daysToCover,costToBorrow,siDelta,relativeVolume}){
  let s=0;
  if(shortInterest>=25)s+=30;else if(shortInterest>=15)s+=20;else if(shortInterest>=10)s+=10;
  if(daysToCover>=10)s+=25;else if(daysToCover>=5)s+=15;else if(daysToCover>=3)s+=8;
  if(costToBorrow>=100)s+=20;else if(costToBorrow>=30)s+=12;else if(costToBorrow>=10)s+=5;
  if(siDelta>5)s+=15;else if(siDelta>2)s+=8;else if(siDelta>0)s+=3;
  if(relativeVolume>=3)s+=10;else if(relativeVolume>=1.5)s+=5;
  return clamp(s,0,100);
}
function routeSignal({squeezeScore, ivRank, relativeVolume}){
  if(ivRank > 0 && ivRank < 50 && squeezeScore >= 40) return "options";
  if(relativeVolume >= 2 && squeezeScore >= 50) return "cfd";
  if(ivRank >= 70) return "cfd";
  return squeezeScore >= 60 ? "options" : "cfd";
}

// ════════════════════════════════════════════════════════════════════════
//  DEFAULT DATA
// ════════════════════════════════════════════════════════════════════════
const mkAccount = (name, type) => ({
  name, type,
  accountSize: 50000,
  maxRiskPerTrade: type==="cfd" ? 1.0 : 2.0,
  maxDailyLoss: 3.0, maxOpenPositions: type==="cfd" ? 5 : 8,
  maxCorrelatedRisk: 5.0, currency: "€",
});
const defaultAccounts = { cfd: mkAccount("Compte CFD — Chartiste", "cfd"), options: mkAccount("Compte Options Sèches", "options") };

const defaultChecklist = [
  {id:uid(),text:"Vérifier le calendrier macro (FOMC, NFP, CPI…)",done:false,category:"macro"},
  {id:uid(),text:"Scanner les gaps overnight + pre-market",done:false,category:"market"},
  {id:uid(),text:"Scanner le Short Interest top 200 (TradingView/Finviz)",done:false,category:"squeeze"},
  {id:uid(),text:"Identifier les niveaux clés S/R sur indices",done:false,category:"market"},
  {id:uid(),text:"Scanner les BB Squeeze sur la watchlist",done:false,category:"technical"},
  {id:uid(),text:"Revoir positions CFD — ajuster stops",done:false,category:"risk"},
  {id:uid(),text:"Revoir positions Options — vérifier grecques",done:false,category:"risk"},
  {id:uid(),text:"Vérifier theta decay journalier du book options",done:false,category:"risk"},
  {id:uid(),text:"Vérifier delta net du book options",done:false,category:"risk"},
  {id:uid(),text:"Identifier 2-3 setups prioritaires",done:false,category:"setups"},
  {id:uid(),text:"Biais directionnel",done:false,category:"setups"},
  {id:uid(),text:"Max loss du jour — par compte",done:false,category:"risk"},
  {id:uid(),text:"État mental (1-10)",done:false,category:"review"},
];

const defaultEvents = [
  {id:uid(),date:"2026-03-24",time:"14:30",title:"PMI Flash US",impact:"high",type:"macro",notes:"Consensus 52.1",ticker:""},
  {id:uid(),date:"2026-03-26",time:"08:00",title:"Earnings — LULU",impact:"high",type:"earnings",notes:"EPS $5.85 — SI 8%",ticker:"LULU"},
  {id:uid(),date:"2026-03-28",time:"14:30",title:"Core PCE",impact:"critical",type:"macro",notes:"Fed preferred gauge",ticker:""},
];

// ════════════════════════════════════════════════════════════════════════
//  THEME
// ════════════════════════════════════════════════════════════════════════
const C={
  bg:"bg-gray-950",card:"bg-gray-900 border border-gray-800",cardH:"hover:border-gray-700 transition-colors",
  input:"bg-gray-800 border border-gray-700 text-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500",
  select:"bg-gray-800 border border-gray-700 text-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500",
  btn:"px-4 py-2 rounded text-sm font-medium transition-all duration-150",
  btnP:"bg-blue-600 hover:bg-blue-500 text-white",btnD:"bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-800",
  btnG:"bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700",btnS:"bg-emerald-600 hover:bg-emerald-500 text-white",
  btnOpt:"bg-purple-600 hover:bg-purple-500 text-white",
  t:"text-gray-100",tm:"text-gray-400",td:"text-gray-500",
  g:"text-emerald-400",r:"text-red-400",y:"text-amber-400",b:"text-blue-400",p:"text-purple-400",
  div:"border-gray-800",tag:"text-xs px-2 py-0.5 rounded-full",
};

// ════════════════════════════════════════════════════════════════════════
//  PRIMITIVES
// ════════════════════════════════════════════════════════════════════════
function Badge({children,color="gray"}){
  const m={green:"bg-emerald-500/20 text-emerald-400 border-emerald-500/30",red:"bg-red-500/20 text-red-400 border-red-500/30",
    blue:"bg-blue-500/20 text-blue-400 border-blue-500/30",amber:"bg-amber-500/20 text-amber-400 border-amber-500/30",
    gray:"bg-gray-700/50 text-gray-400 border-gray-600/30",purple:"bg-purple-500/20 text-purple-400 border-purple-500/30",
    pink:"bg-pink-500/20 text-pink-400 border-pink-500/30",cyan:"bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    critical:"bg-red-600/30 text-red-300 border-red-500/40",orange:"bg-orange-500/20 text-orange-400 border-orange-500/30"};
  return <span className={`${C.tag} border ${m[color]||m.gray}`}>{children}</span>;
}
function Card({children,className=""}){return <div className={`${C.card} rounded-xl p-5 ${C.cardH} ${className}`}>{children}</div>;}
function Input({label,...props}){return <div>{label&&<label className={`block text-xs ${C.tm} mb-1.5`}>{label}</label>}<input className={`${C.input} w-full`}{...props}/></div>;}
function Sel({label,options,...props}){return <div>{label&&<label className={`block text-xs ${C.tm} mb-1.5`}>{label}</label>}<select className={`${C.select} w-full`}{...props}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;}

function ScoreGauge({score,label,size="md"}){
  const r=size==="lg"?42:28, sv=size==="lg"?96:64, circ=2*Math.PI*r;
  const offset=circ-(score/100)*circ;
  const col=score>=70?"#ef4444":score>=40?"#f59e0b":"#6b7280";
  const ts=size==="lg"?"text-3xl":"text-xl";
  return(
    <div className="flex flex-col items-center">
      <div className="relative" style={{width:sv,height:sv}}>
        <svg width={sv} height={sv} className="-rotate-90">
          <circle cx={sv/2} cy={sv/2} r={r} fill="none" stroke="#1f2937" strokeWidth="6"/>
          <circle cx={sv/2} cy={sv/2} r={r} fill="none" stroke={col} strokeWidth="6" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700"/>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center"><span className={`${ts} font-bold text-white`}>{score}</span></div>
      </div>
      {label&&<p className={`text-xs ${C.tm} mt-1.5`}>{label}</p>}
    </div>
  );
}

function StatCard({icon:Icon,label,value,sub,color="blue",trend}){
  const ic={blue:"text-blue-400 bg-blue-500/10",green:"text-emerald-400 bg-emerald-500/10",red:"text-red-400 bg-red-500/10",amber:"text-amber-400 bg-amber-500/10",purple:"text-purple-400 bg-purple-500/10",cyan:"text-cyan-400 bg-cyan-500/10"};
  return(<Card><div className="flex items-start justify-between"><div>
    <p className={`text-xs uppercase tracking-wider ${C.td} mb-1`}>{label}</p>
    <p className={`text-2xl font-bold ${C.t}`}>{value}</p>
    {sub&&<p className={`text-xs mt-1 ${trend==="up"?C.g:trend==="down"?C.r:C.tm}`}>{sub}</p>}
  </div><div className={`p-2.5 rounded-lg ${ic[color]||ic.blue}`}><Icon size={20}/></div></div></Card>);
}

function GreekBadge({label,value,warn}){
  const col = warn ? "text-red-400 bg-red-500/10" : "text-gray-200 bg-gray-800";
  return <div className={`rounded-lg px-3 py-2 text-center ${col}`}><p className={`text-xs ${C.td}`}>{label}</p><p className="text-lg font-bold font-mono">{value>=0?"+":""}{fmt(value,2)}</p></div>;
}

// ════════════════════════════════════════════════════════════════════════
//  ACCOUNT SWITCHER
// ════════════════════════════════════════════════════════════════════════
function AccountSwitcher({activeAccount, setActiveAccount, accounts, cfdTrades, optTrades}){
  const cfdPnl = cfdTrades.filter(t=>t.status==="closed"&&t.date===td()).reduce((s,t)=>s+(t.pnl||0),0);
  const optPnl = optTrades.filter(t=>t.status==="closed"&&t.date===td()).reduce((s,t)=>s+(t.pnl||0),0);
  return(
    <div className="flex gap-2 mb-6">
      {[{key:"cfd",label:"CFD Chartiste",icon:BarChart3,pnl:cfdPnl,pos:cfdTrades.filter(t=>t.status==="open").length},
        {key:"options",label:"Options Sèches",icon:Sigma,pnl:optPnl,pos:optTrades.filter(t=>t.status==="open").length}
      ].map(a=>(
        <button key={a.key} onClick={()=>setActiveAccount(a.key)}
          className={`flex-1 flex items-center gap-3 p-4 rounded-xl border transition-all ${
            activeAccount===a.key ? "bg-gray-800 border-blue-500/50 ring-1 ring-blue-500/30" : "bg-gray-900 border-gray-800 hover:border-gray-700"
          }`}>
          <div className={`p-2 rounded-lg ${activeAccount===a.key ? (a.key==="cfd"?"bg-blue-500/20 text-blue-400":"bg-purple-500/20 text-purple-400") : "bg-gray-800 text-gray-500"}`}><a.icon size={20}/></div>
          <div className="text-left flex-1">
            <p className={`text-sm font-semibold ${activeAccount===a.key?"text-white":"text-gray-400"}`}>{a.label}</p>
            <p className={`text-xs ${C.td}`}>{a.pos} pos.</p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-bold ${a.pnl>=0?C.g:C.r}`}>{a.pnl>=0?"+":""}{fmt(a.pnl,0)}{accounts[a.key].currency}</p>
            <p className={`text-xs ${C.td}`}>P&L jour</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════
function Dashboard({activeAccount, trades, positions, account, checklist, scannerItems, events, suggestions}){
  const closedT=trades.filter(t=>t.status==="closed"&&t.date===td());
  const dailyPnL=closedT.reduce((s,t)=>s+(t.pnl||0),0);
  const unrealPnL=positions.reduce((s,p)=>s+(p.unrealizedPnl||0),0);
  const totalPnL=dailyPnL+unrealPnL;
  const totalRisk=positions.reduce((s,p)=>s+Math.abs(p.riskAmount||0),0);
  const riskPct=(totalRisk/account.accountSize)*100;
  const dailyLossPct=Math.abs(Math.min(dailyPnL,0))/account.accountSize*100;

  const greeks = activeAccount==="options" ? computePortfolioGreeks(positions) : null;

  const last7=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const ds=d.toISOString().slice(0,10);
    return {day:d.toLocaleDateString("fr-FR",{weekday:"short"}),pnl:trades.filter(t=>t.date===ds&&t.status==="closed").reduce((s,t)=>s+(t.pnl||0),0)};});
  const cumul=last7.reduce((a,d,i)=>{a.push({...d,cumul:i>0?a[i-1].cumul+d.pnl:d.pnl});return a;},[]);

  const acctSuggestions = suggestions.filter(s=>s.routedTo===activeAccount&&s.status==="pending");

  return(
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{account.name}</h2>
          <p className={C.tm}>{new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})} — {nt()}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge color={checklist.filter(c=>c.done).length===checklist.length?"green":"amber"}><ListChecks size={12} className="inline mr-1"/>{checklist.filter(c=>c.done).length}/{checklist.length}</Badge>
          {dailyLossPct>=account.maxDailyLoss&&<Badge color="critical"><AlertTriangle size={12} className="inline mr-1"/>MAX LOSS</Badge>}
        </div>
      </div>

      <div className={`grid gap-4 ${activeAccount==="options"?"grid-cols-2 lg:grid-cols-5":"grid-cols-2 lg:grid-cols-4"}`}>
        <StatCard icon={DollarSign} label="P&L jour" value={`${totalPnL>=0?"+":""}${fmt(totalPnL,0)}${account.currency}`}
          sub={`Réalisé ${fmt(dailyPnL,0)} | Latent ${fmt(unrealPnL,0)}`} color={totalPnL>=0?"green":"red"} trend={totalPnL>=0?"up":"down"}/>
        <StatCard icon={Crosshair} label="Trades" value={trades.filter(t=>t.date===td()).length} color="blue"/>
        <StatCard icon={Shield} label="Risque" value={`${fmt(riskPct,1)}%`}
          sub={`${fmt(totalRisk,0)}${account.currency} — ${positions.length} pos.`}
          color={riskPct>account.maxCorrelatedRisk*0.8?"red":"green"}/>
        <StatCard icon={Activity} label="Loss limit" value={`${fmt(dailyLossPct,1)}%/${account.maxDailyLoss}%`}
          color={dailyLossPct>=account.maxDailyLoss?"red":"green"}/>
        {activeAccount==="options"&&greeks&&(
          <StatCard icon={Sigma} label="Theta /jour" value={`${fmt(greeks.netTheta,0)}${account.currency}`}
            sub={`\u0394${fmt(greeks.netDelta,1)} \u0393${fmt(greeks.netGamma,3)} V${fmt(greeks.netVega,1)}`}
            color={greeks.netTheta<0?"red":"green"} trend={greeks.netTheta>=0?"up":"down"}/>
        )}
      </div>

      {activeAccount==="options"&&greeks&&(
        <Card>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Sigma size={16} className={C.p}/>Grecques portefeuille</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <GreekBadge label="Delta Net" value={greeks.netDelta} warn={Math.abs(greeks.netDelta)>50}/>
            <GreekBadge label="Gamma Net" value={greeks.netGamma}/>
            <GreekBadge label="Theta /jour" value={greeks.netTheta} warn={greeks.netTheta<-100}/>
            <GreekBadge label="Vega Net" value={greeks.netVega} warn={Math.abs(greeks.netVega)>200}/>
          </div>
          {Math.abs(greeks.netDelta)>50&&<p className="text-xs text-red-400 mt-2 flex items-center gap-1"><AlertTriangle size={12}/>Delta net important — exposition directionnelle</p>}
          {greeks.netTheta<-100&&<p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertTriangle size={12}/>Theta drain: {fmt(Math.abs(greeks.netTheta),0)}{account.currency}/jour</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-white mb-4">P&L — 7 jours</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={cumul} margin={{top:5,right:10,left:10,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937"/>
              <XAxis dataKey="day" tick={{fill:"#6b7280",fontSize:12}} axisLine={false}/>
              <YAxis tick={{fill:"#6b7280",fontSize:12}} axisLine={false}/>
              <Tooltip contentStyle={{backgroundColor:"#111827",border:"1px solid #374151",borderRadius:8}}/>
              <Bar dataKey="pnl" radius={[4,4,0,0]}>{cumul.map((e,i)=><Cell key={i} fill={e.pnl>=0?"#10b981":"#ef4444"} fillOpacity={0.8}/>)}</Bar>
              <Line type="monotone" dataKey="cumul" stroke="#3b82f6" strokeWidth={2} dot={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Flame size={14} className="text-orange-400"/>Signaux Squeeze</h3>
          {acctSuggestions.length>0?acctSuggestions.slice(0,4).map(s=>(
            <div key={s.id} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white text-sm">{s.ticker}</span>
                <Badge color={s.squeezeScore>=70?"red":"amber"}>{s.squeezeScore}</Badge>
              </div>
              <Badge color={s.routedTo==="options"?"purple":"blue"}>{s.routedTo==="options"?"OPT":"CFD"}</Badge>
            </div>
          )):<p className={`text-xs ${C.td} py-4 text-center`}>Aucun signal</p>}
        </Card>
      </div>

      {positions.length>0&&(
        <Card>
          <h3 className="text-sm font-semibold text-white mb-4">Positions ouvertes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className={`text-xs ${C.td} uppercase tracking-wider border-b ${C.div}`}>
                <th className="text-left py-2 pr-3">Ticker</th><th className="text-left py-2 pr-3">Dir.</th>
                {activeAccount==="options"&&<><th className="text-left py-2 pr-3">Type</th><th className="text-right py-2 pr-3">Strike</th><th className="text-right py-2 pr-3">Exp.</th></>}
                <th className="text-right py-2 pr-3">Entrée</th><th className="text-right py-2 pr-3">Taille</th>
                {activeAccount==="options"&&<><th className="text-right py-2 pr-3">{"\u0394"}</th><th className="text-right py-2 pr-3">{"\u0393"}</th><th className="text-right py-2 pr-3">{"\u0398"}</th><th className="text-right py-2 pr-3">V</th></>}
                <th className="text-right py-2 pr-3">Risque</th><th className="text-right py-2">P&L</th>
              </tr></thead>
              <tbody>{positions.map(p=>(
                <tr key={p.id} className={`border-b ${C.div} hover:bg-gray-800/50`}>
                  <td className="py-2 pr-3 font-medium text-white">{p.ticker}</td>
                  <td className="py-2 pr-3"><Badge color={p.direction==="LONG"?"green":"red"}>{p.direction}</Badge></td>
                  {activeAccount==="options"&&<>
                    <td className="py-2 pr-3"><Badge color={p.optionType==="call"?"green":"red"}>{(p.optionType||"").toUpperCase()}</Badge></td>
                    <td className="py-2 pr-3 text-right text-gray-300">{fmt(p.strike)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{p.expiry||"—"}</td>
                  </>}
                  <td className="py-2 pr-3 text-right text-gray-300">{fmt(p.entry)}</td>
                  <td className="py-2 pr-3 text-right text-gray-300">{activeAccount==="options"?`${p.contracts||p.size}x${p.multiplier||100}`:p.size}</td>
                  {activeAccount==="options"&&<>
                    <td className={`py-2 pr-3 text-right font-mono text-xs ${(p.delta||0)>=0?C.g:C.r}`}>{fmt(p.delta,3)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-gray-400">{fmt(p.gamma,4)}</td>
                    <td className={`py-2 pr-3 text-right font-mono text-xs ${(p.theta||0)<0?C.r:C.g}`}>{fmt(p.theta,2)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-blue-400">{fmt(p.vega,2)}</td>
                  </>}
                  <td className="py-2 pr-3 text-right text-amber-400">{fmt(p.riskAmount,0)}{account.currency}</td>
                  <td className={`py-2 text-right font-medium ${(p.unrealizedPnl||0)>=0?C.g:C.r}`}>{(p.unrealizedPnl||0)>=0?"+":""}{fmt(p.unrealizedPnl||0,0)}{account.currency}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  SQUEEZE SCANNER
// ════════════════════════════════════════════════════════════════════════
function SqueezeScanner({scannerItems,setScannerItems,suggestions,setSuggestions}){
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({ticker:"",shortInterest:"",daysToCover:"",costToBorrow:"",siDelta:"",relativeVolume:"",notes:"",putCallRatio:"",ivRank:"",source:"finviz"});
  const [editId,setEditId]=useState(null);
  const [sortBy,setSortBy]=useState("squeezeScore");
  const [minScore,setMinScore]=useState(0);
  const reset=()=>{setForm({ticker:"",shortInterest:"",daysToCover:"",costToBorrow:"",siDelta:"",relativeVolume:"",notes:"",putCallRatio:"",ivRank:"",source:"finviz"});setAdding(false);setEditId(null);};

  const save=()=>{
    const p={ticker:form.ticker.toUpperCase(),shortInterest:parseFloat(form.shortInterest)||0,daysToCover:parseFloat(form.daysToCover)||0,
      costToBorrow:parseFloat(form.costToBorrow)||0,siDelta:parseFloat(form.siDelta)||0,relativeVolume:parseFloat(form.relativeVolume)||1,
      putCallRatio:parseFloat(form.putCallRatio)||0,ivRank:parseFloat(form.ivRank)||0,notes:form.notes,source:form.source};
    p.squeezeScore=computeSqueezeScore(p);
    p.routedTo=routeSignal(p);
    const item={...p,id:editId||uid(),addedDate:td()};
    if(editId) setScannerItems(prev=>prev.map(s=>s.id===editId?item:s));
    else setScannerItems(prev=>[item,...prev]);
    if(p.squeezeScore>=40){
      const sug={id:uid(),ticker:p.ticker,squeezeScore:p.squeezeScore,routedTo:p.routedTo,ivRank:p.ivRank,
        relativeVolume:p.relativeVolume,shortInterest:p.shortInterest,daysToCover:p.daysToCover,createdAt:td(),status:"pending"};
      setSuggestions(prev=>{const ex=prev.find(s=>s.ticker===p.ticker&&s.status==="pending");return ex?prev.map(s=>s.id===ex.id?sug:s):[sug,...prev];});
    }
    reset();
  };

  const sorted=[...scannerItems].filter(s=>(s.squeezeScore||0)>=minScore).sort((a,b)=>(b[sortBy]||0)-(a[sortBy]||0));
  const scoreBg=s=>s>=70?"bg-red-500/10 border-red-500/20":s>=40?"bg-amber-500/10 border-amber-500/20":"bg-gray-800/50 border-gray-700/30";

  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Flame size={20} className="text-orange-400"/>Short Squeeze Scanner</h2>
        <div className="flex gap-2 items-center">
          <span className={`text-xs ${C.td}`}>Min:</span>
          <input type="range" min="0" max="80" step="10" value={minScore} onChange={e=>setMinScore(Number(e.target.value))} className="w-20 accent-orange-500"/>
          <span className="text-xs text-orange-400 font-mono w-6">{minScore}</span>
          <Sel options={[{value:"squeezeScore",label:"Score"},{value:"shortInterest",label:"SI%"},{value:"daysToCover",label:"DTC"},{value:"costToBorrow",label:"CTB"}]} value={sortBy} onChange={e=>setSortBy(e.target.value)}/>
          <button onClick={()=>{reset();setAdding(true);}} className={`${C.btn} ${C.btnP} flex items-center gap-2`}><Plus size={16}/>Ajouter</button>
        </div>
      </div>

      <div className="bg-gray-800/30 border border-gray-700/40 rounded-lg p-3 text-xs text-gray-400 space-y-1">
        <p><span className="font-semibold text-gray-300">Workflow :</span> Top 200 SI% sur <span className="text-blue-400">Finviz</span> (Short Float &gt; 5%) ou <span className="text-blue-400">TradingView</span> (Screener Short Interest). Saisir ici les candidats qualifiés.</p>
        <p><span className="font-semibold text-gray-300">Routing auto :</span> Score {"\u2265"} 40 {"\u2192"} signal. <span className="text-purple-400">Options</span> si IV Rank &lt; 50. <span className="text-blue-400">CFD</span> si momentum (vol {"\u2265"} 2x) ou IV {"\u2265"} 70.</p>
        <p><span className="font-semibold text-gray-300">Sources :</span> Finviz (primary) {"\u2192"} TradingView (fallback) {"\u2192"} Ortex/Fintel (CTB, SI delta)</p>
      </div>

      {adding&&(
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Input label="Ticker" value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})}/>
            <Input label="Short Interest (%)" type="number" step="0.1" value={form.shortInterest} onChange={e=>setForm({...form,shortInterest:e.target.value})}/>
            <Input label="Days to Cover" type="number" step="0.1" value={form.daysToCover} onChange={e=>setForm({...form,daysToCover:e.target.value})}/>
            <Input label="Cost to Borrow (%)" type="number" step="0.1" value={form.costToBorrow} onChange={e=>setForm({...form,costToBorrow:e.target.value})}/>
            <Input label="SI Delta (%)" type="number" step="0.1" value={form.siDelta} onChange={e=>setForm({...form,siDelta:e.target.value})}/>
            <Input label="Vol. relatif" type="number" step="0.1" value={form.relativeVolume} onChange={e=>setForm({...form,relativeVolume:e.target.value})}/>
            <Input label="Put/Call OI" type="number" step="0.01" value={form.putCallRatio} onChange={e=>setForm({...form,putCallRatio:e.target.value})}/>
            <Input label="IV Rank (0-100)" type="number" value={form.ivRank} onChange={e=>setForm({...form,ivRank:e.target.value})}/>
            <Sel label="Source" options={[{value:"finviz",label:"Finviz"},{value:"tradingview",label:"TradingView"},{value:"ortex",label:"Ortex"},{value:"fintel",label:"Fintel"},{value:"manual",label:"Manuel"}]} value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/>
            <Input label="Notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} className={`${C.btn} ${C.btnP}`}><Save size={14} className="inline mr-1"/>{editId?"Maj":"Ajouter"}</button>
            <button onClick={reset} className={`${C.btn} ${C.btnG}`}>Annuler</button>
          </div>
        </Card>
      )}

      {sorted.length===0?(
        <Card><div className="text-center py-12"><Search size={40} className={`mx-auto ${C.td} mb-3`}/><p className={C.tm}>Scanner vide{minScore>0?` (min ${minScore})`:""}</p></div></Card>
      ):(
        <div className="space-y-3">{sorted.map(item=>(
          <Card key={item.id} className={`group border ${scoreBg(item.squeezeScore)}`}>
            <div className="flex items-center gap-5">
              <ScoreGauge score={item.squeezeScore} label="Score"/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-lg font-bold text-white">{item.ticker}</span>
                  <Badge color={item.squeezeScore>=70?"red":item.squeezeScore>=40?"amber":"gray"}>{item.squeezeScore>=70?"HIGH":item.squeezeScore>=40?"WATCH":"LOW"}</Badge>
                  <Badge color={item.routedTo==="options"?"purple":"blue"}><ArrowRightLeft size={10} className="inline mr-1"/>{item.routedTo==="options"?"\u2192 Options":"\u2192 CFD"}</Badge>
                  {item.source&&<Badge color="gray">{item.source}</Badge>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2">
                  <div><p className={`text-xs ${C.td}`}>SI%</p><p className={`text-sm font-semibold ${item.shortInterest>=20?C.r:item.shortInterest>=10?C.y:"text-gray-300"}`}>{fmt(item.shortInterest,1)}%</p></div>
                  <div><p className={`text-xs ${C.td}`}>DTC</p><p className={`text-sm font-semibold ${item.daysToCover>=5?C.r:"text-gray-300"}`}>{fmt(item.daysToCover,1)}j</p></div>
                  <div><p className={`text-xs ${C.td}`}>CTB</p><p className={`text-sm font-semibold ${item.costToBorrow>=30?C.r:"text-gray-300"}`}>{fmt(item.costToBorrow,1)}%</p></div>
                  <div><p className={`text-xs ${C.td}`}>SI {"\u0394"}</p><p className={`text-sm font-semibold ${item.siDelta>0?C.r:item.siDelta<0?C.g:"text-gray-300"}`}>{item.siDelta>0?"+":""}{fmt(item.siDelta,1)}%</p></div>
                  <div><p className={`text-xs ${C.td}`}>Vol</p><p className={`text-sm font-semibold ${item.relativeVolume>=2?C.b:"text-gray-300"}`}>{fmt(item.relativeVolume,1)}x</p></div>
                </div>
                {item.notes&&<p className={`text-xs ${C.tm} mt-2 italic`}>"{item.notes}"</p>}
              </div>
              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={()=>{setForm({...item,shortInterest:String(item.shortInterest),daysToCover:String(item.daysToCover),costToBorrow:String(item.costToBorrow),siDelta:String(item.siDelta),relativeVolume:String(item.relativeVolume),putCallRatio:String(item.putCallRatio||""),ivRank:String(item.ivRank||""),source:item.source||"finviz"});setEditId(item.id);setAdding(true);}} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white"><Edit3 size={14}/></button>
                <button onClick={()=>setScannerItems(prev=>prev.filter(s=>s.id!==item.id))} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-red-400"><Trash2 size={14}/></button>
              </div>
            </div>
          </Card>
        ))}</div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  SUGGESTION PANEL
// ════════════════════════════════════════════════════════════════════════
function SuggestionPanel({suggestions,setSuggestions,activeAccount}){
  const filtered=suggestions.filter(s=>s.routedTo===activeAccount&&s.status==="pending");
  if(filtered.length===0) return null;
  return(
    <Card className="border-amber-500/20 bg-amber-500/5 mb-6">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Zap size={16} className="text-amber-400"/>Opportunites scanner ({filtered.length})</h3>
      <div className="space-y-2">{filtered.map(s=>(
        <div key={s.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">{s.ticker}</span>
            <Badge color={s.squeezeScore>=70?"red":"amber"}>Score {s.squeezeScore}</Badge>
            <span className={`text-xs ${C.tm}`}>SI {fmt(s.shortInterest,1)}% | DTC {fmt(s.daysToCover,1)} | IV {fmt(s.ivRank,0)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>setSuggestions(p=>p.map(x=>x.id===s.id?{...x,status:"accepted"}:x))} className={`${C.btn} text-xs ${C.btnS}`}>Accepter</button>
            <button onClick={()=>setSuggestions(p=>p.map(x=>x.id===s.id?{...x,status:"dismissed"}:x))} className={`${C.btn} text-xs ${C.btnG}`}>Ignorer</button>
          </div>
        </div>
      ))}</div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  TECHNICAL ANALYSIS
// ════════════════════════════════════════════════════════════════════════
function TechnicalAnalysis(){
  const [ticker,setTicker]=useState("");
  const [pricesRaw,setPricesRaw]=useState("");
  const [analysis,setAnalysis]=useState(null);

  const run=()=>{
    const prices=pricesRaw.split(/[\s,;]+/).map(Number).filter(n=>!isNaN(n)&&n>0);
    if(prices.length<26){setAnalysis({error:"Min 26 prix"});return;}
    const current=prices[prices.length-1];
    const sma20=computeSMA(prices,20),sma50=computeSMA(prices,50),sma200=computeSMA(prices,200);
    const macd=computeMACD(prices);
    const bb=computeBollinger(prices,20,2);
    const bbWidths=[];
    for(let i=20;i<=prices.length;i++){const sl=prices.slice(i-20,i);const m=sl.reduce((s,p)=>s+p,0)/sl.length;const std=Math.sqrt(sl.reduce((s,p)=>s+(p-m)**2,0)/sl.length);bbWidths.push(((m+2*std)-(m-2*std))/m);}
    const squeeze=detectBBSqueeze(bbWidths);
    const chartLen=Math.min(50,prices.length);const chartData=[];
    for(let i=prices.length-chartLen;i<prices.length;i++){const p=prices.slice(0,i+1);const bbd=computeBollinger(p,20,2);
      chartData.push({idx:i-(prices.length-chartLen),price:prices[i],sma20:computeSMA(p,20),sma50:computeSMA(p,50),bbUpper:bbd.upper,bbLower:bbd.lower});}
    const signals=[];let smaTrend="NEUTRE";
    if(sma20&&sma50){if(current>sma20&&sma20>sma50){smaTrend="LONG";signals.push({text:"Prix > SMA20 > SMA50 — haussier",type:"bullish"});}
      else if(current<sma20&&sma20<sma50){smaTrend="SHORT";signals.push({text:"Prix < SMA20 < SMA50 — baissier",type:"bearish"});}
      else signals.push({text:"SMAs en croisement",type:"neutral"});}
    if(sma200) signals.push(current>sma200?{text:`Au-dessus SMA200 (${fmt(sma200)})`,type:"bullish"}:{text:"Sous SMA200",type:"bearish"});
    if(macd.histogram!=null){if(macd.histogram>0&&macd.macd>0) signals.push({text:"MACD positif — momentum haussier",type:"bullish"});
      else if(macd.histogram<0&&macd.macd<0) signals.push({text:"MACD negatif — baissier",type:"bearish"});
      else signals.push({text:"MACD divergence",type:"neutral"});}
    if(bb.pctB!=null){if(bb.pctB<=0.05) signals.push({text:`%B ${fmt(bb.pctB,2)} — survente`,type:"bullish"});
      else if(bb.pctB>=0.95) signals.push({text:`%B ${fmt(bb.pctB,2)} — surachat`,type:"bearish"});}
    if(squeeze.isSqueeze) signals.push({text:`BB SQUEEZE — P${fmt(squeeze.percentile,0)} — breakout imminent`,type:"alert"});
    let volRegime="normal",instrReco="CFD ou options";
    if(squeeze.isSqueeze){volRegime="compression";instrReco="Options (straddle — vol basse = prime cheap)";}
    else if(squeeze.percentile>=80){volRegime="expansion";instrReco="CFD (theta options trop cher)";}
    setAnalysis({current,sma20,sma50,sma200,macd,bb,squeeze,chartData,signals,volRegime,instrReco});
  };

  return(
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white flex items-center gap-2"><BarChart3 size={20} className={C.b}/>Analyse Technique</h2>
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Input label="Ticker" value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())}/>
          <div className="md:col-span-2"><label className={`block text-xs ${C.tm} mb-1.5`}>Prix (close, virgule)</label>
            <textarea className={`${C.input} w-full h-10 resize-none`} value={pricesRaw} onChange={e=>setPricesRaw(e.target.value)}/></div>
          <button onClick={run} className={`${C.btn} ${C.btnP} flex items-center gap-2`}><Zap size={16}/>Analyser</button>
        </div>
        <p className={`text-xs ${C.td} mt-2`}>TradingView Export / Finviz. Min 26, ideal 120+.</p>
      </Card>
      {analysis?.error&&<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">{analysis.error}</div>}
      {analysis&&!analysis.error&&(<>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Card><p className={`text-xs ${C.td}`}>Prix</p><p className="text-2xl font-bold text-white">{fmt(analysis.current)}</p></Card>
          <Card><p className={`text-xs ${C.td}`}>MACD</p><p className={`text-2xl font-bold ${(analysis.macd.histogram||0)>0?C.g:C.r}`}>{fmt(analysis.macd.macd,3)}</p></Card>
          <Card><p className={`text-xs ${C.td}`}>%B</p><p className={`text-2xl font-bold ${(analysis.bb.pctB||0)>=0.8?C.r:(analysis.bb.pctB||0)<=0.2?C.g:"text-white"}`}>{fmt(analysis.bb.pctB,2)}</p></Card>
          <Card><p className={`text-xs ${C.td}`}>BB Width</p><p className={`text-2xl font-bold ${analysis.squeeze.isSqueeze?C.r:"text-white"}`}>{fmt(analysis.bb.width,4)}</p><p className={`text-xs ${analysis.squeeze.isSqueeze?"text-red-400":C.tm}`}>P{fmt(analysis.squeeze.percentile,0)}{analysis.squeeze.isSqueeze?" SQUEEZE":""}</p></Card>
          <Card><p className={`text-xs ${C.td}`}>Regime</p><p className={`text-lg font-bold ${analysis.volRegime==="compression"?C.r:C.b}`}>{analysis.volRegime==="compression"?"Compression":"Normal"}</p><p className={`text-xs ${C.tm} mt-1`}>{analysis.instrReco}</p></Card>
        </div>
        {analysis.chartData.length>0&&(
          <Card>
            <h3 className="text-sm font-semibold text-white mb-3">{ticker||"—"} — Prix + SMA + Bollinger</h3>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={analysis.chartData} margin={{top:10,right:10,left:10,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937"/>
                <XAxis dataKey="idx" tick={false} axisLine={false}/>
                <YAxis domain={["auto","auto"]} tick={{fill:"#6b7280",fontSize:11}} axisLine={false}/>
                <Tooltip contentStyle={{backgroundColor:"#111827",border:"1px solid #374151",borderRadius:8}}/>
                <Line type="monotone" dataKey="bbUpper" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" dot={false}/>
                <Line type="monotone" dataKey="bbLower" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" dot={false}/>
                <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1.5} dot={false}/>
                <Line type="monotone" dataKey="sma50" stroke="#a855f7" strokeWidth={1.5} dot={false}/>
                <Line type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 justify-center text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block"></span>Prix</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block"></span>SMA20</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-500 inline-block"></span>SMA50</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span>Bollinger</span>
            </div>
          </Card>
        )}
        <Card>
          <h3 className="text-sm font-semibold text-white mb-3">Signaux</h3>
          <div className="space-y-2">{analysis.signals.map((s,i)=>(
            <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg ${s.type==="bullish"?"bg-emerald-500/10 border border-emerald-500/20":s.type==="bearish"?"bg-red-500/10 border border-red-500/20":s.type==="alert"?"bg-orange-500/10 border border-orange-500/20":"bg-gray-800/50 border border-gray-700/30"}`}>
              <span className="mt-0.5">{s.type==="bullish"?<ArrowUpRight size={14} className={C.g}/>:s.type==="bearish"?<ArrowDownRight size={14} className={C.r}/>:s.type==="alert"?<AlertTriangle size={14} className="text-orange-400"/>:<ChevronRight size={14} className="text-gray-400"/>}</span>
              <p className="text-sm text-gray-300">{s.text}</p>
            </div>
          ))}</div>
        </Card>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  POSITION SIZER (dual-mode CFD / Options)
// ════════════════════════════════════════════════════════════════════════
function PositionSizer({activeAccount,account,onTrade}){
  const isOpt=activeAccount==="options";
  const [f,setF]=useState({ticker:"",direction:"LONG",entry:"",stop:"",target:"",riskPct:String(account.maxRiskPerTrade),customSize:"",
    optionType:"call",strike:"",iv:"",underlyingPrice:"",multiplier:"100",dte:"30",expiry:""});

  const entry=parseFloat(f.entry)||0,stop=parseFloat(f.stop)||0,target=parseFloat(f.target)||0;
  const riskPct=parseFloat(f.riskPct)||account.maxRiskPerTrade;
  const riskPerUnit=Math.abs(entry-stop);
  const riskAmount=account.accountSize*(riskPct/100);
  const rewardPerUnit=Math.abs(target-entry);
  const rr=riskPerUnit>0?rewardPerUnit/riskPerUnit:0;

  const strike=parseFloat(f.strike)||0,iv=(parseFloat(f.iv)||30)/100,S=parseFloat(f.underlyingPrice)||0;
  const dte=parseInt(f.dte)||30,T=dte/365,mult=parseInt(f.multiplier)||100;
  const greeks=isOpt&&S>0&&strike>0?blackScholes(S,strike,T,0.04,iv,f.optionType):{price:0,delta:0,gamma:0,theta:0,vega:0};

  let optimalSize;
  if(isOpt){const ppc=greeks.price*mult;optimalSize=ppc>0?Math.floor(riskAmount/ppc):0;}
  else{optimalSize=riskPerUnit>0?Math.floor(riskAmount/riskPerUnit):0;}
  const sizeUsed=f.customSize?parseInt(f.customSize):optimalSize;
  const actualRisk=isOpt?sizeUsed*greeks.price*mult:sizeUsed*riskPerUnit;
  const actualRiskPct=(actualRisk/account.accountSize)*100;
  const actualGain=isOpt?sizeUsed*rewardPerUnit*mult*Math.abs(greeks.delta):sizeUsed*rewardPerUnit;
  const isValid=isOpt?(S>0&&strike>0&&greeks.price>0):(entry>0&&stop>0&&riskPerUnit>0);

  const logTrade=()=>{
    if(!isValid||!f.ticker)return;
    onTrade({id:uid(),ticker:f.ticker,direction:f.direction,entry:isOpt?greeks.price:entry,stop,target,
      size:isOpt?undefined:sizeUsed,contracts:isOpt?sizeUsed:undefined,multiplier:isOpt?mult:undefined,
      riskAmount:actualRisk,rr,date:td(),time:nt(),status:"open",pnl:0,unrealizedPnl:0,
      ...(isOpt?{optionType:f.optionType,strike,expiry:f.expiry,iv:parseFloat(f.iv),dte,
        delta:greeks.delta,gamma:greeks.gamma,theta:greeks.theta,vega:greeks.vega,currentPrice:greeks.price}:{})});
  };

  return(
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white">{isOpt?"Options Sizer + Grecques":"Position Sizer CFD"}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <h3 className="text-sm font-semibold text-white mb-4">Parametres</h3>
          <div className="space-y-3">
            <Input label="Ticker" value={f.ticker} onChange={e=>setF({...f,ticker:e.target.value.toUpperCase()})}/>
            <Sel label="Direction" options={[{value:"LONG",label:"LONG"},{value:"SHORT",label:"SHORT"}]} value={f.direction} onChange={e=>setF({...f,direction:e.target.value})}/>
            {isOpt?(<>
              <Sel label="Type" options={[{value:"call",label:"CALL"},{value:"put",label:"PUT"}]} value={f.optionType} onChange={e=>setF({...f,optionType:e.target.value})}/>
              <Input label="Sous-jacent" type="number" step="any" value={f.underlyingPrice} onChange={e=>setF({...f,underlyingPrice:e.target.value})}/>
              <Input label="Strike" type="number" step="any" value={f.strike} onChange={e=>setF({...f,strike:e.target.value})}/>
              <Input label="IV (%)" type="number" step="0.1" value={f.iv} onChange={e=>setF({...f,iv:e.target.value})}/>
              <Input label="DTE" type="number" value={f.dte} onChange={e=>setF({...f,dte:e.target.value})}/>
              <Input label="Expiry" type="date" value={f.expiry} onChange={e=>setF({...f,expiry:e.target.value})}/>
              <Input label="Multiplicateur" type="number" value={f.multiplier} onChange={e=>setF({...f,multiplier:e.target.value})}/>
            </>):(<>
              <Input label="Entree" type="number" step="any" value={f.entry} onChange={e=>setF({...f,entry:e.target.value})}/>
              <Input label="Stop" type="number" step="any" value={f.stop} onChange={e=>setF({...f,stop:e.target.value})}/>
              <Input label="Target" type="number" step="any" value={f.target} onChange={e=>setF({...f,target:e.target.value})}/>
            </>)}
            <Input label={`Risque % (max ${account.maxRiskPerTrade}%)`} type="number" step="0.1" value={f.riskPct} onChange={e=>setF({...f,riskPct:e.target.value})}/>
            <Input label="Taille custom" type="number" placeholder={`Optimal: ${optimalSize}`} value={f.customSize} onChange={e=>setF({...f,customSize:e.target.value})}/>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          {isValid?(<div className="space-y-6">
            {isOpt&&<div>
              <h4 className={`text-xs font-semibold ${C.tm} uppercase tracking-wider mb-3`}>Grecques / contrat</h4>
              <div className="grid grid-cols-5 gap-3">
                <div className="bg-gray-800 rounded-lg p-3 text-center"><p className={`text-xs ${C.td}`}>Prix theo.</p><p className="text-xl font-bold text-white">{fmt(greeks.price,2)}</p></div>
                <GreekBadge label="Delta" value={greeks.delta}/>
                <GreekBadge label="Gamma" value={greeks.gamma}/>
                <GreekBadge label="Theta/j" value={greeks.theta} warn={greeks.theta<-0.5}/>
                <GreekBadge label="Vega" value={greeks.vega}/>
              </div>
            </div>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800 rounded-lg p-4 text-center"><p className={`text-xs ${C.tm}`}>{isOpt?"Contrats":"Taille"}</p><p className="text-3xl font-bold text-white mt-1">{optimalSize}</p></div>
              <div className="bg-gray-800 rounded-lg p-4 text-center"><p className={`text-xs ${C.tm}`}>Risque</p><p className={`text-3xl font-bold ${actualRiskPct>account.maxRiskPerTrade?C.r:C.y}`}>{fmt(actualRisk,0)}{account.currency}</p><p className={`text-xs ${C.td}`}>{fmt(actualRiskPct,2)}%</p></div>
              <div className="bg-gray-800 rounded-lg p-4 text-center"><p className={`text-xs ${C.tm}`}>Gain pot.</p><p className={`text-3xl font-bold ${C.g}`}>{fmt(actualGain,0)}{account.currency}</p></div>
              <div className="bg-gray-800 rounded-lg p-4 text-center"><p className={`text-xs ${C.tm}`}>R:R</p><p className={`text-3xl font-bold ${rr>=2?C.g:rr>=1.5?C.y:C.r}`}>1:{fmt(isOpt&&actualRisk>0?actualGain/actualRisk:rr,1)}</p></div>
            </div>
            {isOpt&&sizeUsed>0&&<div>
              <h4 className={`text-xs font-semibold ${C.tm} uppercase mb-3`}>Grecques position ({sizeUsed}x{mult})</h4>
              <div className="grid grid-cols-4 gap-3">
                <GreekBadge label={"\u0394 pos"} value={greeks.delta*sizeUsed*mult*(f.direction==="SHORT"?-1:1)} warn={Math.abs(greeks.delta*sizeUsed*mult)>50}/>
                <GreekBadge label={"\u0393 pos"} value={greeks.gamma*sizeUsed*mult}/>
                <GreekBadge label={"\u0398/jour"} value={greeks.theta*sizeUsed*mult*(f.direction==="SHORT"?-1:1)} warn={greeks.theta*sizeUsed*mult<-50}/>
                <GreekBadge label="V pos" value={greeks.vega*sizeUsed*mult}/>
              </div>
            </div>}
            {f.ticker&&<button onClick={logTrade} className={`${C.btn} ${isOpt?C.btnOpt:C.btnS} flex items-center gap-2`}><Zap size={16}/>Ouvrir</button>}
            {actualRiskPct>account.maxRiskPerTrade&&<div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3"><AlertTriangle size={16}/>Risque depasse la limite</div>}
          </div>):(
            <div className="text-center py-16"><Calculator size={40} className={`mx-auto ${C.td} mb-3`}/><p className={C.tm}>{isOpt?"Sous-jacent, strike, IV":"Entree et stop"}</p></div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  TRADE LOG
// ════════════════════════════════════════════════════════════════════════
function TradeLog({trades,setTrades,account,activeAccount}){
  const isOpt=activeAccount==="options";
  const [filter,setFilter]=useState("all");
  const [closingId,setClosingId]=useState(null);
  const [closePrice,setClosePrice]=useState("");
  const [closeNotes,setCloseNotes]=useState("");
  const closeTrade=id=>{const price=parseFloat(closePrice);if(!price)return;
    setTrades(prev=>prev.map(t=>{if(t.id!==id)return t;
      const pnl=isOpt?(t.direction==="LONG"?(price-t.entry):(t.entry-price))*(t.contracts||t.size||1)*(t.multiplier||100)
        :t.direction==="LONG"?(price-t.entry)*t.size:(t.entry-price)*t.size;
      return {...t,status:"closed",exitPrice:price,pnl,closeDate:td(),closeNotes};}));
    setClosingId(null);setClosePrice("");setCloseNotes("");};
  const filtered=trades.filter(t=>filter==="all"||t.status===filter);
  const stats=useMemo(()=>{const cl=trades.filter(t=>t.status==="closed");const w=cl.filter(t=>t.pnl>0),l=cl.filter(t=>t.pnl<=0);
    return {total:cl.length,wins:w.length,losses:l.length,wr:cl.length?w.length/cl.length:0,
      tot:cl.reduce((s,t)=>s+t.pnl,0),avgW:w.length?w.reduce((s,t)=>s+t.pnl,0)/w.length:0,avgL:l.length?l.reduce((s,t)=>s+t.pnl,0)/l.length:0};},[trades]);

  return(
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Journal — {isOpt?"Options":"CFD"}</h2>
        <div className="flex gap-2">{["all","open","closed"].map(s=><button key={s} onClick={()=>setFilter(s)} className={`${C.btn} text-xs ${filter===s?C.btnP:C.btnG}`}>{s==="all"?"Tous":s==="open"?"Ouvertes":"Clotures"}</button>)}</div>
      </div>
      {stats.total>0&&<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[{l:"Win Rate",v:`${(stats.wr*100).toFixed(0)}%`,s:`${stats.wins}W/${stats.losses}L`},
          {l:"P&L Total",v:`${stats.tot>=0?"+":""}${fmt(stats.tot,0)}${account.currency}`,c:stats.tot>=0},
          {l:"Gain moy.",v:`+${fmt(stats.avgW,0)}${account.currency}`},{l:"Perte moy.",v:`${fmt(stats.avgL,0)}${account.currency}`},
          {l:"Esperance",v:`${fmt((stats.wr)*stats.avgW+(1-stats.wr)*stats.avgL,0)}${account.currency}`},
        ].map((s,i)=><div key={i} className="bg-gray-800/50 rounded-lg p-3 text-center">
          <p className={`text-xs ${C.td}`}>{s.l}</p><p className={`text-lg font-bold ${s.c!==undefined?(s.c?C.g:C.r):"text-white"}`}>{s.v}</p>
          {s.s&&<p className={`text-xs ${C.td}`}>{s.s}</p>}</div>)}
      </div>}
      {filtered.length===0?<Card><div className="text-center py-12"><BookOpen size={40} className={`mx-auto ${C.td} mb-3`}/><p className={C.tm}>Aucun trade</p></div></Card>:(
        <div className="space-y-2">{filtered.map(t=>(
          <Card key={t.id}>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white">{t.ticker}</span>
                  <Badge color={t.direction==="LONG"?"green":"red"}>{t.direction}</Badge>
                  {isOpt&&t.optionType&&<Badge color={t.optionType==="call"?"green":"red"}>{t.optionType.toUpperCase()}</Badge>}
                  {isOpt&&t.strike&&<Badge color="gray">K{fmt(t.strike)}</Badge>}
                  {isOpt&&t.expiry&&<Badge color="gray">{t.expiry}</Badge>}
                  <Badge color={t.status==="open"?"blue":t.pnl>=0?"green":"red"}>{t.status==="open"?"OUVERT":"CLOTURE"}</Badge>
                  <span className={`text-xs ${C.td}`}>{t.date}</span>
                </div>
                <div className="flex gap-4 mt-1 text-sm flex-wrap">
                  <span className={C.tm}>E: {fmt(t.entry,isOpt?2:2)}</span>
                  <span className={C.tm}>x{isOpt?`${t.contracts||t.size}x${t.multiplier||100}`:t.size}</span>
                  {isOpt&&t.delta!=null&&<span className={C.tm}>{"\u0394"}{fmt(t.delta,3)}</span>}
                  {isOpt&&t.theta!=null&&<span className={C.tm}>{"\u0398"}{fmt(t.theta,3)}</span>}
                  {t.exitPrice&&<span className={C.tm}>Sortie: {fmt(t.exitPrice)}</span>}
                </div>
              </div>
              <div className="text-right">
                {t.status==="closed"&&<p className={`text-lg font-bold ${t.pnl>=0?C.g:C.r}`}>{t.pnl>=0?"+":""}{fmt(t.pnl,0)}{account.currency}</p>}
                {t.status==="open"&&closingId!==t.id&&<button onClick={()=>setClosingId(t.id)} className={`${C.btn} ${C.btnG} text-xs`}>Cloturer</button>}
              </div>
            </div>
            {closingId===t.id&&<div className="mt-3 pt-3 border-t border-gray-800 flex gap-3 items-end">
              <Input label="Prix sortie" type="number" step="any" value={closePrice} onChange={e=>setClosePrice(e.target.value)}/>
              <Input label="Notes" value={closeNotes} onChange={e=>setCloseNotes(e.target.value)}/>
              <button onClick={()=>closeTrade(t.id)} className={`${C.btn} ${C.btnS}`}>OK</button>
              <button onClick={()=>setClosingId(null)} className={`${C.btn} ${C.btnG}`}>X</button>
            </div>}
          </Card>
        ))}</div>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  WATCHLIST + EVENTS + CHECKLIST + SETTINGS (compact)
// ════════════════════════════════════════════════════════════════════════
function Watchlist({watchlist,setWatchlist}){
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({ticker:"",direction:"LONG",entry:"",stop:"",target:"",notes:"",timeframe:"D",setup:"",starred:false,catalyst:"",account:"cfd"});
  const [editId,setEditId]=useState(null);
  const reset=()=>{setForm({ticker:"",direction:"LONG",entry:"",stop:"",target:"",notes:"",timeframe:"D",setup:"",starred:false,catalyst:"",account:"cfd"});setAdding(false);setEditId(null);};
  const save=()=>{const e=parseFloat(form.entry)||0,s=parseFloat(form.stop)||0,t=parseFloat(form.target)||0;
    const rpu=Math.abs(e-s),rr=rpu>0?Math.abs(t-e)/rpu:0;
    const item={...form,id:editId||uid(),entry:e,stop:s,target:t,rr,addedDate:td()};
    if(editId)setWatchlist(p=>p.map(w=>w.id===editId?item:w));else setWatchlist(p=>[item,...p]);reset();};
  const sorted=[...watchlist].sort((a,b)=>(b.starred?1:0)-(a.starred?1:0));
  const setups=["Breakout","Pullback","Reversal","Momentum","Short Squeeze","BB Squeeze","Mean Reversion"];
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Watchlist</h2>
        <button onClick={()=>{reset();setAdding(true);}} className={`${C.btn} ${C.btnP} flex items-center gap-2`}><Plus size={16}/>Ajouter</button>
      </div>
      {adding&&<Card><div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Input label="Ticker" value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})}/>
        <Sel label="Compte" options={[{value:"cfd",label:"CFD"},{value:"options",label:"Options"}]} value={form.account} onChange={e=>setForm({...form,account:e.target.value})}/>
        <Sel label="Dir." options={[{value:"LONG",label:"LONG"},{value:"SHORT",label:"SHORT"}]} value={form.direction} onChange={e=>setForm({...form,direction:e.target.value})}/>
        <Sel label="Setup" options={[{value:"",label:"—"},...setups.map(s=>({value:s,label:s}))]} value={form.setup} onChange={e=>setForm({...form,setup:e.target.value})}/>
        <Input label="Catalyseur" value={form.catalyst} onChange={e=>setForm({...form,catalyst:e.target.value})}/>
        <Input label="Entree" type="number" step="any" value={form.entry} onChange={e=>setForm({...form,entry:e.target.value})}/>
        <Input label="Stop" type="number" step="any" value={form.stop} onChange={e=>setForm({...form,stop:e.target.value})}/>
        <Input label="Target" type="number" step="any" value={form.target} onChange={e=>setForm({...form,target:e.target.value})}/>
        <div className="md:col-span-2"><Input label="These" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
      </div><div className="flex gap-2 mt-4"><button onClick={save} className={`${C.btn} ${C.btnP}`}>{editId?"Maj":"Ajouter"}</button><button onClick={reset} className={`${C.btn} ${C.btnG}`}>Annuler</button></div></Card>}
      {sorted.length===0?<Card><div className="text-center py-8"><Target size={32} className={`mx-auto ${C.td} mb-2`}/><p className={C.tm}>Vide</p></div></Card>:(
        <div className="space-y-2">{sorted.map(item=>(
          <Card key={item.id} className="group"><div className="flex items-start gap-3">
            <button onClick={()=>setWatchlist(p=>p.map(w=>w.id===item.id?{...w,starred:!w.starred}:w))} className="mt-1">{item.starred?<Star size={16} className="text-amber-400 fill-amber-400"/>:<StarOff size={16} className={C.td}/>}</button>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-white">{item.ticker}</span>
                <Badge color={item.direction==="LONG"?"green":"red"}>{item.direction}</Badge>
                <Badge color={item.account==="options"?"purple":"blue"}>{item.account==="options"?"OPT":"CFD"}</Badge>
                {item.setup&&<Badge color="amber">{item.setup}</Badge>}
                {item.catalyst&&<Badge color="pink">{item.catalyst}</Badge>}
                <span className={`text-xs ${item.rr>=2?C.g:item.rr>=1.5?C.y:C.r}`}>1:{fmt(item.rr,1)}</span>
              </div>
              <div className="flex gap-4 mt-1 text-sm"><span className={C.tm}>E:{fmt(item.entry)}</span><span className={C.tm}>SL:{fmt(item.stop)}</span><span className={C.tm}>TP:{fmt(item.target)}</span></div>
              {item.notes&&<p className={`text-xs ${C.tm} mt-1 italic`}>{item.notes}</p>}
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
              <button onClick={()=>{setForm({...item,entry:String(item.entry),stop:String(item.stop),target:String(item.target)});setEditId(item.id);setAdding(true);}} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white"><Edit3 size={14}/></button>
              <button onClick={()=>setWatchlist(p=>p.filter(w=>w.id!==item.id))} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-red-400"><Trash2 size={14}/></button>
            </div>
          </div></Card>
        ))}</div>)}
    </div>
  );
}

function EventCalendar({events,setEvents}){
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({date:td(),time:"14:30",title:"",impact:"medium",type:"macro",notes:"",ticker:""});
  const [editId,setEditId]=useState(null);
  const reset=()=>{setForm({date:td(),time:"14:30",title:"",impact:"medium",type:"macro",notes:"",ticker:""});setAdding(false);setEditId(null);};
  const save=()=>{if(editId)setEvents(p=>p.map(e=>e.id===editId?{...form,id:editId}:e));else setEvents(p=>[{...form,id:uid()},...p]);reset();};
  const impC={critical:"critical",high:"red",medium:"amber",low:"gray"};
  const typeL={macro:"Macro",earnings:"Earnings",sector:"Secteur",custom:"Perso"};
  const typeC={macro:"blue",earnings:"purple",sector:"cyan",custom:"gray"};
  const grouped=[...events].sort((a,b)=>a.date.localeCompare(b.date)).reduce((a,e)=>{(a[e.date]=a[e.date]||[]).push(e);return a;},{});
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Calendar size={20} className={C.b}/>Catalyseurs</h2>
        <button onClick={()=>{reset();setAdding(true);}} className={`${C.btn} ${C.btnP} flex items-center gap-2`}><Plus size={16}/>Ajouter</button>
      </div>
      {adding&&<Card><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Input label="Date" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
        <Input label="Heure" type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/>
        <Input label="Titre" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
        <Input label="Ticker" value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})}/>
        <Sel label="Impact" options={[{value:"critical",label:"Critique"},{value:"high",label:"Eleve"},{value:"medium",label:"Moyen"},{value:"low",label:"Faible"}]} value={form.impact} onChange={e=>setForm({...form,impact:e.target.value})}/>
        <Sel label="Type" options={Object.entries(typeL).map(([k,v])=>({value:k,label:v}))} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}/>
        <div className="md:col-span-2"><Input label="Notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
      </div><div className="flex gap-2 mt-4"><button onClick={save} className={`${C.btn} ${C.btnP}`}>{editId?"Maj":"Ajouter"}</button><button onClick={reset} className={`${C.btn} ${C.btnG}`}>Annuler</button></div></Card>}
      {Object.entries(grouped).map(([date,evts])=>{const isT=date===td();return(
        <div key={date}><p className={`text-sm font-semibold mb-2 ${isT?"text-blue-400":"text-gray-400"}`}>{new Date(date+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}{isT&&<Badge color="blue">Aujourd'hui</Badge>}</p>
        <div className="space-y-2 ml-4">{evts.map(ev=>(
          <div key={ev.id} className="group flex items-start gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700">
            <span className={`text-sm font-mono ${C.tm} w-12`}>{ev.time}</span>
            <div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium text-white">{ev.title}</span><Badge color={impC[ev.impact]}>{ev.impact}</Badge><Badge color={typeC[ev.type]}>{typeL[ev.type]}</Badge>{ev.ticker&&<Badge color="gray">{ev.ticker}</Badge>}</div>
              {ev.notes&&<p className={`text-xs ${C.tm} mt-1 italic`}>{ev.notes}</p>}</div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
              <button onClick={()=>{setForm(ev);setEditId(ev.id);setAdding(true);}} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white"><Edit3 size={14}/></button>
              <button onClick={()=>setEvents(p=>p.filter(e=>e.id!==ev.id))} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-red-400"><Trash2 size={14}/></button>
            </div>
          </div>))}</div></div>);
      })}
    </div>
  );
}

function MorningChecklist({checklist,setChecklist}){
  const [newItem,setNewItem]=useState("");const [mental,setMental]=useState(7);const [bias,setBias]=useState("neutre");const [notes,setNotes]=useState("");
  const done=checklist.filter(c=>c.done).length;const prog=checklist.length?(done/checklist.length)*100:0;
  const cats={macro:"Macro",market:"Marche",risk:"Risque",setups:"Setups",review:"Revue",custom:"Perso",squeeze:"Squeeze",technical:"Technique"};
  const catC={macro:"blue",market:"purple",risk:"amber",setups:"green",review:"gray",custom:"gray",squeeze:"red",technical:"cyan"};
  return(
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-white">Checklist</h2><Badge color={prog===100?"green":"amber"}>{done}/{checklist.length}</Badge></div>
      <div className="w-full bg-gray-800 rounded-full h-2"><div className={`h-2 rounded-full transition-all ${prog===100?"bg-emerald-500":"bg-blue-500"}`} style={{width:`${prog}%`}}/></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {checklist.map(item=>(
            <div key={item.id} onClick={()=>setChecklist(p=>p.map(c=>c.id===item.id?{...c,done:!c.done}:c))}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${item.done?"bg-gray-800/30":"bg-gray-900 border border-gray-800 hover:border-gray-700"}`}>
              {item.done?<CheckCircle2 size={20} className="text-emerald-500"/>:<Circle size={20} className="text-gray-600"/>}
              <span className={`flex-1 text-sm ${item.done?"text-gray-500 line-through":"text-gray-300"}`}>{item.text}</span>
              <Badge color={catC[item.category]}>{cats[item.category]}</Badge>
            </div>
          ))}
          <div className="flex gap-2"><input className={`${C.input} flex-1`} placeholder="Ajouter..." value={newItem}
            onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newItem.trim()){setChecklist(p=>[...p,{id:uid(),text:newItem,done:false,category:"custom"}]);setNewItem("");}}}/>
            <button onClick={()=>{if(newItem.trim()){setChecklist(p=>[...p,{id:uid(),text:newItem,done:false,category:"custom"}]);setNewItem("");}}} className={`${C.btn} ${C.btnG}`}><Plus size={16}/></button></div>
        </div>
        <div className="space-y-4">
          <Card><h3 className="text-sm font-semibold text-white mb-3">Session</h3>
            <div className="space-y-3">
              <div><label className={`block text-xs ${C.tm} mb-1.5`}>Biais</label><div className="flex gap-2">{["bull","neutre","bear"].map(b=>(
                <button key={b} onClick={()=>setBias(b)} className={`${C.btn} flex-1 text-xs ${bias===b?(b==="bull"?"bg-emerald-600 text-white":b==="bear"?"bg-red-600 text-white":"bg-gray-600 text-white"):C.btnG}`}>{b==="bull"?"Bull":b==="bear"?"Bear":"Neutre"}</button>
              ))}</div></div>
              <div><label className={`block text-xs ${C.tm} mb-1.5`}>Mental</label><div className="flex items-center gap-3">
                <input type="range" min="1" max="10" value={mental} onChange={e=>setMental(Number(e.target.value))} className="flex-1 accent-blue-500"/>
                <span className={`text-lg font-bold ${mental>=7?C.g:mental>=5?C.y:C.r}`}>{mental}</span></div>
                {mental<5&&<p className="text-xs text-red-400 mt-1"><AlertTriangle size={12} className="inline mr-1"/>Reduire taille</p>}</div>
            </div>
          </Card>
          <Card><h3 className="text-sm font-semibold text-white mb-3">Notes</h3>
            <textarea className={`${C.input} w-full h-32 resize-none`} value={notes} onChange={e=>setNotes(e.target.value)}/></Card>
        </div>
      </div>
    </div>
  );
}

function Settings({accounts,setAccounts}){
  const upd=(a,k,v)=>setAccounts(p=>({...p,[a]:{...p[a],[k]:v}}));
  return(
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-lg font-bold text-white">Parametres</h2>
      {["cfd","options"].map(a=>(
        <Card key={a}><h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          {a==="cfd"?<BarChart3 size={16} className={C.b}/>:<Sigma size={16} className={C.p}/>}{accounts[a].name}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Input label="Taille compte" type="number" value={accounts[a].accountSize} onChange={e=>upd(a,"accountSize",Number(e.target.value))}/>
            <Input label="Risque max (%)" type="number" step="0.1" value={accounts[a].maxRiskPerTrade} onChange={e=>upd(a,"maxRiskPerTrade",Number(e.target.value))}/>
            <Input label="Daily loss max (%)" type="number" step="0.5" value={accounts[a].maxDailyLoss} onChange={e=>upd(a,"maxDailyLoss",Number(e.target.value))}/>
            <Input label="Max positions" type="number" value={accounts[a].maxOpenPositions} onChange={e=>upd(a,"maxOpenPositions",Number(e.target.value))}/>
            <Input label="Risque corr. max (%)" type="number" step="0.5" value={accounts[a].maxCorrelatedRisk} onChange={e=>upd(a,"maxCorrelatedRisk",Number(e.target.value))}/>
            <Sel label="Devise" options={[{value:"\u20ac",label:"EUR"},{value:"$",label:"USD"}]} value={accounts[a].currency} onChange={e=>upd(a,"currency",e.target.value)}/>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ════════════════════════════════════════════════════════════════════════
const tabs=[
  {id:"dashboard",label:"Dashboard",icon:BarChart3},{id:"checklist",label:"Checklist",icon:ListChecks},
  {id:"scanner",label:"Squeeze",icon:Flame},{id:"technical",label:"Technique",icon:Activity},
  {id:"events",label:"Catalyseurs",icon:Calendar},{id:"watchlist",label:"Watchlist",icon:Target},
  {id:"sizer",label:"Sizing",icon:Calculator},{id:"log",label:"Journal",icon:BookOpen},
  {id:"settings",label:"Config",icon:SlidersHorizontal},
];

export default function App(){
  const [tab,setTab]=useState("dashboard");
  const [activeAccount,setActiveAccount]=useState("cfd");
  const [accounts,setAccounts]=useState(defaultAccounts);
  const [cfdTrades,setCfdTrades]=useState([]);
  const [optTrades,setOptTrades]=useState([]);
  const [watchlist,setWatchlist]=useState([]);
  const [checklist,setChecklist]=useState(defaultChecklist);
  const [scannerItems,setScannerItems]=useState([]);
  const [events,setEvents]=useState(defaultEvents);
  const [suggestions,setSuggestions]=useState([]);

  const trades=activeAccount==="cfd"?cfdTrades:optTrades;
  const setTrades=activeAccount==="cfd"?setCfdTrades:setOptTrades;
  const positions=trades.filter(t=>t.status==="open");
  const account=accounts[activeAccount];
  const addTrade=trade=>(activeAccount==="cfd"?setCfdTrades:setOptTrades)(p=>[trade,...p]);

  const exportData=()=>{const d=JSON.stringify({accounts,cfdTrades,optTrades,watchlist,checklist,scannerItems,events,suggestions,exportDate:new Date().toISOString()},null,2);
    const b=new Blob([d],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`tactical-${td()}.json`;a.click();};
  const importData=()=>{const input=document.createElement("input");input.type="file";input.accept=".json";
    input.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();
      r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(d.accounts)setAccounts(d.accounts);if(d.cfdTrades)setCfdTrades(d.cfdTrades);if(d.optTrades)setOptTrades(d.optTrades);
        if(d.watchlist)setWatchlist(d.watchlist);if(d.checklist)setChecklist(d.checklist);if(d.scannerItems)setScannerItems(d.scannerItems);if(d.events)setEvents(d.events);if(d.suggestions)setSuggestions(d.suggestions);}catch(err){}};r.readAsText(f);};input.click();};

  useEffect(()=>{const h=e=>{if(["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName))return;
    const m={"1":"dashboard","2":"checklist","3":"scanner","4":"technical","5":"events","6":"watchlist","7":"sizer","8":"log","9":"settings"};
    if(m[e.key]){e.preventDefault();setTab(m[e.key]);}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[]);

  return(
    <div className={`min-h-screen ${C.bg} text-gray-100`}>
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4"><div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center"><Zap size={18} className="text-white"/></div>
            <span className="font-bold text-white tracking-tight hidden sm:inline">TacticalBoard</span><Badge color="blue">v3</Badge>
          </div>
          <nav className="flex gap-0.5 overflow-x-auto">{tabs.map((t,i)=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs whitespace-nowrap ${tab===t.id?"bg-gray-800 text-white":"text-gray-500 hover:text-gray-300 hover:bg-gray-900"}`}>
              <t.icon size={14}/><span className="hidden lg:inline">{t.label}</span>
              <kbd className={`hidden xl:inline text-xs ${tab===t.id?"text-gray-400":"text-gray-600"}`}>{i+1}</kbd>
            </button>))}</nav>
          <div className="flex gap-2">
            <button onClick={importData} className={`${C.btn} ${C.btnG} text-xs`}><Upload size={14}/></button>
            <button onClick={exportData} className={`${C.btn} ${C.btnG} text-xs`}><Download size={14}/></button>
          </div>
        </div></div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {["dashboard","sizer","log"].includes(tab)&&<AccountSwitcher activeAccount={activeAccount} setActiveAccount={setActiveAccount} accounts={accounts} cfdTrades={cfdTrades} optTrades={optTrades}/>}
        {["dashboard","sizer"].includes(tab)&&<SuggestionPanel suggestions={suggestions} setSuggestions={setSuggestions} activeAccount={activeAccount}/>}

        {tab==="dashboard"&&<Dashboard activeAccount={activeAccount} trades={trades} positions={positions} account={account} checklist={checklist} scannerItems={scannerItems} events={events} suggestions={suggestions}/>}
        {tab==="checklist"&&<MorningChecklist checklist={checklist} setChecklist={setChecklist}/>}
        {tab==="scanner"&&<SqueezeScanner scannerItems={scannerItems} setScannerItems={setScannerItems} suggestions={suggestions} setSuggestions={setSuggestions}/>}
        {tab==="technical"&&<TechnicalAnalysis/>}
        {tab==="events"&&<EventCalendar events={events} setEvents={setEvents}/>}
        {tab==="watchlist"&&<Watchlist watchlist={watchlist} setWatchlist={setWatchlist}/>}
        {tab==="sizer"&&<PositionSizer activeAccount={activeAccount} account={account} onTrade={addTrade}/>}
        {tab==="log"&&<TradeLog trades={trades} setTrades={setTrades} account={account} activeAccount={activeAccount}/>}
        {tab==="settings"&&<Settings accounts={accounts} setAccounts={setAccounts}/>}
      </main>
      <footer className="border-t border-gray-800 py-3 text-center"><p className={`text-xs ${C.td}`}>1-9 naviguer | Export JSON | 2 comptes independants | Scanner connecte aux 2 books</p></footer>
    </div>
  );
}
