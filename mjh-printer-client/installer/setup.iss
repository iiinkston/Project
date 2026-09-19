; MJH Printer Platform — Inno Setup script
; Output: MJH-Printer-Setup.exe
; Requires: Inno Setup 6 (ISCC.exe)
; Build inputs (relative to this file):
;   ..\..\mjh-printer-agent\release\MJH-Printer-Agent.exe
;   ..\..\mjh-printer-agent\release\install.ps1 (+ sibling scripts)
;   ..\..\mjh-printer-agent\release\config\printer.unbound.json
;   ..\dist-client\  (electron-builder unpacked dir OR single Client EXE)

#define MyAppName "MJH Printer"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "满江红"
#define MyAppExeName "MJH Printer Client.exe"
#define AgentProduct "MJH Printer Agent"

[Setup]
AppId={{A7C3E9F1-4B2D-4E8A-9C11-MJHPRINTER01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\MJH Printer
DefaultGroupName=满江红打印助手
DisableProgramGroupPage=yes
OutputDir=..\..\dist-installer
OutputBaseFilename=MJH-Printer-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupLogging=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式「满江红打印助手」"; GroupDescription: "附加任务:"; Flags: checkedonce
Name: "autostart"; Description: "登录后在系统托盘启动打印助手（不弹窗）"; GroupDescription: "附加任务:"; Flags: checkedonce

[Files]
; --- Agent package (install.ps1 will copy EXE to Program Files\MJH Printer Agent) ---
Source: "..\..\mjh-printer-agent\release\MJH-Printer-Agent.exe"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\install.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\update-agent.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\uninstall.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\start.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\stop.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\restart.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\status.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\logs.ps1"; DestDir: "{tmp}\mjh-agent"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\config\*"; DestDir: "{tmp}\mjh-agent\config"; Flags: ignoreversion recursesubdirs createallsubdirs

; Updater copy under MJH Printer\updater
Source: "..\..\mjh-printer-agent\release\update-agent.ps1"; DestDir: "{app}\updater"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\MJH-Printer-Agent.exe"; DestDir: "{app}\updater"; Flags: ignoreversion

; --- Client (electron-builder win-unpacked) ---
Source: "..\release\win-unpacked\*"; DestDir: "{app}\client"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\满江红打印助手"; Filename: "{app}\client\{#MyAppExeName}"
Name: "{autodesktop}\满江红打印助手"; Filename: "{app}\client\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Tray autostart (no window force — Client starts; tray hide is app behavior on close)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "MJHPrinterClient"; ValueData: """{app}\client\{#MyAppExeName}"" --tray"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
; 1) Install Agent via existing install.ps1 (preserves ProgramData config)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\mjh-agent\install.ps1"""; StatusMsg: "正在安装打印服务 (Printer Agent)..."; Flags: runhidden waituntilterminated
; 2) Launch Client
Filename: "{app}\client\{#MyAppExeName}"; Description: "打开满江红打印助手"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsAdminLoggedOn then
  begin
    MsgBox('需要管理员权限安装打印服务。' #13#10 '请右键「以管理员身份运行」。', mbError, MB_OK);
    Result := False;
  end;
end;
