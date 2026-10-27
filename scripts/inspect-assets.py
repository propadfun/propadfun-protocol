import struct,sys,glob,json
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans
out={}
for f in sorted(glob.glob('brand/*')+glob.glob('reference/*')):
    raw=open(f,'rb').read()
    print('==',f,len(raw),'magic',raw[:4].hex())
    if raw[:8]==b'\x89PNG\r\n\x1a\n':
        w,h,bd,ct=struct.unpack('>IIBB',raw[16:26]);print(' IHDR',w,h,'bitdepth',bd,'colortype',ct)
    im=Image.open(f);print(' PIL',im.format,im.mode,im.size)
    a=np.asarray(im.convert('RGBA'))
    al=a[...,3];hist=np.bincount(al.ravel(),minlength=256)
    print(' alpha: min',al.min(),'max',al.max(),'n<255',int((al<255).sum()),'n==0',int((al==0).sum()))
    rgb=a[...,:3].reshape(-1,3)
    blk=int(((a[...,:3].sum(-1)==0)&(al==0)).sum());print(' pure-black transparent px',blk)
    sub=rgb[::max(1,len(rgb)//60000)]
    km=KMeans(6,n_init=3,random_state=1).fit(sub)
    pal=[]
    for c,n in zip(km.cluster_centers_,np.bincount(km.labels_)):
        d=((rgb[::7].astype(float)-c)**2).sum(1);i=d.argmin()*7
        y,x=divmod(i,a.shape[1]);p=rgb[i]
        pal.append(('#%02x%02x%02x'%tuple(p),int(n),(x,y)))
    print(' kmeans snapped:',pal)
