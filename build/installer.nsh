; Nova Client — personalización del asistente de instalación (NSIS).
; electron-builder carga este archivo automáticamente desde build/installer.nsh.

; ── Página final: "Ejecutar Nova Client" + "Crear acceso directo en el escritorio" ──
; Se definen las dos casillas: "Ejecutar Nova Client" y "Crear acceso directo".
!macro customFinishPage
  ; Al usar customFinishPage, electron-builder NO define la casilla "Ejecutar": hay que definirla acá.
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function NovaCrearAccesoDirecto
    CreateShortCut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Ejecutar Nova Client"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Crear acceso directo en el escritorio"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION NovaCrearAccesoDirecto
  !insertmacro MUI_PAGE_FINISH
!macroend

; ── Al desinstalar, borra también el acceso directo del escritorio ──
!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
!macroend
