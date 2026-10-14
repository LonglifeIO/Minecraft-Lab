# Minimal Bedrock NBT (little-endian, uncompressed) reader/writer for .mcstructure files.
import struct, sys, json, collections, os
TAG_END,TAG_BYTE,TAG_SHORT,TAG_INT,TAG_LONG,TAG_FLOAT,TAG_DOUBLE,TAG_BYTE_ARRAY,TAG_STRING,TAG_LIST,TAG_COMPOUND,TAG_INT_ARRAY,TAG_LONG_ARRAY=range(13)
class R:
    def __init__(s,b): s.b=b; s.i=0
    def u8(s): v=s.b[s.i]; s.i+=1; return v
    def rd(s,f,n): v=struct.unpack_from(f,s.b,s.i)[0]; s.i+=n; return v
    def str(s): n=s.rd("<H",2); v=s.b[s.i:s.i+n].decode("utf-8","replace"); s.i+=n; return v
    def tag(s,t):
        if t==TAG_BYTE: return ("b",s.rd("<b",1))
        if t==TAG_SHORT: return ("s",s.rd("<h",2))
        if t==TAG_INT: return ("i",s.rd("<i",4))
        if t==TAG_LONG: return ("l",s.rd("<q",8))
        if t==TAG_FLOAT: return ("f",s.rd("<f",4))
        if t==TAG_DOUBLE: return ("d",s.rd("<d",8))
        if t==TAG_BYTE_ARRAY: n=s.rd("<i",4); v=s.b[s.i:s.i+n]; s.i+=n; return ("ba",bytes(v))
        if t==TAG_STRING: return ("str",s.str())
        if t==TAG_LIST:
            et=s.u8(); n=s.rd("<i",4); return ("list",et,[s.tag(et) for _ in range(n)])
        if t==TAG_COMPOUND:
            d=collections.OrderedDict()
            while True:
                tt=s.u8()
                if tt==TAG_END: break
                name=s.str(); d[name]=s.tag(tt)
            return ("comp",d)
        if t==TAG_INT_ARRAY: n=s.rd("<i",4); v=list(struct.unpack_from("<%di"%n,s.b,s.i)); s.i+=4*n; return ("ia",v)
        if t==TAG_LONG_ARRAY: n=s.rd("<i",4); v=list(struct.unpack_from("<%dq"%n,s.b,s.i)); s.i+=8*n; return ("la",v)
        raise ValueError("tag %d"%t)
class W:
    def __init__(s): s.o=bytearray()
    def u8(s,v): s.o.append(v&0xff)
    def wr(s,f,v): s.o+=struct.pack(f,v)
    def str(s,v): b=v.encode("utf-8"); s.wr("<H",len(b)); s.o+=b
    def tag(s,v):
        k=v[0]
        if k=="b": s.wr("<b",v[1])
        elif k=="s": s.wr("<h",v[1])
        elif k=="i": s.wr("<i",v[1])
        elif k=="l": s.wr("<q",v[1])
        elif k=="f": s.wr("<f",v[1])
        elif k=="d": s.wr("<d",v[1])
        elif k=="ba": s.wr("<i",len(v[1])); s.o+=v[1]
        elif k=="str": s.str(v[1])
        elif k=="list":
            s.u8(v[1]); s.wr("<i",len(v[2])); [s.tag(x) for x in v[2]]
        elif k=="comp":
            for name,val in v[1].items(): s.u8(TYPES[val[0]]); s.str(name); s.tag(val)
            s.u8(TAG_END)
        elif k=="ia": s.wr("<i",len(v[1])); s.o+=struct.pack("<%di"%len(v[1]),*v[1])
        elif k=="la": s.wr("<i",len(v[1])); s.o+=struct.pack("<%dq"%len(v[1]),*v[1])
TYPES={"b":TAG_BYTE,"s":TAG_SHORT,"i":TAG_INT,"l":TAG_LONG,"f":TAG_FLOAT,"d":TAG_DOUBLE,"ba":TAG_BYTE_ARRAY,"str":TAG_STRING,"list":TAG_LIST,"comp":TAG_COMPOUND,"ia":TAG_INT_ARRAY,"la":TAG_LONG_ARRAY}
def load(path):
    r=R(open(path,"rb").read()); t=r.u8(); assert t==TAG_COMPOUND; name=r.str(); root=r.tag(TAG_COMPOUND); return name,root
def dump(path,name,root):
    w=W(); w.u8(TAG_COMPOUND); w.str(name); w.tag(root); open(path,"wb").write(bytes(w.o))
def palette(root):
    st=root[1]["structure"][1]; pal=st["palette"][1]["default"][1]["block_palette"][2]
    return [(e[1]["name"][1], e[1].get("states",("comp",{}))[1]) for e in pal], st
if __name__=="__main__":
    # usage: mcstructure.py stats <dir>  -> block usage across all structures in a pack
    cmd=sys.argv[1]
    if cmd=="stats":
        tot=collections.Counter(); files=0
        for rt,_,fs in os.walk(sys.argv[2]):
            for f in fs:
                if not f.endswith(".mcstructure"): continue
                try:
                    name,root=load(os.path.join(rt,f)); pal,st=palette(root); files+=1
                    idx=st["block_indices"][2][0][2]; cnt=collections.Counter(v[1] for v in idx)
                    for i,c in cnt.items():
                        if 0<=i<len(pal): tot[pal[i][0]]+=c
                except Exception as e: print("skip",f,str(e)[:60])
        print("structures:",files); [print(f"  {n:45s} {c}") for n,c in tot.most_common(28)]
