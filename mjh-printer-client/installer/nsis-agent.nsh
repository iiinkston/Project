; Install / uninstall Agent from electron-builder NSIS (x64).
; Prefer 64-bit PowerShell; ProgramW6432 used inside install/uninstall.ps1.

!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\MJH Printer"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\MJH Printer"
!macroend

!macro customInstall
  DetailPrint "Installing MJH Printer Agent (64-bit Program Files + Task Scheduler)..."
  ; Prefer Sysnative when NSIS is 32-bit; otherwise System32 (64-bit host).
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" use_sysnative use_system32
  use_sysnative:
    nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\install.ps1"'
    Pop $0
    DetailPrint "Agent install.ps1 (sysnative) exit: $0"
    Goto install_done
  use_system32:
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\install.ps1"'
    Pop $0
    DetailPrint "Agent install.ps1 (system32) exit: $0"
  install_done:
!macroend

!macro customUnInstall
  DetailPrint "Stopping Client/Agent before uninstall..."
  nsExec::ExecToLog 'taskkill /IM "MJH Printer Client.exe" /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM MJH-Printer-Agent.exe /F'
  Pop $0
  DetailPrint "Uninstalling MJH Printer Agent (retain ProgramData)..."
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
  ; Belt-and-suspenders: remove Agent dirs + task if script missed
  nsExec::ExecToLog 'schtasks /Delete /TN "MJH Printer Agent" /F'
  Pop $0
  nsExec::ExecToLog 'cmd /c rmdir /s /q "$PROGRAMFILES64\MJH Printer Agent"'
  Pop $0
  nsExec::ExecToLog 'cmd /c rmdir /s /q "$PROGRAMFILES\MJH Printer Agent"'
  Pop $0
!macroend
