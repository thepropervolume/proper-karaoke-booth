; NSIS uses APP_FILENAME to choose the installation directory. Keep the
; executable name independent for existing shortcuts and CLI launchers.
!undef APP_FILENAME
!define APP_FILENAME "${PRODUCT_NAME}"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; A silent first install defaults to Program Files. Deploy it from an
  ; elevated process, or use /currentuser for an unattended per-user install.
  ${If} ${Silent}
  ${AndIf} $installMode == "all"
  ${AndIf} $hasPerMachineInstallation == "0"
  ${AndIfNot} ${UAC_IsAdmin}
    SetErrorLevel 740
    Quit
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  ; The stock directory-page callback appends APP_FILENAME to a path without
  ; that folder name. Bypass it for an existing registered install directory.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE boothInstFilesPre
  Function boothInstFilesPre
    Push $0
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 == ""
    ${OrIf} $0 != $INSTDIR
      Call instFilesPre
    ${EndIf}
    Pop $0
  FunctionEnd
!macroend

; Update the existing Start shortcut in place so upgrades preserve its identity.
!macro UpdateStartMenuSearchTerms
  ${If} ${FileExists} "$newStartMenuLink"
    System::Store S
    StrCpy $3 "$newStartMenuLink"
    StrCpy $4 "TPV; Proper; Proper Volume; The Proper Volume; Karaoke; Karaoke App; Host; Booth; Karaoke Booth; Karaoke Host; Karaoke Player; CDG; LRC; Karaoke Nerds; YouTube"
    ; IShellLinkW and IPersistFile work on the original .lnk, including its AUMID.
    System::Call "ole32::CoCreateInstance(g'{00021401-0000-0000-C000-000000000046}',p0,i1,g'{000214F9-0000-0000-C000-000000000046}',*p.r1)i.r0"
    ${If} $0 = 0
      System::Call "$1->0(g'{0000010B-0000-0000-C000-000000000046}',*p.r2)i.r0"
      ${If} $0 = 0
        System::Call "$2->5(w r3,i2)i.r0"
        ${If} $0 = 0
          System::Call "$1->7(w r4)i.r0"
          ${If} $0 = 0
            System::Call "$2->6(w r3,i1)i.r0"
          ${EndIf}
        ${EndIf}
        System::Call "$2->2()"
      ${EndIf}
      System::Call "$1->2()"
    ${EndIf}
    ${If} $0 = 0
      System::Call "shell32::SHChangeNotify(i0x2000,i5,w r3,p0)"
    ${Else}
      DetailPrint "Could not update Booth Start menu search metadata ($0)."
    ${EndIf}
    System::Store L
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro UpdateStartMenuSearchTerms
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\tpv-booth-installed" w
  ${IfNot} ${Errors}
    FileClose $0
  ${EndIf}
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
