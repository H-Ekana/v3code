!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    # electron-builder preserves an existing Start-menu shortcut during upgrades.
    # Recreate it so its target, embedded icon, and AppUserModelID track the newly
    # installed executable instead of retaining an older cached icon rendition.
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

    # Tell Explorer that shell icon and association data changed. This refreshes
    # Start-menu icon caches without restarting Explorer.
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  !endif
!macroend
