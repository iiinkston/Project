; Install / uninstall Agent from electron-builder NSIS (x64).
; Prefer 64-bit PowerShell. Pass $INSTDIR so custom install paths (D:\...) work.

!macro preInit
  SetRegView 64
  ; Default install root (user may still change when allowToChangeInstallationDirectory=true)
  StrCpy $INSTDIR "$PROGRAMFILES64\MJH Printer"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
!macroend

!macro customInstall
  DetailPrint "Installing MJH Printer Agent (64-bit Program Files + Task Scheduler)..."
  DetailPrint "Client INSTDIR=$INSTDIR"
  ; Prefer Sysnative when NSIS is 32-bit; otherwise System32 (64-bit host).
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" use_sysnative use_system32
  use_sysnative:
    nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\install.ps1"'
    Pop $0
    DetailPrint "Agent install.ps1 (sysnative) exit: $0"
    nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\updater\register-client-ota-task.ps1" -ClientInstallDir "$INSTDIR"'
    Pop $1
    DetailPrint "Client OTA task register (sysnative) exit: $1"
    ; Wait Local API healthy, then launch Client in interactive user session (not Session 0).
    nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\updater\launch-client-after-install.ps1" -ClientInstallDir "$INSTDIR"'
    Pop $2
    DetailPrint "Post-install health + Client launch (sysnative) exit: $2"
    Goto install_done
  use_system32:
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\install.ps1"'
    Pop $0
    DetailPrint "Agent install.ps1 (system32) exit: $0"
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\updater\register-client-ota-task.ps1" -ClientInstallDir "$INSTDIR"'
    Pop $1
    DetailPrint "Client OTA task register (system32) exit: $1"
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\updater\launch-client-after-install.ps1" -ClientInstallDir "$INSTDIR"'
    Pop $2
    DetailPrint "Post-install health + Client launch (system32) exit: $2"
  install_done:
  ; Persist the final install root (including user-chosen custom path) for OTA/launch helpers.
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  StrCmp $2 "0" install_ok
  DetailPrint "Post-install failed (exit $2); see ProgramData\MJH Printer Client\logs\installer-start.log"
  IfSilent install_ok
  MessageBox MB_OK|MB_ICONEXCLAMATION "打印服务启动失败。$\r$\n请重新启动电脑后重试，如仍无法使用请联系技术支持。"
  install_ok:
!macroend

!macro customUnInstall
  DetailPrint "Stopping Client/Agent before uninstall..."
  nsExec::ExecToLog 'taskkill /IM "MJH Printer Client.exe" /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM MJH-Printer-Agent.exe /F'
  Pop $0
  DetailPrint "Removing Client/Agent OTA scheduled tasks..."
  nsExec::ExecToLog 'schtasks /Delete /TN "MJH Printer Client Update" /F'
  Pop $0
  nsExec::ExecToLog 'schtasks /Delete /TN "MJH Printer Agent Update" /F'
  Pop $0
  DetailPrint "Uninstalling MJH Printer Agent (retain ProgramData config by default)..."
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" un_sysnative un_system32
  un_sysnative:
    nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\uninstall.ps1"'
    Pop $0
    DetailPrint "Agent uninstall.ps1 (sysnative) exit: $0"
    Goto un_done
  un_system32:
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\uninstall.ps1"'
    Pop $0
    DetailPrint "Agent uninstall.ps1 (system32) exit: $0"
  un_done:
  nsExec::ExecToLog 'schtasks /Delete /TN "MJH Printer Agent" /F'
  Pop $0
  nsExec::ExecToLog 'schtasks /Delete /TN "MJH Printer Agent Update" /F'
  Pop $0
  nsExec::ExecToLog 'schtasks /Delete /TN "MJH Printer Client Update" /F'
  Pop $0
  nsExec::ExecToLog 'cmd /c rmdir /s /q "$PROGRAMFILES64\MJH Printer Agent"'
  Pop $0
  nsExec::ExecToLog 'cmd /c rmdir /s /q "$PROGRAMFILES\MJH Printer Agent"'
  Pop $0
!macroend
