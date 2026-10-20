# Analyse du projet RH — 20 octobre 2026

## Avis général

Le projet constitue une application de suivi RH et de pointage déjà substantielle : imports Excel, annuaire, présence, production, bus, départs STC, corrections et export. Sa compilation fonctionne et sa gestion des dates et des conflits de sauvegarde bénéficie de contrôles utiles. En revanche, la confidentialité des données embarquées, les accès prévus par le schéma SQL et plusieurs règles de calcul empêchent de considérer cette version comme suffisamment sécurisée et fiable pour un déploiement largement accessible.

Analyse réalisée sur le commit `ff2deef`, avec un arbre de travail initialement propre. Aucune donnée distante, migration ou politique Supabase n'a été lue ou modifiée. Les tests navigateur utilisent une URL et une clé factices avec interception des requêtes. Les fichiers de données nominatifs ne sont pas reproduits dans ce rapport.

## Architecture et périmètre effectif

- Frontend : React 18.3.1, Vite 5.4.21, Tailwind CSS 4, JavaScript avec deux composants TSX et quelques types TypeScript.
- Données : navigateur → client Supabase 2.112.0 → `hr_staff_directory` pour les salariés, `hr_dashboard_store` pour les snapshots JSON, paramètres bus, liste de fiches actives et corrections.
- Import : SheetJS `xlsx` 0.18.5 lit les fichiers dans le navigateur ; rapprochement par matricule, normalisation des cellules et des dates, calcul des journées, filtrage et cumul du cycle de paie, sauvegarde conditionnelle, relecture de contrôle, affichage et export.
- Chemin actif du pointage : `DailyPointageImport` → `preparePayrollPointage` → `prepareDailyPointage` / normalisation → `savePointageSnapshot` → Supabase.
- Le cycle actif va du 26 au 25, avec import et affichage limités du 26 à aujourd'hui. Les passages identiques sont dédoublonnés.
- Navigation activée : ZK Dashboard, Employés, Bus, STC. Les entrées Tableau de bord, Pointage quotidien et Absences & Congés sont désactivées par une liste statique (`src/App.jsx:994`, `:4302`). Ce verrouillage ne constitue pas une gestion de rôles.
- La connexion directe aux pointeuses n'est pas implémentée. Le script fourni teste uniquement leur accessibilité TCP ; le parcours métier utilise les fichiers Excel (`docs/connexion-pointeuses.md`).
- Mesure locale : 53 fichiers JS/JSX/TS/TSX sous `src`, tests compris, environ 16 608 lignes ; `App.jsx` en représente 5 882. Les traductions et les écrans métier sont largement regroupés dans ce fichier.

## Vérifications exécutées

- `npm run build` : **réussi** après exécution hors de la restriction qui empêchait esbuild de résoudre le fichier de configuration.
- `npm test` : **113 réussis / 118**, soit **5 échecs**.
- `npm run test:sql` : **26 réussis / 26**, dans PostgreSQL local embarqué PGlite. Cela ne prouve pas l'installation du trigger ou les permissions en production.
- `npm run test:ui -- --reporter=line` : **15 réussis / 24**, soit **9 échecs**, sous Edge avec données simulées.
- Reproductions synthétiques supplémentaires, sans accès distant : ABS sur une journée ouverte, disparition d'une présence après changement de statut, cumul d'un fichier source modifié, conservation d'une correction après recalcul.
- Vérification du bundle produit : les noms des **158 fiches** de `src/employees.json` sont présents dans le JavaScript compilé.
- Capture mobile du test examinée : mise en page sans débordement global dans le test à 390 px, mais page très longue et information dense. Il ne s'agit pas d'un audit exhaustif d'accessibilité.

Les premiers essais de build et de tests UI avaient échoué sur une restriction d'accès aux répertoires parents. Leur relance a permis de vérifier le comportement réel ; cet obstacle n'est donc pas présenté comme un défaut applicatif.

## Constats classés par priorité

