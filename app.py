#!/usr/bin/env python3
from __future__ import annotations
import base64, configparser, json, os, re
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

import requests
from flask import Flask, jsonify, request, send_from_directory

app=Flask(__name__)
app.json.ensure_ascii=False
BASE=Path(__file__).resolve().parent
DATA_ROOT=BASE/"data"
CONFIG_PATH=Path(os.environ.get("JIRA_CONFIG_PATH", str((BASE/".."/"config.ini").resolve())))
DISTRIBUTION_STATUSES_PATH=BASE/"distribution_statuses.json"

def monday(d:date)->date: return d-timedelta(days=d.weekday())
def planning_week()->tuple[date,date]:
    start=monday(date.today())+timedelta(days=7)
    return start,start+timedelta(days=4)
def fmt(d:date)->str: return d.strftime("%d.%m.%Y")
def folder_name(start:date,end:date)->str: return f"{fmt(start)}_{fmt(end)}"

def github_cfg():
    c=configparser.ConfigParser()
    if CONFIG_PATH.exists(): c.read(CONFIG_PATH,encoding="utf-8")
    s=c["github"] if c.has_section("github") else {}
    return {"token":str(s.get("token","")).strip(),"repository":str(s.get("repository","")).strip(),"branch":str(s.get("branch","")).strip()}

def headers():
    c=github_cfg()
    return {"Authorization":f"Bearer {c['token']}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Weekly-Planner-Manager"}

def api_url(path:str)->str:
    c=github_cfg()
    if not c["token"]: raise ValueError("GitHub token не задан в ../config.ini")
    if "/" not in c["repository"]: raise ValueError("GitHub repository должен быть owner/repository")
    return f"https://api.github.com/repos/{c['repository']}/contents/{quote(path,safe='/')}"



JIRA_BASE_URL = "https://jira.softswiss.net"
JIRA_SEARCH_URL = f"{JIRA_BASE_URL}/rest/api/2/search"

def jira_cfg():
    c=configparser.ConfigParser()
    if CONFIG_PATH.exists(): c.read(CONFIG_PATH, encoding="utf-8")
    s=c["jira"] if c.has_section("jira") else {}
    return {"username":str(s.get("username","")).strip(),"password":str(s.get("password","")).strip()}

def jira_session():
    c=jira_cfg()
    if not c["username"] or not c["password"]:
        raise ValueError("Jira не настроена. Заполните username и password в ../config.ini")
    s=requests.Session()
    s.auth=(c["username"],c["password"])
    s.headers.update({"Accept":"application/json"})
    return s

def jira_search_issues(jql, fields):
    s=jira_session()
    out=[]; start=0
    while True:
        r=s.get(JIRA_SEARCH_URL, params={"jql":jql,"fields":fields,"startAt":start,"maxResults":100}, timeout=20)
        r.raise_for_status()
        payload=r.json()
        chunk=payload.get("issues",[]) or []
        out.extend(chunk)
        start += len(chunk)
        if not chunk or start >= int(payload.get("total",0) or 0): break
    return out

