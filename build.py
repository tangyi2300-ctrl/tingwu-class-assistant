from pathlib import Path
import re,struct,zlib,zipfile
root=Path(__file__).resolve().parent
ext=root/'extension'
# Tiny local icon: no external image assets or network dependency.
rows=[]
for y in range(128):
 row=bytearray()
 for x in range(128):
  color=(40,92,71,255)
  for cx,h in [(36,24),(50,46),(64,68),(78,46),(92,24)]:
   if abs(x-cx)<=4 and abs(y-64)<h/2:color=(248,244,222,255)
  row.extend(color)
 rows.append(b'\0'+row)
def chunk(k,v):return struct.pack('!I',len(v))+k+v+struct.pack('!I',zlib.crc32(k+v)&0xffffffff)
(ext/'icon.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',128,128,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b''))
html=(ext/'index.html').read_text()
js=(ext/'schedule.js').read_text().replace('export ','')+'\n'+re.sub(r"^import .*?;\n",'',(ext/'ui.js').read_text())
js=js.replace("index.html?notice=end","听课搭子-界面预览.html?notice=end").replace("location.href='index.html'","location.href='听课搭子-界面预览.html'")
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+(ext/'style.css').read_text()+'</style>').replace('<script type="module" src="ui.js"></script>','<script type="module">'+js+'</script>').replace('href="index.html"','href="听课搭子-界面预览.html"')
(root/'preview'/'听课搭子-界面预览.html').write_text(html)
with zipfile.ZipFile(root/'听课搭子-检查版.zip','w',zipfile.ZIP_DEFLATED) as z:
 for path in ext.iterdir():z.write(path,'听课搭子/'+path.name)
 for name in ['README.md','TEST-REPORT.md']:
  if (root/name).exists():z.write(root/name,'听课搭子/'+name)
print('Built standalone preview and extension ZIP.')
