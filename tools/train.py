import sys,re,json,math,glob,warnings
sys.path.insert(0,'.');warnings.filterwarnings('ignore')
import numpy as np,pandas as pd
from datetime import datetime,timedelta
from shp import *;from proj import inv,inv2
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score,average_precision_score
OUT='/home/claude/saferoute-twin/public/data/'
FIX={'영등포':'영등포구','서대문':'서대문구','동대문':'동대문구'}
# ---------- 1) 침수흔적: 구별·발생시각 ----------
st,g=read_shp('2022 서울시 침수흔적도 업뎃.shp');fl,rows=read_dbf('2022 서울시 침수흔적도 업뎃.dbf','cp949')
def onset(y,tm):
    y=(y or '').strip();tm=(tm or '').strip()
    m=re.match(r'(\d{4})-?(\d{2})-?(\d{2})\s*-\s*(\d{2})(\d{2})',y)
    try:
        if m:a=list(map(int,m.groups()));return datetime(a[0],a[1],a[2],a[3],a[4])
        m=re.match(r'(\d{4})-?(\d{2})-?(\d{2})',y)
        if not m:return None
        a=list(map(int,m.groups()));d=datetime(*a)
        if tm.isdigit() and tm not in ('0','00','0000'):
            if len(tm)<=2:return d+timedelta(hours=int(tm))
            if len(tm)==4:return d+timedelta(hours=int(tm[:2]),minutes=int(tm[2:]))
    except ValueError:return None
    return None
for r in rows:r['gu']=FIX.get(r['GU_NAM'],r['GU_NAM']);r['t']=onset(r['F_SAT_YMD'],r['F_SAT_TM'])
print('polygons',len(rows),'with onset',sum(r['t'] is not None for r in rows))
# ---------- 2) 강우: 구별 10분 시계열 ----------
fr=[]
for f in sorted(glob.glob('서울시_강우량_정보_2022년*월.csv')):
    d=pd.read_csv(f,encoding='cp949');d.columns=['code','name','gc','gu','r','t'];fr.append(d[['gu','r','t']])
d=pd.concat(fr);d['t']=pd.to_datetime(d['t'],format='mixed',errors='coerce');d=d.dropna(subset=['t'])
d['r']=pd.to_numeric(d['r'],errors='coerce').fillna(0).clip(0,60);d['t']=d['t'].dt.floor('10min')
ser=d.groupby(['gu','t'])['r'].mean().unstack(0)
idx=pd.date_range('2022-01-01','2022-12-31 23:50',freq='10min');ser=ser.reindex(idx).fillna(0)
r10=ser;r1=ser.rolling(6,min_periods=1).sum();r3=ser.rolling(18,min_periods=1).sum()
print('districts',len(ser.columns),'rows',len(idx))
# ---------- 3) 구·날짜 단위 라벨: 그 날 침수흔적(폴리곤 3개 이상)이 생겼는가 ----------
def odate(y):
    m=re.match(r'(\d{4})-?(\d{2})-?(\d{2})',(y or '').strip())
    try:return datetime(*map(int,m.groups())).date() if m else None
    except ValueError:return None
cnt={}
for r in rows:
    dd=odate(r['F_SAT_YMD'])
    if dd and dd.year==2022:cnt[(r['gu'],dd)]=cnt.get((r['gu'],dd),0)+1
from datetime import date
EVENT=[(date(2022,6,28),date(2022,7,1)),(date(2022,8,8),date(2022,8,9)),(date(2022,9,4),date(2022,9,6))]   # 실제 호우 기간
inev=lambda d:any(a<=d<=b for a,b in EVENT)
days=pd.date_range('2022-01-01','2022-12-31',freq='D')
Xs=[];ys=[];gs=[];meta=[]
for gi,gu in enumerate(ser.columns):
    for dday in days:
        n=cnt.get((gu,dday.date()),0)
        if n>0 and not inev(dday.date()):continue   # 호우 기간 밖 날짜(접수일 등)의 침수 기록은 제외
        if 0<n<3:continue                       # 애매한 날(1~2개)은 제외
        sl=slice(dday,dday+pd.Timedelta(hours=23,minutes=50))
        f=[r10[gu][sl].max(),r1[gu][sl].max(),r3[gu][sl].max()]
        Xs.append(f);ys.append(1 if n>=3 else 0);gs.append(gi);meta.append((gu,dday))
