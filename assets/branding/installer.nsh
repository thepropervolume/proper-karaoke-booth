!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  StrCpy $1 "--register-windows-path"
  ${If} $installMode == "all"
    StrCpy $1 "--register-windows-path-machine"
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=10000 '"$INSTDIR\tpv-karaoke-booth.exe" $1'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "Karaoke Booth was installed, but the CLI could not be added to PATH."
    MessageBox MB_OK|MB_ICONEXCLAMATION "The CLI could not be added to PATH. Use Preferences > Local API and CLI to set up the command for your account." /SD IDOK
  ${EndIf}
!macroend

!macro customUnInstall
  StrCpy $1 "--unregister-windows-path"
  ${If} $installMode == "all"
    StrCpy $1 "--unregister-windows-path-machine"
  ${EndIf}
  IfFileExists "$INSTDIR\tpv-karaoke-booth.exe" 0 +3
  nsExec::ExecToLog /TIMEOUT=10000 '"$INSTDIR\tpv-karaoke-booth.exe" $1'
  Pop $0
!macroend