def distribution_tasks(email, start):
    end=start+timedelta(days=4)
    folder=folder_name(start,end)
    # Same date logic as Weekly Planner: overlap, one missing boundary, or both
    # missing and issue created no more than two months before planning start.
    year=start.year; month=start.month-2
    while month<=0:
        month += 12; year -= 1
    import calendar
    threshold=date(year,month,min(start.day,calendar.monthrange(year,month)[1])).isoformat()
    target_clause=(
        f'(("Target start" <= "{end.isoformat()}" AND "Target end" >= "{start.isoformat()}") '
        f'OR ("Target start" is EMPTY AND "Target end" is not EMPTY) '
        f'OR ("Target start" is not EMPTY AND "Target end" is EMPTY) '
        f'OR ("Target start" is EMPTY AND "Target end" is EMPTY AND created >= "{threshold}"))'
    )
    jql=f'assignee = "{email}" AND {target_clause} ORDER BY priority DESC, updated DESC'
    fields="summary,status,customfield_10501,customfield_11001,customfield_11002,customfield_12200"
    rows=[]
    for issue in jira_search_issues(jql,fields):
        f=issue.get("fields") or {}
        st=f.get("status") or {}
        rt=f.get("customfield_10501")
        if isinstance(rt,dict):
            rt=rt.get("value") or rt
            if isinstance(rt,dict):
                rt=rt.get("requestType") or rt
        if isinstance(rt,dict): rt=rt.get("name") or rt.get("value") or ""
        rt=str(rt or "").strip()
        mapping={}
        try:
            raw=json.loads((root/"request_type_mapping.json").read_text(encoding="utf-8"))
            srcmap=raw.get("mapping",raw) if isinstance(raw,dict) else {}
            mapping={str(k).strip().casefold():str(v).strip() for k,v in srcmap.items()} if isinstance(srcmap,dict) else {}
        except Exception: pass
        stream=mapping.get(rt.casefold(),"Live Requests")
        def fv(k):
            v=f.get(k)
            return (v.get("value") if isinstance(v,dict) else v) or ""
        comp=fv("customfield_12200")
        key=issue.get("key","")
        rows.append({
            "key":key,"summary":str(f.get("summary") or ""),"status":str(st.get("name") or ""),
            "stream":stream,"complexity":str(comp),"target_start":str(fv("customfield_11001") or ""),
            "target_end":str(fv("customfield_11002") or ""),
            "url":f"{JIRA_BASE_URL}/browse/{key}" if key else ""
        })
    allowed=[]
    try:
        payload=json.loads((root/"distribution_statuses.json").read_text(encoding="utf-8"))
        allowed=payload.get("statuses",payload) if isinstance(payload,dict) else payload
    except Exception: pass
    if allowed:
        allowed_set={str(x).casefold() for x in allowed}
        rows=[r for r in rows if r["status"].casefold() in allowed_set]
    return rows

def load_distribution_statuses():
    defaults=["In Progress","Submitted","To Do","Design Review","Ready for Design Review"]
    try:
        payload=json.loads(DISTRIBUTION_STATUSES_PATH.read_text(encoding="utf-8"))
        values=payload.get("statuses") if isinstance(payload,dict) else payload
        if not isinstance(values,list): return defaults
        return [str(v).strip() for v in values if str(v).strip()] or defaults
    except Exception:
        return defaults

def load_stream_colors():
    path=BASE/"request_type_mapping.json"
    try:
        payload=json.loads(path.read_text(encoding="utf-8"))
        return payload.get("stream_colors") if isinstance(payload,dict) else {}
    except Exception:
        return {}

def parse_minutes(value):
    text=str(value or "").strip().lower()
    if not text:
        return 0
    mh=re.search(r'(\d+(?:[.,]\d+)?)\s*h', text)
    mm=re.search(r'(\d+)\s*m', text)
    total=0
    if mh: total += float(mh.group(1).replace(",", "."))*60
    if mm: total += int(mm.group(1))
    if not mh and not mm:
        try: total=float(text.replace(",", "."))*60
        except Exception: total=0
    return int(round(total))

def format_minutes(minutes):
    h,m=divmod(max(0,int(minutes)),60)
    if h and m: return f"{h}h {m}m"
    if h: return f"{h}h"
    return "0h" if m==0 else f"0h {m}m"

def aggregate_plans(users, folder):
    totals={}; comments={}
    for u in users:
        try:
            payload=load_local(folder,u["filename"])
        except Exception:
            continue
        rows=payload.get("stream_plan") if isinstance(payload,dict) else []
        if not isinstance(rows,list): continue
        for r in rows:
            if not isinstance(r,dict): continue
            stream=str(r.get("stream") or "").strip()
            if not stream: continue
            totals[stream]=totals.get(stream,0)+parse_minutes(r.get("hours"))
            c=str(r.get("comment") or "").strip()
            if c:
                comments.setdefault(stream,[])
                if c not in comments[stream]: comments[stream].append(c)
    ordered=[]
    defaults=["Management","Defects","Live Requests","AI","Product contribution","Setup contribution","Training","Communication","Absence","Documentation","Bench","Setup Work"]
    for stream in defaults:
        ordered.append({"stream":stream,"hours":format_minutes(totals.get(stream,0)),"comment":", ".join(comments.get(stream,[]))})
    return ordered