### 1. P0 — Politiques SQL trop permissives

**Preuve :** `supabase-schema.sql:43` et les blocs suivants accordent à `anon` et `authenticated` des lectures et écritures avec `using (true)` / `with check (true)`. La suppression de fiches est également autorisée. Le code applicatif ne contient pas de parcours de connexion Supabase ; le code RH de confirmation est vérifié dans le navigateur (`src/lib/pointageCorrection.js:3`).

**Conséquence :** si les politiques fournies sont installées avec les droits de table correspondants, un détenteur de la clé publique du frontend peut lire ou modifier les lignes autorisées sans passer par les confirmations de l'interface. Les identifiants de lignes RH ne sont pas une frontière d'autorisation. Les politiques effectivement installées ne sont pas connues dans cet audit.

**Action :** concevoir une authentification et des permissions serveur par rôle et, si nécessaire, par organisation ; tester explicitement les autorisations et les refus. Inventorier les autres applications utilisant les tables avant de modifier les politiques partagées.

### 2. P0 — Données nominatives embarquées dans le frontend

**Preuve :** `src/services/employeeStore.js:1` importe `src/employees.json` et construit `localEmployeesSeed` à la ligne 151. Le contrôle du build retrouve les 158 noms du fichier dans le bundle JavaScript.

**Conséquence :** toute personne pouvant télécharger ce bundle dispose de ces informations, même si les accès Supabase sont ensuite correctement restreints. Une simple protection des écrans ne retire pas ces données du fichier distribué.

**Action :** remplacer la base intégrée par des fixtures anonymisées ; charger les données réelles après autorisation. Examiner également les classeurs métier suivis dans Git avant toute publication ou redistribution du dépôt. Leur présence dans Git ne prouve pas que le dépôt est public.

### 3. P1 — ABS générés avant clôture d'une journée

**Preuve :** `src/lib/dailyPointage.js:153` et `:199` produisent ABS pour une cellule vide après l'embauche, sans consulter `closedDates`.

**Reproduction :** une journée importée avec `closedDates: []`, un salarié ayant un passage et un second salarié actif embauché auparavant donnent respectivement AVR et ABS. Le second salarié est donc absent dans le tableau alors que la journée reste ouverte.

**Action :** réserver l'ABS automatique à une journée explicitement clôturée ; distinguer non encore pointé, non importé et absent confirmé. Préserver les statuts explicites provenant du fichier.

### 4. P1 — Le statut actuel modifie l'historique de présence

**Preuve :** `src/lib/dailyPointage.js:82` exclut les personnes dont le statut actuel n'est pas Actif avant de construire les journées.

**Reproduction :** une présence au 20 octobre disparaît du tableau lorsque le même salarié devient STC avec une date de sortie au 21 octobre, sans modification des passages bruts.

**Action :** évaluer le statut à la date de chaque journée, avec date d'embauche et date de départ. Pour un historique reproductible, conserver aussi les affectations et catégories applicables au moment considéré.

### 5. P1 — Import et remise à zéro des corrections non atomiques

**Preuve :** `src/components/DailyPointageImport.jsx:204` sauvegarde le snapshot, puis la ligne 206 efface séparément les corrections des dates réimportées. L'état affiché n'est mis à jour qu'après ces deux étapes. `clearPointageCorrectionsForDates` sélectionne toutes les corrections de ces dates sans borne de révision (`src/services/pointageSnapshotStore.js:43`).

**Conséquence :** si la deuxième étape échoue, le snapshot a déjà changé en base mais l'interface annonce un échec et conserve l'ancien état. Une correction créée par un autre utilisateur entre les deux étapes peut aussi être effacée. Ce risque ressort du séquencement ; aucune course réelle n'a été provoquée en production.

**Action :** transaction/RPC serveur couvrant import et invalidation ciblée des corrections, ou version d'import liée à chaque correction. En cas de succès partiel, recharger l'état réel et présenter un message exact.

### 6. P1 — Corrections chargées sans pagination

