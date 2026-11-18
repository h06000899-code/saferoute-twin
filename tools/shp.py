import struct,math
def read_shp(path):
    f=open(path,'rb').read()
    st=struct.unpack('<i',f[32:36])[0]
    pos=100;out=[]
    while pos<len(f):
        rn,cl=struct.unpack('>ii',f[pos:pos+8]);pos+=8
        rec=f[pos:pos+cl*2];pos+=cl*2
        t=struct.unpack('<i',rec[:4])[0]
        if t==0: out.append(None);continue
        if t in(1,11,21):
            x,y=struct.unpack('<2d',rec[4:20]);out.append(('P',[(x,y)]));continue
        bb=struct.unpack('<4d',rec[4:36])
        np_,npt=struct.unpack('<2i',rec[36:44])
        parts=list(struct.unpack('<%di'%np_,rec[44:44+4*np_]))
        o=44+4*np_
        pts=struct.unpack('<%dd'%(2*npt),rec[o:o+16*npt])
        pts=[(pts[2*i],pts[2*i+1]) for i in range(npt)]
        parts.append(npt)
        rings=[pts[parts[i]:parts[i+1]] for i in range(np_)]
        out.append((t,rings,bb))
    return st,out
def read_dbf(path,enc):
    f=open(path,'rb').read()
    n,hl,rl=struct.unpack('<xxxxIHH',f[:12])
    fields=[];p=32
    while f[p]!=0x0D:
        nm=f[p:p+11].split(b'\0')[0].decode(enc,'ignore');ln=f[p+16];fields.append((nm,ln));p+=32
    rows=[]
    for i in range(n):
        r=f[hl+i*rl:hl+(i+1)*rl];o=1;d={}
        for nm,ln in fields:
            d[nm]=r[o:o+ln].decode(enc,'ignore').strip();o+=ln
        rows.append(d)
    return fields,rows
