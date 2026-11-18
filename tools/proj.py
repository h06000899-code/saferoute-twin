import math
def mk(lon0,lat0,k,fe,fn):
    a=6378137.0;f=1/298.257222101;e2=2*f-f*f;ep2=e2/(1-e2)
    def M(p):
        return a*((1-e2/4-3*e2**2/64-5*e2**3/256)*p-(3*e2/8+3*e2**2/32+45*e2**3/1024)*math.sin(2*p)+(15*e2**2/256+45*e2**3/1024)*math.sin(4*p)-(35*e2**3/3072)*math.sin(6*p))
    M0=M(math.radians(lat0))
    def inv(x,y):
        M1=M0+(y-fn)/k
        mu=M1/(a*(1-e2/4-3*e2**2/64-5*e2**3/256))
        e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
        p1=mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)+(151*e1**3/96)*math.sin(6*mu)
        C1=ep2*math.cos(p1)**2;T1=math.tan(p1)**2
        N1=a/math.sqrt(1-e2*math.sin(p1)**2);R1=a*(1-e2)/(1-e2*math.sin(p1)**2)**1.5
        D=(x-fe)/(N1*k)
        lat=p1-(N1*math.tan(p1)/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*ep2)*D**4/24)
        lon=math.radians(lon0)+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*ep2+24*T1**2)*D**5/120)/math.cos(p1)
        return math.degrees(lon),math.degrees(lat)
    return inv
inv=mk(127.0,38.0,1.0,200000,600000)
inv2=mk(127.5,38.0,0.9996,1000000,2000000)
