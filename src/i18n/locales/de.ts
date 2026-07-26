/**
 * Deutsche Übersetzungen. Entspricht dem bisherigen (deutschen) UI-Text des
 * Plugins. Fehlende Schlüssel fallen automatisch auf Englisch (en.ts) zurück.
 */

import type { Messages } from "./en";

export const de: Partial<Messages> = {
  // ---- Commands / Ribbon ----
  ribbonSyncTooltip: "Google Drive Mirror: Jetzt synchronisieren",
  commandSyncNow: "Jetzt synchronisieren",
  commandLogin: "Mit Google anmelden",

  // ---- Statusleiste ----
  statusBarReady: "Drive: bereit",
  statusBarRunning: "Drive: {message}",
  statusBarDone: "Drive: {message}",
  statusBarError: "Drive: {message}",
  statusBarTooltip: "Google Drive Mirror — klicken zum Synchronisieren",

  // ---- Notices ----
  noticeSyncAlreadyRunning: "Google Drive Mirror: Ein Sync läuft bereits…",
  noticeSignInFirst:
    "Google Drive Mirror: Bitte zuerst in den Einstellungen anmelden.",
  noticeLoginSuccess:
    "Google Drive Mirror: Anmeldung erfolgreich, Token gespeichert.",
  noticeNoTargets:
    "Google Drive Mirror: Noch kein Sync-Ziel konfiguriert. Bitte in den Einstellungen eines hinzufügen.",

  // ---- Einstellungen: Überschriften & Google Cloud ----
  settingsTitle: "Google Drive Mirror",
  headingCloudAccess: "1. Google-Cloud-Zugang",
  cloudHelp:
    "Lege in der Google Cloud Console eine OAuth-Client-ID vom Typ „Desktop-App“ an, aktiviere die Google Drive API und trage Client-ID und -Secret hier ein. Details in der README.",
  clientIdName: "Client-ID",
  clientIdDesc: "OAuth-2.0-Client-ID deiner Google-Cloud-App.",
  clientSecretName: "Client-Secret",
  clientSecretDesc: "OAuth-2.0-Client-Secret deiner Google-Cloud-App.",
  loginName: "Anmeldung",
  loginDescSignedIn:
    "✅ Angemeldet. Erneut anmelden, falls der Zugriff widerrufen wurde.",
  loginDescSignedOut: "Nicht angemeldet.",
  loginDescSignedOutMobile:
    "Nicht angemeldet. Melde dich zuerst am Desktop an, kopiere dort den Token und füge ihn unten ein.",
  loginButtonReauth: "Erneut anmelden",
  loginButtonSignIn: "Mit Google anmelden",
  loginFailed: "Anmeldung fehlgeschlagen: {error}",
  logoutTooltip: "Abmelden (Token löschen)",
  tokenCopyName: "Anmelde-Token kopieren (für Mobilgeräte)",
  tokenCopyDesc:
    "Kopiert deinen Anmelde-Token, damit du ihn in Obsidian auf dem Handy oder Tablet einfügen kannst — dort ist keine direkte Anmeldung möglich.",
  tokenCopyButton: "Anmelde-Token kopieren",
  tokenCopied:
    "Anmelde-Token kopiert. Füge ihn in Obsidian auf deinem anderen Gerät ein.",
  tokenCopyManual: "Kopiere diesen Anmelde-Token: {token}",
  tokenImportSummary: "Mit einem Token von einem anderen Gerät anmelden",
  tokenImportHelp:
    "Auf Mobilgeräten ist keine direkte Anmeldung möglich. Melde dich am Desktop an, tippe dort auf „Anmelde-Token kopieren“ und füge ihn hier ein.",
  tokenImportName: "Anmelde-Token",
  tokenImportDesc:
    "Füge den Token ein, den du von einem angemeldeten Desktop kopiert hast. Erfordert dieselbe Client-ID und dasselbe Secret oben.",
  tokenImportPlaceholder: "Anmelde-Token einfügen",
  tokenImportButton: "Mit Token anmelden",
  tokenImportNoInput: "Füge zuerst den Anmelde-Token ein.",

  // ---- Einstellungen: Sync-Ziele ----
  headingTargets: "2. Sync-Ziele",
  targetsHelp:
    "Jedes Ziel synchronisiert einen lokalen (Unter-)Ordner mit einem Google-Drive-Ordner. Ein Ganz-Vault-Ziel schließt die lokalen Ordner der anderen Ziele automatisch aus, damit ein Unterordner nie in zwei Drives gleichzeitig landet.",
  targetsEmpty: "Noch kein Sync-Ziel. Unten eines hinzufügen.",
  targetAddButton: "Sync-Ziel hinzufügen",
  targetDefaultName: "Ziel {index}",
  targetNameName: "Name",
  targetNameDesc: "Ein Label für dieses Ziel (nur hier sichtbar).",
  targetNamePlaceholder: "z.B. Arbeitsnotizen",
  targetRemoveTooltip:
    "Dieses Ziel entfernen (Dateien bleiben, Sync-Base wird verworfen)",
  excludeFoldersName: "Ausgeschlossene Ordner",
  excludeFoldersDesc:
    "Kommagetrennte, vault-relative Ordner, die von diesem Ziel ausgeschlossen werden (zusätzlich zu den anderen Zielen, die automatisch ausgeschlossen werden). Gilt für beide Seiten. Leer = nichts zusätzlich.",
  excludeFoldersPlaceholder: "Archiv, Privat/Journal",

  // ---- Einstellungen: Ordner ----
  headingFolders: "2. Ordner",
  syncWholeVaultName: "Gesamten Vault synchronisieren",
  syncWholeVaultDesc:
    "Ein: alle Dateien des Vaults werden synchronisiert (außer dem .obsidian-Konfigurationsordner). Aus: nur ein ausgewählter Unterordner. Nur ein Ziel kann das ganze Vault synchronisieren.",
  syncWholeVaultLocked:
    "Nur ein Ziel kann das ganze Vault synchronisieren — „{name}“ tut das bereits. Wähle für dieses Ziel einen Unterordner.",
  localFolderName: "Lokaler Vault-Ordner",
  localFolderDescSet: "Vault-relativer Unterordner, der synchronisiert wird.",
  localFolderDescEmpty:
    "⚠️ Bitte einen Ordner wählen — ohne Auswahl wird nicht synchronisiert.",
  localFolderPlaceholder: "z.B. Notes/Sync",
  driveFolderName: "Google-Drive-Ordner",
  driveFolderDescSet: "Aktuell: „{name}“",
  driveFolderDescEmpty: "Noch kein Ordner gewählt.",
  driveFolderPlaceholderReady: "Tippen, um Drive-Ordner zu suchen…",
  driveFolderPlaceholderNotReady: "Erst anmelden, dann Ordner suchen",
  driveFolderCheckButton: "Prüfen",
  sharedDriveSuffix: " (Shared Drive)",
  driveFolderFound: "Ordner gefunden: „{name}“{location}",
  driveFolderInvalid: "Ordner ungültig: {error}",
  driveFolderCreateTooltip: "Neuen Drive-Ordner „Obsidian“ anlegen",
  driveFolderCreated: "Ordner „{name}“ angelegt.",
  driveFolderCreateFailed: "Konnte Ordner nicht anlegen: {error}",

  // ---- Einstellungen: Dateifilter & Löschverhalten ----
  allowedExtensionsName: "Erlaubte Dateiendungen",
  allowedExtensionsDesc:
    "Kommagetrennt, ohne Punkt (z.B. „md, png, jpg, pdf“). Leer = alle Dateitypen. Google-Docs/Sheets/Slides werden immer übersprungen, da sie nicht als Binärdatei herunterladbar sind.",
  allowedExtensionsPlaceholder: "md, png, jpg, pdf",
  ignorePatternsName: "Ignorier-Muster",
  ignorePatternsDesc:
    "Kommagetrennte Liste von Dateien/Ordnern, die vom Sync ausgeschlossen werden — ohne Anführungszeichen. Erlaubt reine Endungen (tmp, .log) und Glob-Muster (*.tmp, drafts/*, **/node_modules/**). Pfade sind relativ zum Sync-Ordner. Gilt für beide Seiten. Leer = nichts ignorieren.",
  ignorePatternsPlaceholder: "*.tmp, .DS_Store, drafts/*",
  neverDeleteRemoteName: "Do not delete in Google Drive",
  neverDeleteRemoteDesc:
    "Wenn aktiv, wird eine lokal gelöschte Datei NICHT aus Google Drive entfernt. Die Datei bleibt in Drive und kommt lokal nicht zurück. Über „Nur in Drive“ unten kannst du einzelne Dateien wieder lokal herunterladen lassen. Standard: aus.",
  syncGoogleDocsName: "Google Docs & Sheets synchronisieren (nur Ansicht)",
  syncGoogleDocsDesc:
    "Erstellt pro Google Doc und Sheet eine kleine Notiz, die den Live-Google-Editor einbettet (auf dem Desktop bearbeitbar; auf dem Handy extern geöffnet). Die Datei selbst wird nicht heruntergeladen und nie zurück hochgeladen. Standard: aus.",

  // ---- Google-Docs/Sheets-Einbettung ----
  gdocOpenInDrive: "In Google Docs öffnen",
  gsheetOpenInDrive: "In Google Sheets öffnen",
  gdocInvalidBlock: "Ungültige Google-Datei-Einbettung (Dokument-ID fehlt).",

  // ---- Einstellungen: Auto-Sync ----
  headingAutoSync: "3. Automatischer Sync",
  autoSyncEnabledName: "Auto-Sync aktivieren",
  autoSyncEnabledDesc:
    "Lädt lokale Änderungen kurz nach dem Speichern hoch und pollt Drive im Intervall.",
  pollIntervalName: "Drive-Poll-Intervall (Sekunden)",
  pollIntervalDesc: "Wie oft Drive auf Änderungen geprüft wird (Minimum 15).",
  localDebounceName: "Verzögerung nach lokaler Änderung (ms)",
  localDebounceDesc:
    "Debounce, um schnelle aufeinanderfolgende Speicherungen zu bündeln.",
  logRetentionName: "Log-Aufbewahrung (Stunden)",
  logRetentionDesc:
    "Log-Einträge, die älter sind, werden automatisch gelöscht. 0 = nie automatisch löschen.",
  debugLoggingName: "Debug-Logging",
  debugLoggingDesc:
    "Schreibt ausführliche Info-Meldungen in die Developer-Console. Nur zur Fehlersuche aktivieren.",
  batchEnabledName: "In Stapeln synchronisieren",
  batchEnabledDesc:
    "Verarbeitet eine große Synchronisierung in Stapeln und setzt fort, bis alles fertig ist — hält den Speicher begrenzt (auf Mobilgeräten empfohlen). Ausschalten, um alles in einem Durchgang zu synchronisieren — schneller auf leistungsfähigen Geräten, kann aber eine sehr große Synchronisierung auf dem Mobilgerät zum Absturz bringen.",
  batchSizeName: "Stapelgröße",
  batchSizeDesc:
    "Maximale Dateiübertragungen pro Durchlauf vor dem Fortsetzen (50–2000). Höher bedeutet weniger Durchläufe, aber mehr Speicher pro Durchlauf. Standard 400.",

  // ---- Einstellungen: Aktionen & Status ----
  headingActionsStatus: "4. Aktionen & Status",
  syncNowName: "Jetzt synchronisieren",
  lastSyncDesc: "Letzter Sync: {time}",
  neverSyncedDesc: "Noch kein Sync durchgeführt.",
  syncStartButton: "Sync starten",
  syncRunningButton: "Sync läuft…",
  syncLogName: "Sync-Log",
  syncLogDesc: "Vollständiges, live aktualisiertes Protokoll der Sync-Aktionen.",
  showLogButton: "Log anzeigen",
  clearLogTooltip: "Log leeren",
  resetSyncStateName: "Sync-Zustand zurücksetzen",
  resetSyncStateDesc:
    "Löscht die interne Sync-Historie (nicht deine Dateien). Nützlich bei Inkonsistenzen. Beim nächsten Sync werden alle Dateien neu abgeglichen.",
  resetButton: "Zurücksetzen",
  resetSyncStateNotice: "Sync-Zustand zurückgesetzt.",

  // ---- Einstellungen: Sync-Baum ----
  syncTreeName: "Sync-Baum",
  syncTreeDesc:
    "Alle synchronisierten Ordner und Dateien. Die Checkbox zeigt, ob ein Eintrag lokal vorhanden ist. Einträge, die nur in Google Drive gehalten werden (lokal gelöscht, aber behalten), sind nicht angehakt — anhaken, um sie beim nächsten Sync wieder lokal herzustellen. Aktuell nur in Drive: {count}.",
  syncTreeCheckboxTitle: "Häkchen entfernen, um lokal wiederherzustellen",
  syncTreeCheckboxLocalTitle: "Lokal und in Google Drive vorhanden",
  syncTreeCheckboxRestoreTitle: "Nur in Google Drive — anhaken, um lokal wiederherzustellen",
  syncTreeColName: "Name",
  syncTreeColLocal: "Lokal",
  syncTreeColIgnored: "Ignoriert",
  syncTreeCheckboxIgnoredTitle:
    "Durch die Filter dieses Ziels ausgeschlossen (Ignorier-Muster, Erweiterungs-Whitelist oder ausgeschlossene Ordner)",
  syncTreeCheckboxNotIgnoredTitle: "Nicht durch die Filter dieses Ziels ausgeschlossen",
  syncTreeRestored: "„{path}“ wird beim nächsten Sync wieder hergestellt.",
  syncTreeRefresh: "Baum aktualisieren",
  syncTreeEmpty: "Noch nichts synchronisiert.",
  syncTreeFilterPlaceholder: "Nach Name oder Pfad filtern…",
  syncTreeNoMatch: "Keine Einträge passen zum Filter.",

  // ---- Live-Statuszeile ----
  statusLineReady: "Bereit.",
  statusLineRunning: "{message} · {secs}s",
  statusLineDone: "{message}",
  statusLineError: "{message}",

  // ---- Log-Modal ----
  logModalTitle: "Google Drive Mirror — Log",
  logModalClearButton: "Log leeren",
  logModalCount: "{count} Einträge",
  logModalEmpty: "Noch keine Einträge.",

  // ---- Sync-Status-Defaults ----
  statusReady: "Bereit",
  statusSyncStarted: "Sync gestartet…",

  // ---- Sync-Engine: Phasen & Meldungen ----
  engineNoDriveFolder: "Google Drive Mirror: Kein Drive-Ordner konfiguriert.",
  engineReadingLocal: "Lese lokale Dateien…",
  engineFetchingDrive: "Rufe Google Drive ab…",
  engineFetchingDriveProgress:
    "Rufe Google Drive ab… {folders} Ordner, {files} Dateien",
  engineDuplicateSameContent:
    "Mehrere inhaltsgleiche Drive-Dateien „{path}“ — eine gewählt.",
  engineDuplicateDifferent:
    "Mehrere unterschiedliche Drive-Dateien mit gleichem Pfad „{path}“ — übersprungen. Bitte in Drive das Duplikat entfernen/umbenennen.",
  engineDuplicateFolder:
    "Mehrere Drive-Ordner mit gleichem Pfad „{path}“ — übersprungen. Bitte in Drive das Duplikat entfernen/umbenennen.",
  engineCountSummary:
    "{localFiles} lokale · {remoteFiles} Drive-Dateien, {localFolders}/{remoteFolders} Ordner",
  engineNoChanges: "Keine Änderungen zu übertragen.",
  engineBatchLimited:
    "Große Synchronisierung: {batch} von {total} in diesem Durchlauf; der Rest folgt bei der nächsten Synchronisierung.",
  engineBatchMore:
    "{done} von {total} synchronisiert. Synchronisierung erneut starten, um den Rest fortzusetzen.",
  engineActionError: "{type} „{path}“: {error}",
  engineActionDone: "{action} ✓",
  engineRemoteFolderNotDeleted:
    "Drive-Ordner „{path}“ nicht gelöscht: enthält noch Dateien (Schutz vor Teilbaum-Verlust).",
  engineSyncFailed: "Sync fehlgeschlagen: {error}",
  engineNoticePrefix: "Google Drive Mirror: {message}",
  engineRemoteFolderCreated: "Drive-Ordner „{path}“ angelegt ✓",
  engineLocalFolderCreated: "Lokaler Ordner „{path}“ angelegt ✓",
  engineRemoteFolderDeleted: "Drive-Ordner „{path}“ gelöscht ✓",
  engineLocalFolderDeleted: "Lokaler Ordner „{path}“ gelöscht ✓",
  engineFolderKeptRemote: "Ordner lokal gelöscht, in Drive behalten „{path}“",

  // ---- Sync-Engine: Aktionsbeschreibungen ----
  uploadAction: "Hochladen „{path}“",
  downloadAction: "Herunterladen „{path}“",
  deleteLocalAction: "Lokal löschen „{path}“",
  deleteRemoteAction: "In Drive löschen „{path}“",
  keepRemoteDropLocalAction: "Lokal gelöscht, in Drive behalten „{path}“",
  conflictAction: "Konflikt „{path}“ ({winner} gewinnt)",
  conflictWinnerLocal: "lokal",
  conflictWinnerRemote: "Drive",

  // ---- Sync-Engine: Ergebniszeile ----
  summaryUploaded: "{count} hoch",
  summaryDownloaded: "{count} runter",
  summaryDeletedRemote: "{count} in Drive gelöscht",
  summaryDeletedLocal: "{count} lokal gelöscht",
  summaryConflicts: "{count} Konflikte",
  summaryNoChanges: "keine Änderungen",
  summaryDoneWithErrors: "Fertig mit {count} Fehler(n): {head}",
  summaryDone: "Fertig: {head}",

  // ---- Sync-Engine: finale Notice ----
  noticeDeletedRemote: "Drive {count}",
  noticeDeletedLocal: "lokal {count}",
  noticeErrorMore: "\n…und {count} weitere",
  noticeErrorTail:
    "\n⚠ {count} Fehler (Details in der Console):\n{shown}{more}",
  noticeSummary: "Google Drive Mirror: {head}{errTail}",

  // ---- OAuth-Fehler ----
  oauthCredentialsMissing:
    "Client-ID und Client-Secret müssen zuerst in den Einstellungen gesetzt werden.",
  oauthNoRefreshToken:
    "Google hat keinen Refresh-Token zurückgegeben. Bitte den App-Zugriff unter https://myaccount.google.com/permissions widerrufen und erneut anmelden (prompt=consent erzwingt einen neuen Refresh-Token).",
  oauthNotSignedIn:
    "Google Drive Mirror ist nicht angemeldet (kein Refresh-Token).",
  oauthTokenRefreshFailed:
    "Token-Erneuerung fehlgeschlagen ({status}): {text}. Ggf. ist der Refresh-Token abgelaufen — bitte neu anmelden.",
  oauthPageSuccess: "Anmeldung erfolgreich",
  oauthPageFailure: "Anmeldung fehlgeschlagen",
  oauthPageClose:
    "Du kannst dieses Fenster schließen und zu Obsidian zurückkehren.",
  oauthError: "OAuth-Fehler: {error}",
  oauthNoCode: "Kein Auth-Code empfangen.",
  oauthStateMismatch: "State stimmt nicht überein (CSRF-Schutz).",
  oauthTimeout: "Zeitüberschreitung bei der Anmeldung (5 Minuten).",
  oauthCodeExchangeFailed: "Code-Austausch fehlgeschlagen ({status}): {text}",
  oauthLoopbackDesktopOnly:
    "Die Loopback-Anmeldung ist nur am Desktop verfügbar.",
  oauthImportEmpty: "Kein Token eingegeben.",

  // ---- Suggester ----
  suggestWholeVault: "/ (gesamter Vault)",
  suggestSharedDriveBadge: "  · Shared Drive",

  // ---- Drive-Client ----
  driveNotAFolder: "Die angegebene ID ist kein Ordner.",
  driveApiFailed: "Drive-API \"{action}\" fehlgeschlagen ({status}): {text}",
  driveActionListFiles: "Dateiliste abrufen",
  driveActionDownloadFile: "Datei herunterladen",
  driveActionCreateFile: "Datei erstellen",
  driveActionSearchSubfolder: "Unterordner suchen",
  driveActionCreateSubfolder: "Unterordner erstellen",
  driveActionUpdateFile: "Datei aktualisieren",
  driveActionTrashFile: "Datei in Papierkorb verschieben",
  driveActionCheckFolder: "Ordner prüfen",
  driveActionSearchFolder: "Ordner suchen",
  driveActionCreateFolder: "Ordner erstellen",
};
