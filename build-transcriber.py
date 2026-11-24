from pathlib import Path
import subprocess,tempfile
root=Path(__file__).resolve().parent
target=root/'native/tingwu-live-transcriber'
subprocess.run(['/usr/bin/xcrun','swiftc',str(root/'native/LiveTranscriber.swift'),'-O','-o',str(target),'-module-cache-path',str(Path(tempfile.gettempdir())/'tingwu-swift-cache')],check=True)
subprocess.run(['/usr/bin/codesign','--force','--sign','-','--identifier','com.tangyi.tingwuclassassistant.transcriber',str(target)],check=True)
print(target)