Xr=np.array(Xs);y=np.array(ys);grp=np.array(gs);X=np.log1p(Xr)
print('samples',len(y),'positives',int(y.sum()),'pos districts',len(set(grp[y==1])))
# ---------- 4) 학습: 로지스틱 회귀 (계수 음수 방지) ----------
from scipy.optimize import minimize
def fit_nn(X,y,lam=0.02):                       # 계수 ≥ 0 (비가 많을수록 위험↑) 제약 로지스틱 회귀, 클래스 균형 가중
    mu=X.mean(0);sd=X.std(0)+1e-9;Z=(X-mu)/sd;n=len(y);npos=y.sum()
    sw=np.where(y==1,n/(2*npos),n/(2*(n-npos)))
    def loss(p):
        s_=Z@p[:3]+p[3];return (sw*np.logaddexp(0,-(2*y-1)*s_)).sum()/sw.sum()+lam*(p[:3]**2).sum()
    r=minimize(loss,np.array([.1,.1,.1,0.]),bounds=[(0,None)]*3+[(None,None)],method='L-BFGS-B')
    wv=r.x[:3]/sd;return wv,float(r.x[3]-(r.x[:3]*mu/sd).sum())
sig=lambda t:1/(1+np.exp(-t))
w,b=fit_nn(X,y)
oof=np.zeros(len(y))
for tr,te in GroupKFold(5).split(X,y,grp):
    ww,bb=fit_nn(X[tr],y[tr]);oof[te]=sig(X[te]@ww+bb)
auc=roc_auc_score(y,oof);ap=average_precision_score(y,oof)
best=(0,0.5,0,0)
for t_ in np.linspace(0.05,0.99,95):                # 안전 목적: 놓치지 않는 것이 중요하므로 F2(재현율 가중)로 임계값 선택
    p=oof>=t_;tp=(p&(y==1)).sum();pr=tp/max(p.sum(),1);rc=tp/max(y.sum(),1);f2=5*pr*rc/max(4*pr+rc,1e-9)
    if f2>best[0]:best=(f2,t_,pr,rc)
f1,tau,prec,rec=best;ztau=math.log(tau/(1-tau))
z_of=lambda a,b_,c:float(w@np.array([math.log1p(a),math.log1p(b_),math.log1p(c)])+b)
print('coef',w.round(3),'b',round(b,3),'AUC',round(auc,3),'AP',round(ap,3),'tau',round(tau,3),'F2',round(f1,3),'prec',round(prec,3),'rec',round(rec,3))
for lbl,args in [('무강우',(0,0,0)),('2/6/10',(2,6,10)),('5/20/30',(5,20,30)),('8/40/60',(8,40,60)),('10/60/90',(10,60,90)),('15/90/130',(15,90,130)),('20.5/116/175',(20.5,116,175))]:
    zz=z_of(*args);print(lbl,'P=',round(float(sig(zz)),3),'z=',round(zz,2))
