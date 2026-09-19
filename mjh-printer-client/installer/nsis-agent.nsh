; Install Agent after Client files are laid down by electron-builder NSIS.
; Agent package lives in $INSTDIR\resources\agent-release

!macro customInstall
  DetailPrint "Installing MJH Printer Agent (Task Scheduler + ProgramData)..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\agent-release\install.ps1"'
  Pop $0
  DetailPrint "Agent install.ps1 exit: $0"
!macroend

!macro customUnInstall
  DetailPrint "Leaving MJH Printer Agent installed (use Agent uninstall.ps1 to remove)."
!macroend
