import Cocoa
import ApplicationServices
func attribute(_ element:AXUIElement,_ name:String)->AnyObject? {var v:CFTypeRef?;return AXUIElementCopyAttributeValue(element,name as CFString,&v) == .success ? v : nil}
func str(_ element:AXUIElement,_ name:String)->String {if let value=attribute(element,name){if let u=value as? URL{return u.absoluteString};return value as? String ?? ""};return ""}
func children(_ element:AXUIElement)->[AXUIElement] {return attribute(element,kAXChildrenAttribute) as? [AXUIElement] ?? []}
func actions(_ element:AXUIElement)->[String] {var a:CFArray?;AXUIElementCopyActionNames(element,&a);return a as? [String] ?? []}
func output(_ value:[String:Any]) {let d=try! JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]);print(String(data:d,encoding:.utf8)!)}
guard AXIsProcessTrusted() else {output(["error":"系统辅助功能权限不可用"]);exit(2)}
guard let app=NSRunningApplication.runningApplications(withBundleIdentifier:"com.google.Chrome").first else {output(["browserClosed":true]);exit(0)}
let root=AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetAttributeValue(root,"AXEnhancedUserInterface" as CFString,kCFBooleanTrue)
AXUIElementSetAttributeValue(root,"AXManualAccessibility" as CFString,kCFBooleanTrue)
var webAreas:[AXUIElement]=[]
var visited=0
var webHosts:[String]=[]
func findWeb(_ e:AXUIElement,_ depth:Int=0){visited += 1;if depth>30{return};if str(e,kAXRoleAttribute)=="AXWebArea" {let u=str(e,kAXURLAttribute);webHosts.append(URL(string:u)?.host ?? "no-url");if URL(string:u)?.host=="tingwu.aliyun.com"{webAreas.append(e)};return};for c in children(e){findWeb(c,depth+1)}}
// The caller selects the exact Tingwu tab and brings its window to the front.
if let windows=attribute(root,kAXWindowsAttribute) as? [AXUIElement],let front=windows.first {findWeb(front)}
guard let web=webAreas.first else {output(["noTab":true,"visited":visited,"webHosts":webHosts,"windows":(attribute(root,kAXWindowsAttribute) as? [AXUIElement])?.count ?? -1]);exit(0)}
var entries:[(AXUIElement,String,String,[String])]=[]
let keywords=["开启实时记录","开始录音","开始记录","结束录音","停止录音","暂停录音","结束","开始","立即登录","新建","登录","麦克风","确定","确认","取消","录音中"]
func walk(_ e:AXUIElement,_ depth:Int=0){if depth>35 || entries.count>200{return};let role=str(e,kAXRoleAttribute);let label=[str(e,kAXTitleAttribute),str(e,kAXDescriptionAttribute),str(e,kAXValueAttribute)].first(where:{!$0.isEmpty}) ?? "";if keywords.contains(label) || ["录音中...","录音中…","暂停中...","暂停中…"].contains(label) || (label.count<70 && label.contains("麦克风权限")){entries.append((e,label,role,actions(e)))};for c in children(e){walk(c,depth+1)}}
walk(web)
let command=CommandLine.arguments.count>1 ? CommandLine.arguments[1]:"scan"
if command=="scan" {output(["url":str(web,kAXURLAttribute),"controls":entries.map{["text":$0.1,"role":$0.2,"actions":$0.3] as [String:Any]}]);exit(0)}
if command=="press",CommandLine.arguments.count>2 {
 let target=CommandLine.arguments[2]
 if CommandLine.arguments.count>3,let deadline=Double(CommandLine.arguments[3]),Date().timeIntervalSince1970*1000>=deadline {output(["error":"已过课前启动时间"]);exit(7)}
 guard ["开启实时记录","开始录音","开始记录"].contains(target) else {output(["error":"只允许点击开始录音入口"]);exit(3)}
 let matches=entries.filter{$0.1==target}
 guard matches.count==1 else {output(["error":"录音按钮缺失或不唯一","count":matches.count]);exit(4)}
 var element=matches[0].0
 for _ in 0..<5 {
  if actions(element).contains(kAXPressAction) {let r=AXUIElementPerformAction(element,kAXPressAction as CFString);output(["clicked":r == .success,"label":target,"result":r.rawValue]);exit(r == .success ? 0:5)}
  guard let parent=attribute(element,kAXParentAttribute),CFGetTypeID(parent)==AXUIElementGetTypeID() else {break}
  element=unsafeBitCast(parent,to:AXUIElement.self)
 }
 output(["error":"按钮不支持辅助功能点击"]);exit(5)
}
output(["error":"未知操作"]);exit(6)
