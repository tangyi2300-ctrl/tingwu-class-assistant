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
let command=CommandLine.arguments.count>1 ? CommandLine.arguments[1]:"scan"
let naming=["title-read","title-write"].contains(command)
let expectedURL=naming && CommandLine.arguments.count>2 ? CommandLine.arguments[2]:nil
// Naming must select the exact saved document, even with multiple Chrome windows.
if let windows=attribute(root,kAXWindowsAttribute) as? [AXUIElement] {
 if naming {
  if let focused=attribute(root,kAXFocusedWindowAttribute),CFGetTypeID(focused)==AXUIElementGetTypeID(){findWeb(unsafeBitCast(focused,to:AXUIElement.self))}
  for window in windows {findWeb(window)}
 }
 else if let front=windows.first {findWeb(front)}
}
let chosen=expectedURL == nil ? webAreas.first:webAreas.first(where:{str($0,kAXURLAttribute)==expectedURL!})
guard let web=chosen else {output(["noTab":true]);exit(0)}
if naming {
 guard let expected=expectedURL,let url=URL(string:expected),url.scheme=="https",url.host=="tingwu.aliyun.com",url.path.hasPrefix("/doc/transcripts/") else {output(["error":"只能处理已保存的听悟录音"]);exit(3)}
 var texts:[String]=[]
 var titles:[AXUIElement]=[]
 var inSummary=false
 var finished=false
 func readMetadata(_ e:AXUIElement,_ depth:Int=0){
  if depth>40 || finished || texts.count>1500{return}
  let role=str(e,kAXRoleAttribute)
  let label=[str(e,kAXTitleAttribute),str(e,kAXDescriptionAttribute),str(e,kAXValueAttribute)].first(where:{!$0.isEmpty}) ?? ""
  if !inSummary && role=="AXTextField" && !str(e,kAXValueAttribute).isEmpty {titles.append(e)}
  if role=="AXStaticText" || role=="AXHeading" {
   if ["关键词","全文概要","章节速览"].contains(label){inSummary=true}
   if label=="原文" || label.hasPrefix("智能内容由 AI") {finished=true;return}
   if inSummary && !label.isEmpty {texts.append(String(label.prefix(8000)))}
  }
  if role=="AXTextArea" {return}
  for c in children(e){readMetadata(c,depth+1)}
 }
 readMetadata(web)
 guard titles.count==1 else {output(["error":"无法唯一识别录音标题输入框"]);exit(4)}
 let field=titles[0]
 let oldTitle=str(field,kAXValueAttribute)
 if command=="title-read" {output(["url":str(web,kAXURLAttribute),"title":oldTitle,"summaryTexts":texts]);exit(0)}
 guard CommandLine.arguments.count==5 else {output(["error":"标题参数不完整"]);exit(3)}
 let expectedTitle=CommandLine.arguments[3],newTitle=CommandLine.arguments[4]
 guard oldTitle==expectedTitle else {output(["error":"标题已发生变化，保留当前标题"]);exit(4)}
 guard newTitle.count>=10 && newTitle.count<=100 && !newTitle.contains("\n") else {output(["error":"新标题格式无效"]);exit(3)}
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier else {output(["error":"听悟未在前台，暂停改名"]);exit(4)}
 var writable:DarwinBoolean=false
 guard AXUIElementIsAttributeSettable(field,kAXValueAttribute as CFString,&writable) == .success && writable.boolValue else {output(["error":"听悟标题不可编辑"]);exit(4)}
 guard AXUIElementSetAttributeValue(field,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else {output(["error":"无法聚焦标题输入框"]);exit(4)}
 // React-controlled titles require real input/change/blur events. AXValue
 // alone changes the visible value without reliably saving it on the website.
 func hasTitleFocus(_ value:String)->Bool {
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier,
        let current=attribute(root,kAXFocusedUIElementAttribute),CFGetTypeID(current)==AXUIElementGetTypeID() else {return false}
  var e=unsafeBitCast(current,to:AXUIElement.self)
  guard str(e,kAXRoleAttribute)=="AXTextField",str(e,kAXValueAttribute)==value else {return false}
  for _ in 0..<40 {
   if str(e,kAXRoleAttribute)=="AXWebArea" {return str(e,kAXURLAttribute)==expected}
   guard let p=attribute(e,kAXParentAttribute),CFGetTypeID(p)==AXUIElementGetTypeID() else {return false}
   e=unsafeBitCast(p,to:AXUIElement.self)
  }
  return false
 }
 func waitForTitleFocus(_ value:String)->Bool {
  for _ in 0..<10 {if hasTitleFocus(value){return true};usleep(100000)}
  return false
 }
 func key(_ code:CGKeyCode,_ flags:CGEventFlags=[]){
  for down in [true,false] {
   if let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down){event.flags=flags;event.postToPid(app.processIdentifier)}
  }
 }
 guard waitForTitleFocus(expectedTitle) else {output(["error":"焦点不在本条录音标题，暂停改名"]);exit(4)}
 key(0,.maskCommand) // Select all inside the verified title field.
 usleep(100000)
 guard waitForTitleFocus(expectedTitle) else {output(["error":"标题焦点发生变化，暂停改名"]);exit(4)}
 let characters=Array(newTitle.utf16)
 for down in [true,false] {
  guard let event=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down) else {output(["error":"无法输入新标题"]);exit(4)}
  characters.withUnsafeBufferPointer{event.keyboardSetUnicodeString(stringLength:characters.count,unicodeString:$0.baseAddress!)}
  event.postToPid(app.processIdentifier)
 }
 usleep(250000)
 guard waitForTitleFocus(newTitle) else {output(["error":"输入的新标题未核对通过，暂停提交"]);exit(4)}
 key(48) // Tab blurs the title input and triggers Tingwu's save handler.
 output(["submitted":true]);exit(0)
}
var entries:[(AXUIElement,String,String,[String])]=[]
let keywords=["开启实时记录","开始录音","开始记录","结束录音","停止录音","暂停录音","结束","开始","立即登录","新建","登录","麦克风","确定","确认","取消","录音中"]
func walk(_ e:AXUIElement,_ depth:Int=0){if depth>35 || entries.count>200{return};let role=str(e,kAXRoleAttribute);let label=[str(e,kAXTitleAttribute),str(e,kAXDescriptionAttribute),str(e,kAXValueAttribute)].first(where:{!$0.isEmpty}) ?? "";if keywords.contains(label) || ["录音中...","录音中…","暂停中...","暂停中…"].contains(label) || (label.count<70 && label.contains("麦克风权限")){entries.append((e,label,role,actions(e)))};for c in children(e){walk(c,depth+1)}}
walk(web)
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