**Preuve :** lectures `.select(...).like(...)` sans `.range(...)` aux lignes 48 et 438 de `src/services/pointageSnapshotStore.js`. Elles récupèrent aussi les anciennes périodes et les lignes vidées, puis filtrent côté navigateur.

**Conséquence :** au-delà de la limite API configurée, des corrections récentes peuvent manquer ou ne pas être invalidées au réimport. Supabase documente une limite par défaut de 1 000 lignes ; la valeur effective du projet n'a pas été vérifiée. Voir la [documentation Supabase](https://supabase.com/docs/reference/javascript/v1/select).

**Action :** filtrer période et état côté serveur, paginer avec un ordre stable, et éviter l'accumulation illimitée de lignes vidées dans le parcours de lecture.

### 7. P1 — Annuaire sensible aux écritures concurrentes et partielles

**Preuve :** `activateSavedEmployee` lit puis réécrit toute la liste des fiches actives sans contrôle de révision (`src/services/employeeStore.js:390`). La sauvegarde d'une fiche et son activation sont deux requêtes (`:651`, `:666`). Le remplacement fait un upsert des fiches puis publie la liste active (`:717`, `:726`).

**Conséquence :** deux créations simultanées peuvent écraser mutuellement leur liste active et masquer l'une des fiches pourtant stockées. Si la publication de la liste échoue, les fiches existantes déjà concernées par l'upsert peuvent avoir changé malgré le message disant que l'ancien annuaire reste affiché. La génération des matricules par maximum local augmente aussi le risque de doublons en concurrence.

**Action :** transaction serveur, contraintes métier sur les identifiants pertinents, génération serveur des identifiants, et activation par opération ciblée plutôt que réécriture d'un tableau complet.

**Autre limite :** `deleteAllRemoteEmployees` parcourt toute la table sans filtre d'organisation (`:466`). La commande de vidage peut donc toucher toutes les applications partageant cette table. Ce parcours n'a pas été exécuté.

### 8. P1 — Dépendance de lecture Excel vulnérable

**Preuve :** version installée et verrouillée : `xlsx` 0.18.5. Le frontend lit les fichiers choisis avec `XLSX.read` (`src/lib/pointageImport.js:674`, `src/lib/employeeBaseImport.js:279`).

Cette version entre dans les plages affectées par les avis éditeur [CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533) et [CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363), relatifs à la pollution de prototype et au déni de service par expression régulière. Aucun fichier d'exploitation n'a été utilisé.

**Action :** adopter une distribution officielle corrigée couvrant ces deux avis, ou une bibliothèque maintenue adaptée au besoin, avec tests de non-régression des dates Excel. Ajouter une limite de taille/volume et envisager un Web Worker : la lecture et la reconstruction des classeurs se font actuellement sur le fil principal.

### 9. P1 — Historique de paie non conservé par le nouveau parcours

**Preuve :** pour `current-payroll-only-v1`, l'archive complète est sautée (`src/services/pointageSnapshotStore.js:349`). Au changement de cycle, le chargement remplace conditionnellement le courant par un snapshot vide (`:430`).

**Conséquence :** ce comportement documenté est intentionnel, mais le courant peut être effacé à l'ouverture du nouveau cycle sans création d'une archive par ce chemin. La disponibilité d'une sauvegarde externe fiable n'est pas démontrée. Le contrôle de révision évite un écrasement concurrent ; il ne fournit pas une archive.

**Action :** décider explicitement de la durée de conservation métier et de la procédure de restitution. Si les anciens cycles doivent être consultables, archiver et vérifier la sauvegarde avant de vider le courant. Ne pas confondre les sauvegardes locales existantes avec une politique de sauvegarde de production garantie.

### 10. P2 — Plusieurs indicateurs ne sont pas reliés à des données métier suffisantes

