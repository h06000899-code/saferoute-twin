import sys,json,csv,re,collections,math,os
sys.path.insert(0,'.')
from shp import *;from proj import inv,inv2
OUT='/home/claude/saferoute-twin/public/data';os.makedirs(OUT,exist_ok=True)
BB=(126.88,37.43,127.00,37.50)
def inb(lo,la):return BB[0]<=lo<=BB[2] and BB[1]<=la<=BB[3]
def r5(p):return [round(p[0],5),round(p[1],5)]
def thin(ring,n=1):
    return ring if len(ring)<=24 else ring[::n]
# flood trace
st,g=read_shp('2022 서울시 침수흔적도 업뎃.shp')
fl,rows=read_dbf('2022 서울시 침수흔적도 업뎃.dbf','cp949')
fe=[]
for geom,row in zip(g,rows):
    if not geom or row['GU_NAM']!='관악구':continue
    for ring in geom[1]:
        pts=[inv2(x,y) for x,y in ring]
        if len(pts)>40:pts=pts[::max(1,len(pts)//40)]+[pts[-1]]
        fe.append({'d':round(float(row['F_SHIM'] or 0),2),'r':[r5(p) for p in pts]})
print('flood2022 rings',len(fe))
json.dump(fe,open(OUT+'/flood2022.json','w'),separators=(',',':'))
# cfm100
st,c=read_shp('CFM_SGG_11620_100.shp');fc=[]
for geom in c:
    for ring in geom[1]:
        pts=[inv(x,y) for x,y in ring]
        if len(pts)>80:pts=pts[::max(1,len(pts)//80)]+[pts[-1]]
        fc.append([r5(p) for p in pts])
print('cfm',len(fc));json.dump(fc,open(OUT+'/flood100.json','w'),separators=(',',':'))
# DS_WAY
st,w=read_shp('DS_WAY.shp');ev=[]
for geom in w:
    if not geom:continue
    for ring in geom[1]:
        pts=[inv(x,y) for x,y in ring]
        if any(inb(*p) for p in pts):ev.append([r5(p) for p in pts])
print('evac lines',len(ev));json.dump(ev,open(OUT+'/evacroutes.json','w'),separators=(',',':'))
# walk network
nodes={};edges=[]
enc='cp949'
with open('/mnt/user-data/uploads/서울시_자치구별_도보_네트워크_공간정보.csv',encoding=enc,newline='') as f:
    for r in csv.DictReader(f):
        if r['시군구명']!='관악구' or r['노드링크 유형']!='LINK':continue
        m=re.findall(r'(-?\d+\.\d+) (-?\d+\.\d+)',r['링크 WKT'])
        if len(m)<2:continue
        pts=[[float(a),float(b)] for a,b in m]
        a,b=r['시작노드 ID'],r['종료노드 ID']
        nodes.setdefault(a,pts[0]);nodes.setdefault(b,pts[-1])
        fl=''.join(k for k,key in zip('XBTCP',['고가도로','교량','터널','횡단보도','공원,녹지']) if r[key]=='1')
        edges.append([a,b,round(float(r['링크 길이']),1),fl,[r5(p) for p in pts[::max(1,len(pts)//6)]]+([r5(pts[-1])] if len(pts)>6 else [])])
ids={k:i for i,k in enumerate(nodes)}
net={'nodes':[r5(nodes[k]) for k in ids],'edges':[[ids[a],ids[b],l,f,g] for a,b,l,f,g in edges]}
print('nodes',len(ids),'edges',len(edges))
json.dump(net,open(OUT+'/walknet.json','w'),separators=(',',':'),ensure_ascii=False)
# rain
import pandas as pd,zipfile,io
frames=[]
for m in ['06','07','08','09']:
    df=pd.read_csv(f'서울시_강우량_정보_2022년{m}월.csv',encoding='cp949');frames.append(df[df['구청명']=='관악구'])
d=pd.concat(frames);d['t']=pd.to_datetime(d['자료수집 시각'],format='mixed',errors='coerce');d=d.dropna(subset=['t']);d['r']=pd.to_numeric(d['10분우량'],errors='coerce').fillna(0)
p=d.groupby('t')['r'].mean().sort_index().resample('10min').max().fillna(0)
h1=p.rolling(6).sum();h3=p.rolling(18).sum()
i=h1.idxmax();print('max',p.max(),h1.max(),h3.max(),i,h1[i],h3[i],p[i])
pk=p.idxmax();print('peak10',pk,p[pk],h1[pk],h3[pk])
top=h1.sort_values(ascending=False)
ev=[];seen=[]
for t,v in top.items():
    if all(abs((t-s).total_seconds())>6*3600 for s in seen):
        seen.append(t);ev.append({'time':str(t),'r10':round(float(p[t]),1),'r1h':round(float(h1[t]),1),'r3h':round(float(h3[t]),1)})
    if len(ev)>=6:break
print(ev);json.dump({'stations':sorted(d['강우량계명'].unique().tolist()),'events':ev,'max10':round(float(p.max()),1)},open(OUT+'/rain2022.json','w'),ensure_ascii=False)