print('zTau',round(ztau,2))
# ---------- 5) 관악구 폴리곤별 침수 임계(θ): 발생 시각 직전 24시간 최대 z ----------
G='관악구';zG=pd.Series(w[0]*np.log1p(r10[G].values)+w[1]*np.log1p(r1[G].values)+w[2]*np.log1p(r3[G].values)+b,index=idx)
zmax24=zG.rolling(144,min_periods=1).max()
zpeak=float(zG['2022-08-08':'2022-08-10'].max())
allz=np.max([w[0]*np.log1p(r10[c].values)+w[1]*np.log1p(r1[c].values)+w[2]*np.log1p(r3[c].values)+b for c in ser.columns]);zcap=float(allz)
ok=lambda r:r['t'] is not None and inev(r['t'].date()) and pd.Timestamp(r['t']).floor('10min') in zmax24.index
known=[float(zmax24[pd.Timestamp(r['t']).floor('10min')]) for r in rows if r['gu']==G and ok(r)]
med=float(np.median(known))
delta=max(zcap-zpeak,0.5);print('zpeak',round(zpeak,2),'zcap',round(zcap,2),'delta',round(delta,2),'zTau',round(ztau,2),'theta med',round(med,2),'known',len(known))
def area(ring):
    a=0
    for i in range(len(ring)):
        x1,y1=ring[i];x2,y2=ring[(i+1)%len(ring)];a+=(x1*88000)*(y2*111000)-(x2*88000)*(y1*111000)
    return abs(a)/2
def r5(p):return [round(p[0],5),round(p[1],5)]
kn=np.sort(np.array(known));uk=0
f22=[]
for geom,row in zip(g,rows):
    if not geom or row['gu']!=G:continue
    t=row['t'];uk+=1;th=float(np.quantile(kn,(uk*0.6180339887)%1))      # 시각 미상: 알려진 분포에서 균등 배정
    if ok(row):th=float(zmax24[pd.Timestamp(t).floor('10min')])
    th=max(th,ztau)
    for ring in geom[1]:
        pts=[inv2(x,y_) for x,y_ in ring]
        if len(pts)>40:pts=pts[::max(1,len(pts)//40)]+[pts[-1]]
        f22.append({'r':[r5(p) for p in pts],'th':round(th,3),'a':round(area(pts))})
# 침수 시작 순서 = 2022 실제 발생 시각에서 학습한 임계값 순서, 확산 폭 = 면적 누적 비율로 ztau~zpeak에 배정
order=sorted(range(len(f22)),key=lambda i:(f22[i]['th'],i));tot=sum(x['a'] for x in f22) or 1;cum=0
for i in order:
    q=(cum+f22[i]['a']/2)/tot;cum+=f22[i]['a'];f22[i]['th']=round(ztau+(zpeak-ztau)*q,3)
st,c=read_shp('CFM_SGG_11620_100.shp');f100=[]
for geom in c:
    for ring in geom[1]:
        pts=[inv(x,y_) for x,y_ in ring]
        if len(pts)>80:pts=pts[::max(1,len(pts)//80)]+[pts[-1]]
        f100.append({'r':[r5(p) for p in pts],'a':round(area(pts))})
def cen(r):return (sum(p[0] for p in r)/len(r)*88000,sum(p[1] for p in r)/len(r)*111000)
c22=np.array([cen(x['r']) for x in f22]);c100=np.array([cen(x['r']) for x in f100])
dist=np.array([np.sqrt(((c22-c)**2).sum(1)).min() for c in c100]);rank=dist.argsort().argsort()/max(len(dist)-1,1)
for x,rk in zip(f100,rank):x['th']=round(zpeak+0.001+float(rk)*delta,3)
tot22=sum(x['a'] for x in f22);tot100=sum(x['a'] for x in f100)
print('f22',len(f22),'area',tot22,'f100',len(f100),'area',tot100)
json.dump(f22,open(OUT+'flood2022.json','w'),separators=(',',':'));json.dump(f100,open(OUT+'flood100.json','w'),separators=(',',':'))
model={'w':[float(x) for x in w],'b':b,'tau':float(tau),'zTau':ztau,'zPeak':zpeak,'zCap':zcap,
 'metrics':{'samples':int(len(y)),'positives':int(y.sum()),'districts':int(len(ser.columns)),'floodDistricts':len(set(grp[y==1])),'auc':round(auc,3),'ap':round(ap,3),'precision':round(float(prec),3),'recall':round(float(rec),3)},
 'area2022':tot22,'area100':tot100}
json.dump(model,open(OUT+'model.json','w'),ensure_ascii=False)