- **Sécurité au travail :** `daysSinceAccident` part du 1er juin 2026 codé en dur (`src/components/DailyAttendanceOverview.jsx:27`). Aucun registre d'accidents ni remise à zéro métier n'alimente ce chiffre. Il ne peut donc pas attester un nombre réel de jours sans accident.
- **Comparaison d'absentéisme :** les textes de variation et de mois précédent sont passés comme traductions statiques, sans calcul comparatif dans `DailyAttendanceOverview`.
- **Services de production :** le regroupement cherche Injection/Métallisation/etc. dans `person.department`, mais ne lit pas `person.service` (`DailyAttendanceOverview.jsx:105`). Des fiches de forme département `PRODUCTION`, service `INJ` se retrouvent dans Autres.
- **Courbe trois mois :** `PayrollPresenceChart` reçoit l'historique du seul cycle visible. Son onglet trois mois ne fournit donc pas trois mois complets ; il mélange aussi moyennes mensuelles, semaines et jours sur une même séquence. Les absences conservent les dates non mesurées comme manquantes, ce qui est positif.

**Action :** relier chaque indicateur à une source et une période explicites ; afficher « non renseigné » lorsque la source manque. Normaliser les codes de service au même endroit pour tous les écrans.

### 11. P2 — Règles de calcul et de réimport à formaliser

- Les heures utilisent première et dernière heure moins pause, avec arrondi ; quatre passages 08:00, 12:00, 13:00, 17:00 donnent 9 h avec pause 0, plutôt que la somme des intervalles de 8 h (`src/lib/pointageImport.js:897`). Ce choix doit correspondre à la règle RH retenue.
- Les pointages impairs sont AVR et comptent comme présents dans les indicateurs. Les corrections manuelles refusent une sortie antérieure à l'entrée et ne couvrent donc pas un poste traversant minuit.
- `preparePayrollPointage` cumule les passages distincts. Reproduction : un fichier 08:00/17:00 suivi d'un fichier corrigé 09:00/17:00 conserve trois passages et devient AVR. C'est cohérent avec un complément, mais pas avec un remplacement autoritatif du fichier source.
- Le contrat de dates du pointage est MDY, distinct des dates RH françaises. Les cellules originales sont préservées ; un fichier d'un autre format doit être identifié explicitement.
- La préférence de pause du navigateur peut provoquer recalcul et sauvegarde à l'ouverture (`src/App.jsx:4661`). Deux postes avec des préférences différentes peuvent alterner la règle de calcul partagée malgré la protection contre les conflits simultanés.

**Action :** préciser import complémentaire/remplacement, clôture, horaires, pauses, poste de nuit, retards et population des indicateurs. Stocker la règle partagée côté serveur avec sa version.

### 12. P2 — Dette de tests, de structure et de documentation

Le build Vite ne vérifie pas les types. Aucun script de lint ou de typecheck n'est défini, et `checkJs` est désactivé. Aucun workflow CI n'est présent dans le dépôt. `README.md` se limite au nom du projet.

Plusieurs composants et services anciens ne sont plus importés par le chemin principal, dont un second `EmployeeEditorModal.tsx` alors qu'un composant du même nom existe dans `App.jsx`. Le risque est de corriger une implémentation inutilisée. Les traces historiques restent utiles, mais les règles actuelles doivent être décrites en un seul endroit.

Bundle mesuré : **1 135,25 kB JS**, **342,70 kB gzip**, un seul chunk ; **186,18 kB CSS** ; logo **934,16 kB** également référencé comme favicon. Vite émet un avertissement de taille. Ces chiffres ne mesurent pas le temps de chargement réel.

**Action :** extraire les traductions, les règles métier et les écrans de `App.jsx` ; retirer les doublons après vérification de leurs usages ; charger l'outil Excel et les écrans lourds à la demande ; optimiser le logo ; installer une validation automatisée utile avec des fixtures anonymisées.

## Pourquoi les suites de tests sont rouges

Les échecs ne correspondent pas à quatorze bugs applicatifs indépendants.

### Cinq échecs unitaires

