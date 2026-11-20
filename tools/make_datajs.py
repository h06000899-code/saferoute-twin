# public/data/*.json → data.js (브라우저가 서버 없이 읽도록 하나의 파일로 묶기)
import json,os
D=os.path.join(os.path.dirname(__file__),'..','public','data')+'/'
n={'net':'walknet','f22':'flood2022','f100':'flood100','ev':'evacroutes','model':'model'}
open(os.path.join(D,'..','..','data.js'),'w',encoding='utf-8').write('window.DATA='+json.dumps({k:json.load(open(D+v+'.json',encoding='utf-8')) for k,v in n.items()},separators=(',',':'),ensure_ascii=False)+';')
