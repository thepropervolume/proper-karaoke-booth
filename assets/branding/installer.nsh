; NSIS uses APP_FILENAME to choose the installation directory. Keep the
; executable name independent for existing shortcuts and CLI launchers.
!undef APP_FILENAME
!define APP_FILENAME "${PRODUCT_NAME}"

!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var boothOptionsMode
Var boothInstallCli
Var boothEnableApi
Var boothCliCheckbox
Var boothApiCheckbox
!endif

!macro customHeader
!ifndef BUILD_UNINSTALLER
; The directory page is already registered. Let the stock install section
; retain existing shortcuts when the selected destination has the old app.
!ifdef allowToChangeInstallationDirectory
  !undef allowToChangeInstallationDirectory
!endif

; Store choices per install scope. Updates that skip the page reuse them.
Function LoadBoothSetupOptions
  ${If} $boothOptionsMode == $installMode
    Return
  ${EndIf}
  StrCpy $boothOptionsMode "$installMode"
  ClearErrors
  ReadRegDWORD $boothInstallCli SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KaraBoothAddCli
  ${If} ${Errors}
    StrCpy $boothInstallCli ${BST_CHECKED}
  ${EndIf}
  ClearErrors
  ReadRegDWORD $boothEnableApi SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KaraBoothEnableApi
  ${If} ${Errors}
    StrCpy $boothEnableApi ${BST_CHECKED}
  ${EndIf}
FunctionEnd

Function ShowBoothSetupOptions
  Call LoadBoothSetupOptions
  !insertmacro MUI_HEADER_TEXT "KaraBooth Setup Options" "Choose how to access KaraBooth from this computer."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 0 100% 14u "Add karabooth-cli to PATH"
  Pop $boothCliCheckbox
  ${NSD_SetState} $boothCliCheckbox $boothInstallCli
  ${NSD_CreateLabel} 12u 17u 90% 23u "Run karabooth-cli from a new terminal after setup."
  Pop $0
  ${NSD_CreateCheckbox} 0 47u 100% 14u "Enable the local API for new profiles"
  Pop $boothApiCheckbox
  ${NSD_SetState} $boothApiCheckbox $boothEnableApi
  ${NSD_CreateLabel} 12u 64u 90% 38u "Allow authenticated status and settings commands from this computer. Existing profiles keep their settings. You can change this later in Preferences."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function SaveBoothSetupOptions
  ${NSD_GetState} $boothCliCheckbox $boothInstallCli
  ${NSD_GetState} $boothApiCheckbox $boothEnableApi
FunctionEnd
!endif
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to KaraBooth Setup"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  Call LoadBoothSetupOptions
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
  Page custom ShowBoothSetupOptions SaveBoothSetupOptions
  !define MUI_FINISHPAGE_RUN_TEXT "Launch KaraBooth"
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
  ; Recover a missing Start entry while retaining the existing link in-place.
  ${IfNot} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ${If} ${FileExists} "$newStartMenuLink"
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      System::Call "shell32::SHChangeNotify(i0x2,i5,w '$newStartMenuLink',p0)"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$newStartMenuLink"
    System::Store S
    StrCpy $3 "$newStartMenuLink"
    StrCpy $4 "KaraBooth; TPV; Proper; Proper Volume; The Proper Volume; Karaoke; Karaoke App; Host; Booth; Karaoke Booth; Karaoke Host; Karaoke Player; CDG; LRC; Karaoke Nerds; YouTube"
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
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KaraBoothAddCli $boothInstallCli
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KaraBoothEnableApi $boothEnableApi
  ${If} $boothEnableApi == ${BST_CHECKED}
    ClearErrors
    FileOpen $0 "$INSTDIR\resources\tpv-booth-local-api-default" w
    ${IfNot} ${Errors}
      FileClose $0
    ${EndIf}
  ${EndIf}
  ${If} $boothInstallCli == ${BST_CHECKED}
    StrCpy $1 "--register-windows-path"
    ${If} $installMode == "all"
      StrCpy $1 "--register-windows-path-machine"
    ${EndIf}
    nsExec::ExecToLog /TIMEOUT=10000 '"$INSTDIR\karabooth-cli.exe" $1'
    Pop $0
    ${If} $0 != "0"
      DetailPrint "KaraBooth was installed, but the CLI could not be added to PATH."
      MessageBox MB_OK|MB_ICONEXCLAMATION "The CLI could not be added to PATH. Use Preferences > Local API and CLI to set up the command for your account." /SD IDOK
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  StrCpy $1 "--unregister-windows-path"
  ${If} $installMode == "all"
    StrCpy $1 "--unregister-windows-path-machine"
  ${EndIf}
  IfFileExists "$INSTDIR\karabooth-cli.exe" 0 +3
  nsExec::ExecToLog /TIMEOUT=10000 '"$INSTDIR\karabooth-cli.exe" $1'
  Pop $0
!macroend