1. `dailyPointage.test.js:74`, `:508`, `:603` : trois attentes d'ancien remplacement/dernier fichier divergent du cumul actuel. Le test à la ligne 74 utilise le helper bas niveau qui ne filtre pas le cycle ; le chemin actif applique désormais `preparePayrollPointage`, dont les tests de filtrage passent.
2. `dailyPointage.test.js:248` : helper `workbookFile` non défini ; le test n'atteint pas son assertion métier.
3. `pointageSnapshotDates.test.js:24` : attend que la correction remplace les passages bruts. Le modèle actuel conserve les passages source et applique une correction superposée. La reproduction supplémentaire confirme qu'après recalcul l'entrée corrigée reste 10:00, la sortie 17:00 et la durée 420 minutes avec la pause propre à la correction ; le passage brut 08:00 reste conservé.

### Neuf échecs navigateur

1. Quatre tests de stockage : le mock de `tests/ui/pointage-store.spec.js:25` renvoie le snapshot courant, un objet, pour la nouvelle requête de liste des corrections. Le chargement attend un tableau et retourne un échec. Ce mock doit distinguer les filtres et la cardinalité des requêtes.
2. Deux tests STC : horloge fixée au 4 octobre, mais préparation attend la sélection du 26 octobre ; cette attente contredit le filtrage actuel jusqu'à aujourd'hui.
3. Deux tests à 1500 et 390 px : attendent trois personnes issues du fichier alors que la règle actuelle ajoute un quatrième actif embauché depuis l'annuaire. La définition de l'effectif attendu doit être tranchée métier.
4. Un test desktop : attend un titre de niveau heading « ZK Dashboard » alors que l'interface le présente autrement ; des étapes suivantes supposent aussi des entrées de navigation désormais désactivées.

Mettre ces tests en cohérence doit s'accompagner de contrôles réels des absences, de l'historique et des droits ; supprimer les assertions gênantes ne suffirait pas.

## Points solides à préserver

- Sources Excel originales et provenance des dates conservées ; tests MDY, dates natives, formats régionaux et sérialisation SQL.
- Contrôle de révision du pointage courant, vérification des données relues et gestion explicite des conflits et timeouts.
- Déduplication idempotente des passages ; tests dédiés au filtrage du cycle 26–25 et aux compléments journaliers.
- Pagination explicite de l'annuaire, refus des imports de personnel composés seulement de lignes factices, et normalisation des dates RH/STC.
- Trigger SQL validé localement sur 26 scénarios, dont la monotonie de révision et la conservation des payloads hors pointage.
- Interface responsive, cinq langues et direction RTL ; test mobile réussi. Les jours non importés restent distincts de zéro mesure dans les graphiques dédiés.

## Ordre d'intervention proposé

1. **Confidentialité et accès :** supprimer les données nominatives distribuées, inventorier les droits réellement installés et préparer l'authentification/RLS adaptée aux tables partagées.
2. **Fiabilité métier :** corriger la journée ouverte et l'historique des salariés sortis ; préciser les règles de réimport, de pause, de service et de calcul des indicateurs.
3. **Persistance :** traiter atomiquement import/corrections et opérations d'annuaire, paginer les corrections, garantir l'archivage avant changement de cycle.
4. **Dépendances et validation :** corriger la lecture Excel vulnérable, rétablir les suites avec des mocks réalistes, ajouter les cas manquants et une CI reproductible.
5. **Maintenance et usage :** découper les modules, optimiser les ressources et harmoniser la documentation, puis préparer la collecte des pointeuses si elle fait partie du périmètre produit.

## Limites de cette analyse

La production, les droits Supabase effectifs, les sauvegardes distantes, le réseau des pointeuses et la conformité des calculs avec les règles internes de l'entreprise ne sont pas certifiés ici. Les chiffres distants de l'audit du 13 octobre ne sont pas repris comme un état actuel. Aucun correctif fonctionnel ni changement de données n'a été appliqué pendant cette analyse.