def list_remote_folder(folder:str):
    c=github_cfg(); params={"ref":c["branch"]} if c["branch"] else None
    r=requests.get(api_url(folder),headers=headers(),params=params,timeout=20)
    if r.status_code==404: raise FileNotFoundError(f"Папка {folder} не найдена на GitHub")
    r.raise_for_status()
    data=r.json()
    if not isinstance(data,list): raise ValueError("GitHub вернул неожиданный ответ для папки")
    return data

def download_text(item):
    url=item.get("download_url")
    if url:
        r=requests.get(url,headers=headers(),timeout=20); r.raise_for_status(); return r.text
    r=requests.get(api_url(item["path"]),headers=headers(),timeout=20); r.raise_for_status()
    meta=r.json(); return base64.b64decode(meta.get("content","")).decode("utf-8")

def username_from_filename(name,folder):
    prefix=f"Planning_{folder}_"
    if not name.startswith(prefix) or not name.endswith(".json"): return None
    return name[len(prefix):-5]

def email_from_username(username):
    return username if "@" in username else username+"@softswiss.com"

def load_local(folder,filename):
    p=DATA_ROOT/folder/filename
    if not p.exists(): raise FileNotFoundError(filename)
    payload=json.loads(p.read_text(encoding="utf-8"))
    return payload if isinstance(payload,dict) else {}

@app.get("/")
def index(): return send_from_directory(BASE,"manager.html")

@app.get("/api/bootstrap")
def bootstrap():
    start,end=planning_week(); folder=folder_name(start,end)
    local=DATA_ROOT/folder
    users=[]
    if local.exists():
        for p in sorted(local.glob(f"Planning_{folder}_*.json")):
            u=username_from_filename(p.name,folder)
            if u: users.append({"username":u,"email":email_from_username(u),"filename":p.name})
    return jsonify({"period":{"from":start.isoformat(),"to":end.isoformat(),"label":f"{fmt(start)} — {fmt(end)}","folder":folder},"users":users,"stream_colors":load_stream_colors(),"aggregate_plan":aggregate_plans(users,folder)})

@app.post("/api/load")
def load_all():
    start,end=planning_week(); folder=folder_name(start,end)
    items=list_remote_folder(folder)
    target=DATA_ROOT/folder; target.mkdir(parents=True,exist_ok=True)
    users=[]
    for item in items:
        name=str(item.get("name") or "")
        u=username_from_filename(name,folder)
        if not u or item.get("type")!="file": continue
        text=download_text(item)
        # Validate JSON before replacing local copy.
        payload=json.loads(text)
        if not isinstance(payload,dict): continue
        (target/name).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
        users.append({"username":u,"email":email_from_username(u),"filename":name})
    users=sorted(users,key=lambda x:x["email"].lower())
    return jsonify({"ok":True,"folder":str(target),"users":users,"stream_colors":load_stream_colors(),"aggregate_plan":aggregate_plans(users,folder)})

@app.get("/api/user")
def user_data():
    start,end=planning_week(); folder=folder_name(start,end)
    filename=(request.args.get("filename") or "").strip()
    if not re.fullmatch(r"Planning_[0-9.]+_[0-9.]+_[A-Za-z0-9._@-]+\.json",filename):
        return jsonify({"error":"Некорректное имя файла"}),400
    try: payload=load_local(folder,filename)
    except FileNotFoundError: return jsonify({"error":"Локальный файл пользователя не найден"}),404
    return jsonify({"plan":{"stream_plan":payload.get("stream_plan") if isinstance(payload.get("stream_plan"),list) else [],
                            "meetings":payload.get("meetings") if isinstance(payload.get("meetings"),dict) else {"calendar":[],"manual":[]}}})


@app.get("/api/distribution")
def api_distribution():
    email=(request.args.get("email") or "").strip()
    if not email: return jsonify({"error":"Параметр email обязателен"}),400
    start,end=planning_week()
    try:
        return jsonify({"tasks":distribution_tasks(email,start),"period":{"from":start.isoformat(),"to":end.isoformat()}})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error":f"Jira API: {e}"}),502
    except Exception as e:
        return jsonify({"error":f"Ошибка получения задач: {type(e).__name__}: {e}"}),500

@app.get("/healthz")
def health(): return jsonify({"ok":True})

if __name__=="__main__":
    app.run(host="127.0.0.1",port=5000,debug=False)
