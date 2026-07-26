/**
 * Traductions françaises. Les clés manquantes reviennent automatiquement
 * à l'anglais (en.ts).
 */

import type { Messages } from "./en";

export const fr: Partial<Messages> = {
  // ---- Commandes / Ruban ----
  ribbonSyncTooltip: "Google Drive Mirror : Synchroniser maintenant",
  commandSyncNow: "Synchroniser maintenant",
  commandLogin: "Se connecter avec Google",

  // ---- Barre d'état ----
  statusBarReady: "Drive : prêt",
  statusBarRunning: "Drive: {message}",
  statusBarDone: "Drive : {message}",
  statusBarError: "Drive : {message}",
  statusBarTooltip: "Google Drive Mirror — cliquez pour synchroniser",

  // ---- Notifications ----
  noticeSyncAlreadyRunning:
    "Google Drive Mirror : Une synchronisation est déjà en cours…",
  noticeSignInFirst:
    "Google Drive Mirror : Veuillez d'abord vous connecter dans les paramètres.",
  noticeLoginSuccess: "Google Drive Mirror : Connecté, jeton enregistré.",
  noticeNoTargets:
    "Google Drive Mirror : Aucune cible de synchronisation configurée. Ajoutez-en une dans les paramètres.",

  // ---- Paramètres : titres & Google Cloud ----
  settingsTitle: "Google Drive Mirror",
  headingCloudAccess: "1. Accès à Google Cloud",
  cloudHelp:
    "Dans la Google Cloud Console, créez un ID client OAuth de type « Application de bureau », activez l'API Google Drive et saisissez ici l'ID client et le secret. Détails dans le README.",
  clientIdName: "ID client",
  clientIdDesc: "ID client OAuth 2.0 de votre application Google Cloud.",
  clientSecretName: "Secret client",
  clientSecretDesc:
    "Secret client OAuth 2.0 de votre application Google Cloud.",
  loginName: "Connexion",
  loginDescSignedIn:
    "✅ Connecté. Reconnectez-vous si l'accès a été révoqué.",
  loginDescSignedOut: "Non connecté.",
  loginDescSignedOutMobile:
    "Non connecté. Connectez-vous d'abord sur ordinateur, puis copiez-y le jeton et collez-le ci-dessous.",
  loginButtonReauth: "Se reconnecter",
  loginButtonSignIn: "Se connecter avec Google",
  loginFailed: "Échec de la connexion : {error}",
  logoutTooltip: "Se déconnecter (supprimer le jeton)",
  tokenCopyName: "Copier le jeton de connexion (pour mobile)",
  tokenCopyDesc:
    "Copie votre jeton de connexion pour le coller dans Obsidian sur votre téléphone ou tablette, qui ne peut pas se connecter directement.",
  tokenCopyButton: "Copier le jeton",
  tokenCopied:
    "Jeton de connexion copié. Collez-le dans Obsidian sur votre autre appareil.",
  tokenCopyManual: "Copiez ce jeton de connexion : {token}",
  tokenImportSummary: "Se connecter avec un jeton d'un autre appareil",
  tokenImportHelp:
    "Sur mobile, vous ne pouvez pas vous connecter directement. Connectez-vous sur ordinateur, appuyez sur « Copier le jeton », puis collez-le ici.",
  tokenImportName: "Jeton de connexion",
  tokenImportDesc:
    "Collez le jeton copié depuis un ordinateur connecté. Nécessite le même ID client et secret ci-dessus.",
  tokenImportPlaceholder: "Collez le jeton de connexion",
  tokenImportButton: "Se connecter avec le jeton",
  tokenImportNoInput: "Collez d'abord le jeton de connexion.",

  // ---- Paramètres : dossiers ----
  // ---- Paramètres : cibles de synchronisation ----
  headingTargets: "2. Cibles de synchronisation",
  targetsHelp:
    "Chaque cible synchronise un (sous-)dossier local avec un dossier Google Drive. Une cible « tout le coffre » exclut automatiquement les dossiers locaux des autres cibles, afin qu'un sous-dossier ne soit jamais copié dans deux Drive à la fois.",
  targetsEmpty: "Aucune cible pour l'instant. Ajoutez-en une ci-dessous.",
  targetAddButton: "Ajouter une cible",
  targetDefaultName: "Cible {index}",
  targetNameName: "Nom",
  targetNameDesc: "Un libellé pour cette cible (affiché ici uniquement).",
  targetNamePlaceholder: "p. ex. Notes de travail",
  targetRemoveTooltip:
    "Supprimer cette cible (conserve les fichiers, réinitialise la base de synchronisation)",
  excludeFoldersName: "Dossiers exclus",
  excludeFoldersDesc:
    "Liste de dossiers (relatifs au coffre), séparés par des virgules, à exclure de cette cible (en plus des autres cibles, exclues automatiquement). S'applique aux deux côtés. Vide = rien de plus.",
  excludeFoldersPlaceholder: "Archives, Privé/Journal",

  headingFolders: "2. Dossiers",
  syncWholeVaultName: "Synchroniser tout le coffre",
  syncWholeVaultDesc:
    "Activé : tous les fichiers du coffre sont synchronisés (sauf le dossier de configuration .obsidian). Désactivé : uniquement un sous-dossier sélectionné. Une seule cible peut synchroniser tout le coffre.",
  syncWholeVaultLocked:
    "Une seule cible peut synchroniser tout le coffre — « {name} » le fait déjà. Choisissez un sous-dossier pour cette cible.",
  localFolderName: "Dossier local du coffre",
  localFolderDescSet: "Sous-dossier relatif au coffre qui est synchronisé.",
  localFolderDescEmpty:
    "⚠️ Veuillez choisir un dossier — sans sélection, rien n'est synchronisé.",
  localFolderPlaceholder: "ex. Notes/Sync",
  driveFolderName: "Dossier Google Drive",
  driveFolderDescSet: "Actuel : « {name} »",
  driveFolderDescEmpty: "Aucun dossier choisi pour l'instant.",
  driveFolderPlaceholderReady: "Tapez pour rechercher des dossiers Drive…",
  driveFolderPlaceholderNotReady:
    "Connectez-vous d'abord, puis recherchez des dossiers",
  driveFolderCheckButton: "Vérifier",
  sharedDriveSuffix: " (Drive partagé)",
  driveFolderFound: "Dossier trouvé : « {name} »{location}",
  driveFolderInvalid: "Dossier invalide : {error}",
  driveFolderCreateTooltip: "Créer un nouveau dossier Drive « Obsidian »",
  driveFolderCreated: "Dossier « {name} » créé.",
  driveFolderCreateFailed: "Impossible de créer le dossier : {error}",

  // ---- Paramètres : filtre de fichiers & comportement de suppression ----
  allowedExtensionsName: "Extensions de fichiers autorisées",
  allowedExtensionsDesc:
    "Séparées par des virgules, sans le point (ex. « md, png, jpg, pdf »). Vide = tous les types de fichiers. Les Google Docs/Sheets/Slides sont toujours ignorés car ils ne peuvent pas être téléchargés comme fichiers binaires.",
  allowedExtensionsPlaceholder: "md, png, jpg, pdf",
  ignorePatternsName: "Motifs à ignorer",
  ignorePatternsDesc:
    "Liste séparée par des virgules de fichiers/dossiers à exclure de la synchronisation — sans guillemets. Accepte les extensions simples (tmp, .log) et les motifs glob (*.tmp, drafts/*, **/node_modules/**). Les chemins sont relatifs au dossier de synchronisation. S'applique aux deux côtés. Vide = ne rien ignorer.",
  ignorePatternsPlaceholder: "*.tmp, .DS_Store, drafts/*",
  neverDeleteRemoteName: "Ne pas supprimer dans Google Drive",
  neverDeleteRemoteDesc:
    "Si activé, un fichier supprimé localement n'est PAS retiré de Google Drive. Le fichier reste dans Drive et ne revient pas localement. Via « Uniquement dans Drive » ci-dessous, vous pouvez retélécharger des fichiers individuels localement. Par défaut : désactivé.",
  syncGoogleDocsName: "Synchroniser Google Docs et Sheets (lecture seule)",
  syncGoogleDocsDesc:
    "Crée une petite note par Google Doc et Sheet qui intègre l'éditeur Google en direct (modifiable sur ordinateur ; ouvert en externe sur mobile). Le fichier lui-même n'est pas téléchargé ni jamais renvoyé. Par défaut : désactivé.",

  // ---- Intégration Google Docs/Sheets ----
  gdocOpenInDrive: "Ouvrir dans Google Docs",
  gsheetOpenInDrive: "Ouvrir dans Google Sheets",
  gdocInvalidBlock: "Intégration de fichier Google invalide (identifiant de document manquant).",

  // ---- Paramètres : synchronisation automatique ----
  headingAutoSync: "3. Synchronisation automatique",
  autoSyncEnabledName: "Activer la synchronisation automatique",
  autoSyncEnabledDesc:
    "Téléverse les modifications locales peu après l'enregistrement et interroge Drive à intervalles réguliers.",
  pollIntervalName: "Intervalle d'interrogation de Drive (secondes)",
  pollIntervalDesc:
    "Fréquence de vérification des modifications sur Drive (minimum 15).",
  localDebounceName: "Délai après une modification locale (ms)",
  localDebounceDesc:
    "Anti-rebond pour regrouper les enregistrements rapides successifs.",
  logRetentionName: "Conservation du journal (heures)",
  logRetentionDesc:
    "Les entrées de journal plus anciennes sont supprimées automatiquement. 0 = ne jamais supprimer automatiquement.",
  debugLoggingName: "Journalisation de débogage",
  debugLoggingDesc:
    "Écrit des messages d'information détaillés dans la console de développement. À activer uniquement pour le dépannage.",
  batchEnabledName: "Synchroniser par lots",
  batchEnabledDesc:
    "Traite une grosse synchronisation par lots et reprend jusqu'à la fin, en limitant la mémoire (recommandé sur mobile). Désactivez pour tout synchroniser en une passe — plus rapide sur les appareils performants, mais une très grosse synchronisation peut faire planter l'application sur mobile.",
  batchSizeName: "Taille du lot",
  batchSizeDesc:
    "Nombre maximal de transferts de fichiers par exécution avant de reprendre (50–2000). Plus élevé = moins de reprises mais plus de mémoire par exécution. Par défaut 400.",

  // ---- Paramètres : actions & état ----
  headingActionsStatus: "4. Actions & état",
  syncNowName: "Synchroniser maintenant",
  lastSyncDesc: "Dernière synchronisation : {time}",
  neverSyncedDesc: "Aucune synchronisation effectuée pour l'instant.",
  syncStartButton: "Démarrer la synchronisation",
  syncRunningButton: "Synchronisation en cours…",
  syncLogName: "Journal de synchronisation",
  syncLogDesc:
    "Journal complet et mis à jour en direct des actions de synchronisation.",
  showLogButton: "Afficher le journal",
  clearLogTooltip: "Vider le journal",
  resetSyncStateName: "Réinitialiser l'état de synchronisation",
  resetSyncStateDesc:
    "Supprime l'historique de synchronisation interne (pas vos fichiers). Utile en cas d'incohérences. Lors de la prochaine synchronisation, tous les fichiers sont réconciliés depuis le début.",
  resetButton: "Réinitialiser",
  resetSyncStateNotice: "État de synchronisation réinitialisé.",

  // ---- Paramètres : arbre de synchronisation ----
  syncTreeName: "Arbre de synchronisation",
  syncTreeDesc:
    "Tous les dossiers et fichiers synchronisés. Les entrées conservées uniquement dans Google Drive (supprimées localement mais conservées) ont une case cochée — décochez pour les restaurer localement lors de la prochaine synchronisation. Actuellement uniquement dans Drive : {count}.",
  syncTreeCheckboxTitle: "Décochez pour restaurer localement",
  syncTreeCheckboxLocalTitle: "Présent en local et sur Google Drive",
  syncTreeCheckboxRestoreTitle:
    "Uniquement sur Google Drive — cochez pour restaurer en local",
  syncTreeColName: "Nom",
  syncTreeColLocal: "Local",
  syncTreeColIgnored: "Ignoré",
  syncTreeCheckboxIgnoredTitle:
    "Exclu par les filtres de cette cible (motifs d’exclusion, liste blanche d’extensions ou dossiers exclus)",
  syncTreeCheckboxNotIgnoredTitle: "Non exclu par les filtres de cette cible",
  syncTreeRefresh: "Actualiser l’arborescence",
  syncTreeEmpty: "Rien de synchronisé pour l’instant.",
  syncTreeFilterPlaceholder: "Filtrer par nom ou chemin…",
  syncTreeNoMatch: "Aucune entrée ne correspond au filtre.",
  syncTreeRestored:
    "« {path} » sera restauré lors de la prochaine synchronisation.",

  // ---- Ligne d'état en direct ----
  statusLineReady: "Prêt.",
  statusLineRunning: "{message} · {secs}s",
  statusLineDone: "{message}",
  statusLineError: "{message}",

  // ---- Fenêtre du journal ----
  logModalTitle: "Google Drive Mirror — Journal",
  logModalClearButton: "Vider le journal",
  logModalCount: "{count} entrées",
  logModalEmpty: "Aucune entrée pour l'instant.",

  // ---- Valeurs par défaut de l'état ----
  statusReady: "Prêt",
  statusSyncStarted: "Synchronisation démarrée…",

  // ---- Moteur de synchronisation : phases & messages ----
  engineNoDriveFolder:
    "Google Drive Mirror : Aucun dossier Drive configuré.",
  engineReadingLocal: "Lecture des fichiers locaux…",
  engineFetchingDrive: "Récupération depuis Google Drive…",
  engineFetchingDriveProgress:
    "Récupération depuis Google Drive… {folders} dossiers, {files} fichiers",
  engineDuplicateSameContent:
    "Plusieurs fichiers Drive au contenu identique « {path} » — un seul choisi.",
  engineDuplicateDifferent:
    "Plusieurs fichiers Drive différents avec le même chemin « {path} » — ignorés. Veuillez supprimer/renommer le doublon dans Drive.",
  engineDuplicateFolder:
    "Plusieurs dossiers Drive avec le même chemin « {path} » — ignorés. Veuillez supprimer/renommer le doublon dans Drive.",
  engineCountSummary:
    "{localFiles} locaux · {remoteFiles} fichiers Drive, {localFolders}/{remoteFolders} dossiers",
  engineNoChanges: "Aucune modification à transférer.",
  engineBatchLimited:
    "Synchronisation volumineuse : {batch} sur {total} traités lors de cette exécution ; le reste se poursuit à la prochaine synchronisation.",
  engineBatchMore:
    "{done} sur {total} synchronisés. Relancez la synchronisation pour continuer le reste.",
  engineActionError: "{type} « {path} » : {error}",
  engineActionDone: "{action} ✓",
  engineRemoteFolderNotDeleted:
    "Dossier Drive « {path} » non supprimé : contient encore des fichiers (protection contre la perte du sous-arbre).",
  engineSyncFailed: "Échec de la synchronisation : {error}",
  engineNoticePrefix: "Google Drive Mirror : {message}",
  engineRemoteFolderCreated: "Dossier Drive « {path} » créé ✓",
  engineLocalFolderCreated: "Dossier local « {path} » créé ✓",
  engineRemoteFolderDeleted: "Dossier Drive « {path} » supprimé ✓",
  engineLocalFolderDeleted: "Dossier local « {path} » supprimé ✓",
  engineFolderKeptRemote:
    "Dossier supprimé localement, conservé dans Drive « {path} »",

  // ---- Moteur de synchronisation : descriptions des actions ----
  uploadAction: "Téléverser « {path} »",
  downloadAction: "Télécharger « {path} »",
  deleteLocalAction: "Supprimer localement « {path} »",
  deleteRemoteAction: "Supprimer dans Drive « {path} »",
  keepRemoteDropLocalAction:
    "Supprimé localement, conservé dans Drive « {path} »",
  conflictAction: "Conflit « {path} » ({winner} l'emporte)",
  conflictWinnerLocal: "local",
  conflictWinnerRemote: "Drive",

  // ---- Moteur de synchronisation : ligne de résumé ----
  summaryUploaded: "{count} envoyés",
  summaryDownloaded: "{count} reçus",
  summaryDeletedRemote: "{count} supprimés dans Drive",
  summaryDeletedLocal: "{count} supprimés localement",
  summaryConflicts: "{count} conflits",
  summaryNoChanges: "aucune modification",
  summaryDoneWithErrors: "Terminé avec {count} erreur(s) : {head}",
  summaryDone: "Terminé : {head}",

  // ---- Moteur de synchronisation : notification finale ----
  noticeDeletedRemote: "Drive {count}",
  noticeDeletedLocal: "local {count}",
  noticeErrorMore: "\n…et {count} de plus",
  noticeErrorTail:
    "\n⚠ {count} erreur(s) (détails dans la console) :\n{shown}{more}",
  noticeSummary: "Google Drive Mirror : {head}{errTail}",

  // ---- Erreurs OAuth ----
  oauthCredentialsMissing:
    "L'ID client et le secret client doivent d'abord être définis dans les paramètres.",
  oauthNoRefreshToken:
    "Google n'a pas renvoyé de jeton d'actualisation. Veuillez révoquer l'accès de l'application sur https://myaccount.google.com/permissions et vous reconnecter (prompt=consent force un nouveau jeton d'actualisation).",
  oauthNotSignedIn:
    "Google Drive Mirror n'est pas connecté (aucun jeton d'actualisation).",
  oauthTokenRefreshFailed:
    "Échec du renouvellement du jeton ({status}) : {text}. Le jeton d'actualisation a peut-être expiré — veuillez vous reconnecter.",
  oauthPageSuccess: "Connexion réussie",
  oauthPageFailure: "Échec de la connexion",
  oauthPageClose: "Vous pouvez fermer cette fenêtre et revenir à Obsidian.",
  oauthError: "Erreur OAuth : {error}",
  oauthNoCode: "Aucun code d'authentification reçu.",
  oauthStateMismatch: "L'état ne correspond pas (protection CSRF).",
  oauthTimeout: "Délai d'attente dépassé lors de la connexion (5 minutes).",
  oauthCodeExchangeFailed:
    "Échec de l'échange du code ({status}) : {text}",
  oauthLoopbackDesktopOnly:
    "La connexion en loopback n'est disponible que sur ordinateur.",
  oauthImportEmpty: "Aucun jeton saisi.",

  // ---- Suggestions ----
  suggestWholeVault: "/ (tout le coffre)",
  suggestSharedDriveBadge: "  · Drive partagé",

  // ---- Client Drive ----
  driveNotAFolder: "L'ID indiqué n'est pas un dossier.",
  driveApiFailed: "API Drive \"{action}\" a échoué ({status}) : {text}",
  driveActionListFiles: "lister les fichiers",
  driveActionDownloadFile: "télécharger le fichier",
  driveActionCreateFile: "créer le fichier",
  driveActionSearchSubfolder: "rechercher le sous-dossier",
  driveActionCreateSubfolder: "créer le sous-dossier",
  driveActionUpdateFile: "mettre à jour le fichier",
  driveActionTrashFile: "déplacer le fichier vers la corbeille",
  driveActionCheckFolder: "vérifier le dossier",
  driveActionSearchFolder: "rechercher le dossier",
  driveActionCreateFolder: "créer le dossier",
};
