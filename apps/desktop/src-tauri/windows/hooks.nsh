; Ganchos do instalador NSIS (bundle > windows > nsis > installerHooks).
;
; A v0.1 se chamava "Tabula RPG". O instalador do Tauri escolhe a pasta e a entrada em
; "Aplicativos instalados" pelo nome do produto, então instalar a v0.2+ ("Tabularium")
; deixava a v0.1 instalada ao lado, com o próprio desinstalador. Os dois apps usam a MESMA
; pasta de dados (ela vem do identificador, que não mudou): desinstalar o antigo marcando
; "excluir dados do aplicativo" apagaria as fichas da versão nova.
;
; Aqui removemos os restos da v0.1: executável, desinstalador, atalhos e a entrada no
; registro. NUNCA a pasta de dados ($LOCALAPPDATA\<identificador>), nem nada recursivo.

!define OLD_PRODUCTNAME "Tabula RPG"
!define OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLD_PRODUCTNAME}"

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R8 SHCTX "${OLD_UNINSTKEY}" "InstallLocation"
  ${If} $R8 != ""
    ; O Tauri grava o caminho entre aspas.
    StrCpy $R9 $R8 1
    ${If} $R9 == '"'
      StrCpy $R8 $R8 "" 1
      StrCpy $R8 $R8 -1
    ${EndIf}

    ; Só a instalação antiga, nunca a atual (mesma pasta seria um caminho personalizado).
    ${If} $R8 != $INSTDIR
      ReadRegStr $R9 SHCTX "${OLD_UNINSTKEY}" "MainBinaryName"
      ${If} $R9 == ""
        StrCpy $R9 "tabula-desktop.exe"
      ${EndIf}
      Delete "$R8\$R9"
      Delete "$R8\uninstall.exe"
      ; Só apaga a pasta se ficou vazia.
      RMDir "$R8"
    ${EndIf}

    Delete "$SMPROGRAMS\${OLD_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${OLD_PRODUCTNAME}.lnk"
    DeleteRegKey SHCTX "${OLD_UNINSTKEY}"
  ${EndIf}
!macroend
