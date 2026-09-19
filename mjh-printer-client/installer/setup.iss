; MJH Printer Platform — Inno Setup script
; Output: dist\MJH Printer Setup.exe
; Requires: Inno Setup 6 (ISCC.exe)
; Build inputs (relative to this file):
;   ..\..\mjh-printer-agent\release\MJH-Printer-Agent.exe (+ scripts)
;   ..\..\dist\client-build\win-unpacked\  (electron-builder --dir)

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
OutputDir=..\..\dist
OutputBaseFilename=MJH Printer Setup
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
; --- Agent package (install.ps1 → Program Files\MJH Printer Agent) ---
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

; Staged updater package (for Local API POST /local/update)
Source: "..\..\mjh-printer-agent\release\update-agent.ps1"; DestDir: "{app}\updater"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\MJH-Printer-Agent.exe"; DestDir: "{app}\updater"; Flags: ignoreversion
Source: "..\..\mjh-printer-agent\release\BUILD.txt"; DestDir: "{app}\updater"; Flags: ignoreversion skipifsourcedoesntexist

; --- Client → C:\Program Files\MJH Printer\ ---
Source: "..\..\dist\client-build\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\满江红打印助手"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\满江红打印助手"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "MJHPrinterClient"; ValueData: """{app}\{#MyAppExeName}"" --tray"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
; 1) Install Agent (Task Scheduler + ProgramData preserved)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\mjh-agent\install.ps1"""; StatusMsg: "正在安装打印服务 (Printer Agent)..."; Flags: runhidden waituntilterminated
; 2) Launch Client Wizard
Filename: "{app}\{#MyAppExeName}"; Description: "打开满江红打印助手"; Flags: nowait postinstall skipifsilent

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
